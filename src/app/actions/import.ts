"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSupabase, requireUser } from "@/lib/supabase/server";
import { askForStructure, explainAiError } from "@/lib/ai/claude";
import {
  ImportResultSchema,
  PhotoEstimateSchema,
  type ImportResult,
  type ParsedDietEntry,
} from "@/lib/ai/schemas";
import {
  IMPORT_SYSTEM,
  PHOTO_SYSTEM,
  importUserPrompt,
  photoUserPrompt,
} from "@/lib/ai/prompts";
import { kcalFromMacros, matchKey, todayISO } from "@/lib/units";
import type { ActionResult, FoodItem } from "@/lib/types";

/**
 * Natural-language import.
 *
 * Deliberately a two-step flow: parse, then review, then apply. An LLM reading
 * someone's shorthand gym notes will occasionally misread "3x8" or guess a
 * portion size, and silently writing that into a strength history the user is
 * trying to reason about would be worse than not importing at all. So the model
 * proposes and the human confirms.
 *
 * The raw text is stored forever alongside the parse, so a bad import can be
 * re-run without retyping anything.
 */

function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

// -----------------------------------------------------------------------------
// Step 1: parse
// -----------------------------------------------------------------------------

export async function parseImport(
  _prev: ActionResult<string> | null,
  fd: FormData,
): Promise<ActionResult<string>> {
  const user = await requireUser();
  const supabase = await getSupabase();
  const text = str(fd, "text");
  if (!text) return { ok: false, error: "Paste some notes first." };

  const today = str(fd, "today") ?? todayISO();

  let parsed: ImportResult;
  try {
    parsed = await askForStructure({
      schema: ImportResultSchema,
      system: IMPORT_SYSTEM,
      content: importUserPrompt(text, today),
      effort: "high",
    });
  } catch (error) {
    await supabase.from("imports").insert({
      user_id: user.id,
      kind: "mixed",
      raw_text: text,
      status: "failed",
      error: explainAiError(error),
    });
    return { ok: false, error: explainAiError(error) };
  }

  const { data, error } = await supabase
    .from("imports")
    .insert({
      user_id: user.id,
      kind: "mixed",
      raw_text: text,
      status: "parsed",
      parsed,
    })
    .select("id")
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? "Could not save the import." };
  redirect(`/import/${data.id}`);
}

/** Photo → macro estimate. Same review-then-apply flow as text. */
export async function parsePhoto(
  _prev: ActionResult<string> | null,
  fd: FormData,
): Promise<ActionResult<string>> {
  const user = await requireUser();
  const supabase = await getSupabase();

  const file = fd.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a photo first." };
  }
  if (file.size > 10 * 1024 * 1024) {
    return { ok: false, error: "That image is over 10 MB. Try a smaller one." };
  }

  const mediaType = file.type;
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mediaType)) {
    return { ok: false, error: "Use a JPEG, PNG, WebP, or GIF image." };
  }

  const date = str(fd, "date") ?? todayISO();
  const note = str(fd, "note");
  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  let estimate;
  try {
    estimate = await askForStructure({
      schema: PhotoEstimateSchema,
      system: PHOTO_SYSTEM,
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: mediaType as any, data: base64 },
        },
        { type: "text", text: photoUserPrompt(note, date) },
      ],
      effort: "medium",
    });
  } catch (error) {
    return { ok: false, error: explainAiError(error) };
  }

  // Keep the photo so the estimate can be re-checked later against what was
  // actually on the plate.
  const path = `${user.id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
  await supabase.storage.from("meal-photos").upload(path, file, { contentType: mediaType });

  const { data, error } = await supabase
    .from("imports")
    .insert({
      user_id: user.id,
      kind: "photo",
      raw_text: note,
      image_path: path,
      status: "parsed",
      parsed: {
        workouts: [],
        bodyweight: [],
        unparsed: [],
        summary: estimate.summary,
        diet_days: [
          {
            date,
            completeness: "partial",
            completeness_note: "Imported from a photo — other meals not yet logged.",
            entries: estimate.entries,
          },
        ],
      },
    })
    .select("id")
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? "Could not save the estimate." };
  redirect(`/import/${data.id}`);
}

// -----------------------------------------------------------------------------
// Step 2: apply
// -----------------------------------------------------------------------------

/**
 * Finds or creates the exercise row this parsed exercise refers to. The match
 * key includes grip/angle/equipment/gym, so "wide-grip cable row" and
 * "neutral-grip cable row" stay distinct instead of collapsing into one
 * meaningless progression chart.
 */
async function resolveExercise(userId: string, ex: ImportResult["workouts"][number]["exercises"][number]) {
  const supabase = await getSupabase();
  const key = matchKey(ex.name, ex.equipment, ex.grip, ex.angle, ex.variant, ex.gym);

  const { data: existing } = await supabase
    .from("exercises")
    .select("id, starting_resistance_lbs")
    .eq("match_key", key)
    .maybeSingle();

  if (existing) {
    // If this import told us the machine's baseline and we didn't know it, learn it.
    if (ex.starting_resistance_lbs && !Number(existing.starting_resistance_lbs)) {
      await supabase
        .from("exercises")
        .update({ starting_resistance_lbs: ex.starting_resistance_lbs })
        .eq("id", existing.id);
    }
    return existing.id as string;
  }

  const { data: created } = await supabase
    .from("exercises")
    .insert({
      user_id: userId,
      name: ex.name,
      equipment: ex.equipment,
      grip: ex.grip,
      angle: ex.angle,
      variant: ex.variant,
      gym: ex.gym,
      primary_muscles: ex.primary_muscles ?? [],
      secondary_muscles: ex.secondary_muscles ?? [],
      starting_resistance_lbs: ex.starting_resistance_lbs ?? 0,
      unilateral: ex.unilateral ?? false,
      match_key: key,
    })
    .select("id")
    .single();

  return created?.id as string | undefined;
}

/**
 * Fills in macros from the user's saved default brand when the notes only named
 * a food ("greek yogurt") and the model had to guess. A remembered brand beats
 * an estimate every time.
 */
function applyDefaultBrand(entry: ParsedDietEntry, defaults: FoodItem[]): ParsedDietEntry {
  if (entry.protein_g !== null && entry.kcal !== null) return entry;
  const key = matchKey(entry.name);
  const match = defaults.find((f) => matchKey(f.name) === key || key.includes(matchKey(f.name)));
  if (!match) return entry;

  const scale = entry.qty && match.serving_qty ? entry.qty / match.serving_qty : 1;
  const pick = (fromEntry: number | null, fromFood: number | null) =>
    fromEntry ?? (fromFood === null ? null : Math.round(fromFood * scale * 10) / 10);

  return {
    ...entry,
    brand: entry.brand ?? match.brand,
    kcal: pick(entry.kcal, match.kcal),
    protein_g: pick(entry.protein_g, match.protein_g),
    carbs_g: pick(entry.carbs_g, match.carbs_g),
    fat_g: pick(entry.fat_g, match.fat_g),
    fiber_g: pick(entry.fiber_g, match.fiber_g),
    confidence: "high",
    note: entry.note
      ? `${entry.note} (macros from your saved ${match.brand ?? match.name})`
      : `Macros from your saved ${match.brand ?? match.name}`,
  };
}

export async function applyImport(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const supabase = await getSupabase();
  const importId = str(fd, "import_id");
  if (!importId) return { ok: false, error: "Missing import." };

  const { data: record } = await supabase
    .from("imports")
    .select("id, parsed, image_path, status")
    .eq("id", importId)
    .single();

  if (!record?.parsed) return { ok: false, error: "That import has nothing to apply." };
  if (record.status === "applied") return { ok: false, error: "That import was already applied." };

  const parsed = record.parsed as ImportResult;
  const fallbackDate = str(fd, "fallback_date") ?? todayISO();

  // Which sections the user chose to keep on the review screen.
  const keepWorkouts = new Set(fd.getAll("keep_workout").map(String));
  const keepDietDays = new Set(fd.getAll("keep_diet_day").map(String));
  const keepWeights = new Set(fd.getAll("keep_weight").map(String));

  let workoutsAdded = 0;
  let entriesAdded = 0;
  let weightsAdded = 0;

  // ---- lifts -----------------------------------------------------------------
  for (const [wIndex, workout] of parsed.workouts.entries()) {
    if (!keepWorkouts.has(String(wIndex))) continue;

    const { data: created } = await supabase
      .from("workouts")
      .insert({
        user_id: user.id,
        date: workout.date ?? fallbackDate,
        title: workout.title,
        gym: workout.gym,
        notes: workout.notes,
      })
      .select("id")
      .single();
    if (!created) continue;
    workoutsAdded++;

    for (const [eIndex, ex] of workout.exercises.entries()) {
      const exerciseId = await resolveExercise(user.id, ex);
      if (!exerciseId) continue;

      const { data: block } = await supabase
        .from("workout_exercises")
        .insert({
          user_id: user.id,
          workout_id: created.id,
          exercise_id: exerciseId,
          // Written order is performed order.
          position: eIndex + 1,
          notes: ex.note,
        })
        .select("id")
        .single();
      if (!block) continue;

      for (const [sIndex, set] of ex.sets.entries()) {
        const { data: setRow } = await supabase
          .from("workout_sets")
          .insert({
            user_id: user.id,
            workout_exercise_id: block.id,
            set_index: sIndex + 1,
            is_warmup: set.is_warmup,
            rpe: set.rpe,
            notes: set.note,
          })
          .select("id")
          .single();
        if (!setRow) continue;

        const segments = set.segments.length ? set.segments : [{ weight_lbs: null, reps: null, note: null }];
        await supabase.from("set_segments").insert(
          segments.map((seg, i) => ({
            user_id: user.id,
            set_id: setRow.id,
            segment_index: i + 1,
            weight_lbs: seg.weight_lbs,
            reps: seg.reps,
            notes: seg.note,
          })),
        );
      }
    }
  }

  // ---- diet ------------------------------------------------------------------
  const { data: defaultFoods } = await supabase.from("food_items").select("*").eq("is_default", true);
  const defaults = (defaultFoods ?? []) as FoodItem[];

  for (const [dIndex, day] of parsed.diet_days.entries()) {
    if (!keepDietDays.has(String(dIndex))) continue;
    const date = day.date ?? fallbackDate;

    await supabase.from("diet_days").upsert(
      {
        user_id: user.id,
        date,
        completeness: day.completeness,
        completeness_note: day.completeness_note,
      },
      { onConflict: "user_id,date" },
    );

    const { count } = await supabase
      .from("diet_entries")
      .select("id", { count: "exact", head: true })
      .eq("date", date);

    const rows = day.entries.map((raw, i) => {
      const entry = applyDefaultBrand(raw, defaults);
      const kcal =
        entry.kcal ??
        (entry.protein_g !== null || entry.carbs_g !== null || entry.fat_g !== null
          ? Math.round(kcalFromMacros(entry.protein_g, entry.carbs_g, entry.fat_g))
          : null);

      return {
        user_id: user.id,
        date,
        meal: entry.meal,
        position: (count ?? 0) + i,
        name: entry.brand ? `${entry.name} (${entry.brand})` : entry.name,
        qty: entry.qty,
        unit: entry.unit,
        kcal,
        protein_g: entry.protein_g,
        carbs_g: entry.carbs_g,
        fat_g: entry.fat_g,
        fiber_g: entry.fiber_g,
        micros: Object.fromEntries((entry.micros ?? []).map((m) => [m.name, m.amount])),
        source: record.image_path ? "photo" : "text_import",
        confidence: entry.confidence,
        photo_path: record.image_path,
        notes: entry.note,
      };
    });

    if (rows.length) {
      await supabase.from("diet_entries").insert(rows);
      entriesAdded += rows.length;
    }
  }

  // ---- bodyweight ------------------------------------------------------------
  for (const [bIndex, w] of parsed.bodyweight.entries()) {
    if (!keepWeights.has(String(bIndex))) continue;
    const date = w.date ?? fallbackDate;
    await supabase.from("bodyweight_logs").insert({
      user_id: user.id,
      date,
      logged_at: w.time ? new Date(`${date}T${w.time}:00`).toISOString() : null,
      weight_lbs: w.unit === "kg" ? w.weight * 2.2046226218 : w.weight,
      note: w.note,
    });
    weightsAdded++;
  }

  await supabase.from("imports").update({ status: "applied" }).eq("id", importId);

  revalidatePath("/lifts");
  revalidatePath("/diet");
  revalidatePath("/weight");
  revalidatePath("/");

  const parts = [
    workoutsAdded ? `${workoutsAdded} workout${workoutsAdded === 1 ? "" : "s"}` : null,
    entriesAdded ? `${entriesAdded} food entr${entriesAdded === 1 ? "y" : "ies"}` : null,
    weightsAdded ? `${weightsAdded} weigh-in${weightsAdded === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  return {
    ok: true,
    message: parts.length ? `Imported ${parts.join(", ")}.` : "Nothing was selected to import.",
  };
}

export async function deleteImport(fd: FormData): Promise<void> {
  await requireUser();
  const supabase = await getSupabase();
  const id = str(fd, "id");
  if (!id) return;
  await supabase.from("imports").delete().eq("id", id);
  revalidatePath("/import");
  redirect("/import");
}
