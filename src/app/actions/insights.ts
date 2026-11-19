"use server";

import { revalidatePath } from "next/cache";
import { getSupabase, requireUser } from "@/lib/supabase/server";
import { askForProse, askForStructure, explainAiError } from "@/lib/ai/claude";
import { INSIGHTS_SYSTEM, MICRO_SUMMARY_SYSTEM, insightsUserPrompt } from "@/lib/ai/prompts";
import { MicroSummarySchema } from "@/lib/ai/schemas";
import {
  dailyTotals,
  exerciseHistory,
  getDietEntries,
  listExercises,
  listBodyweight,
  listWorkouts,
  muscleVolume,
  resolveTargets,
} from "@/lib/data";
import { addDays, todayISO } from "@/lib/units";
import type { ActionResult } from "@/lib/types";

/**
 * Builds the analysis payload. The important part is what gets *excluded*:
 * days the user marked partial or untracked are handed over labelled, and the
 * prompt forbids averaging them in. Otherwise every skipped log looks like a
 * fasting day and the whole diet analysis is wrong.
 */
async function buildPayload(days: number) {
  const end = todayISO();
  const start = addDays(end, -(days - 1));

  const [workouts, exercises, totals, weights, targets, muscles] = await Promise.all([
    listWorkouts(120),
    listExercises(),
    dailyTotals(days, end),
    listBodyweight(120),
    resolveTargets(),
    muscleVolume(start),
  ]);

  const recentWorkouts = workouts.filter((w) => w.date >= start);

  // Progression series for every exercise trained in the window, so the model
  // can talk about specific lifts rather than vague "upper body" trends.
  const trainedIds = new Set<string>();
  for (const w of recentWorkouts) {
    for (const block of w.workout_exercises ?? []) trainedIds.add(block.exercise_id);
  }

  const progressions = await Promise.all(
    [...trainedIds].map(async (id) => {
      const ex = exercises.find((e) => e.id === id);
      const history = await exerciseHistory(id);
      return {
        exercise: ex
          ? [ex.name, ex.grip, ex.angle, ex.equipment, ex.gym].filter(Boolean).join(" · ")
          : "unknown",
        startingResistanceLbs: ex?.starting_resistance_lbs ?? 0,
        sessions: history.slice(-12),
      };
    }),
  );

  const trackedDays = totals.filter((d) => d.completeness === "complete");
  const average = (key: "kcal" | "protein_g" | "carbs_g" | "fat_g" | "fiber_g") =>
    trackedDays.length
      ? Math.round(trackedDays.reduce((s, d) => s + d[key], 0) / trackedDays.length)
      : null;

  return {
    window: { start, end, days },
    weightUnit: "lb",
    targets: {
      kcal: targets.target?.kcal ?? null,
      protein_g: targets.proteinTarget,
      carbs_g: targets.target?.carbs_g ?? null,
      fat_g: targets.target?.fat_g ?? null,
      fiber_g: targets.target?.fiber_g ?? null,
      proteinRule:
        targets.target?.protein_mode === "bodyweight"
          ? `${targets.target.protein_multiplier} g per lb of bodyweight`
          : "manual",
    },
    bodyweight: weights.slice(0, 30).map((w) => ({ date: w.date, lbs: w.weight_lbs })),
    strength: progressions.filter((p) => p.sessions.length > 0),
    setsPerMuscle: muscles,
    diet: {
      // Explicitly separated so the model cannot accidentally average them together.
      fullyLoggedDays: trackedDays.map((d) => ({
        date: d.date,
        kcal: Math.round(d.kcal),
        protein_g: Math.round(d.protein_g),
        carbs_g: Math.round(d.carbs_g),
        fat_g: Math.round(d.fat_g),
        fiber_g: Math.round(d.fiber_g),
      })),
      partiallyLoggedDays: totals
        .filter((d) => d.completeness === "partial")
        .map((d) => ({ date: d.date, kcal: Math.round(d.kcal), note: "incomplete log" })),
      untrackedDays: totals.filter((d) => d.completeness === "untracked").map((d) => d.date),
      averagesOverFullyLoggedDaysOnly: {
        kcal: average("kcal"),
        protein_g: average("protein_g"),
        carbs_g: average("carbs_g"),
        fat_g: average("fat_g"),
        fiber_g: average("fiber_g"),
        n: trackedDays.length,
      },
    },
    workoutCount: recentWorkouts.length,
  };
}

export async function generateInsights(
  _prev: ActionResult<string> | null,
  fd: FormData,
): Promise<ActionResult<string>> {
  const user = await requireUser();
  const supabase = await getSupabase();
  const days = Number(fd.get("days")) || 30;

  try {
    const payload = await buildPayload(days);

    if (payload.workoutCount === 0 && payload.diet.fullyLoggedDays.length === 0) {
      return {
        ok: false,
        error: "There's nothing logged in this window yet. Log a workout or a day of food first.",
      };
    }

    const body = await askForProse({
      system: INSIGHTS_SYSTEM,
      content: insightsUserPrompt(payload, `the last ${days} days`),
      effort: "high",
    });

    await supabase.from("insights").insert({
      user_id: user.id,
      kind: `${days}d`,
      period_start: payload.window.start,
      period_end: payload.window.end,
      body_md: body,
      data: payload,
    });

    revalidatePath("/insights");
    return { ok: true, data: body };
  } catch (error) {
    return { ok: false, error: explainAiError(error) };
  }
}

/**
 * Micronutrients are never entered by hand — they're inferred from what was
 * eaten and summarized per day, on demand.
 */
export async function summarizeMicros(
  _prev: ActionResult<string> | null,
  fd: FormData,
): Promise<ActionResult<string>> {
  const user = await requireUser();
  const supabase = await getSupabase();
  const date = String(fd.get("date") ?? todayISO());

  try {
    const [entries, day] = await Promise.all([
      getDietEntries(date),
      supabase.from("diet_days").select("completeness").eq("date", date).maybeSingle(),
    ]);

    if (entries.length === 0) {
      return { ok: false, error: "Nothing logged for that day yet." };
    }

    const result = await askForStructure({
      schema: MicroSummarySchema,
      system: MICRO_SUMMARY_SYSTEM,
      content: JSON.stringify(
        {
          date,
          logCompleteness: day.data?.completeness ?? "complete",
          foods: entries.map((e) => ({
            name: e.name,
            qty: e.qty,
            unit: e.unit,
            kcal: e.kcal,
            protein_g: e.protein_g,
            carbs_g: e.carbs_g,
            fat_g: e.fat_g,
            fiber_g: e.fiber_g,
            knownMicros: e.micros,
          })),
        },
        null,
        2,
      ),
      effort: "low",
    });

    await supabase.from("diet_days").upsert(
      {
        user_id: user.id,
        date,
        ai_micro_summary: result.summary,
        ai_micro_data: result.notable,
        ai_summary_at: new Date().toISOString(),
      },
      { onConflict: "user_id,date" },
    );

    revalidatePath("/diet");
    return { ok: true, data: result.summary };
  } catch (error) {
    return { ok: false, error: explainAiError(error) };
  }
}
