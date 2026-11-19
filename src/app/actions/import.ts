"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabase, requireUser } from "@/lib/supabase/server";
import { askForStructure, explainAiError, MissingKeyError } from "@/lib/ai/claude";
import {
  ImportResultSchema,
  PhotoEstimateSchema,
  type ImportResult,
  type ParsedDietEntry,
  type ParsedWorkout,
} from "@/lib/ai/schemas";
import {
  IMPORT_SYSTEM,
  PHOTO_SYSTEM,
  importUserPrompt,
  photoUserPrompt,
} from "@/lib/ai/prompts";
import { splitIntoChunks } from "@/lib/import-chunks";
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
 * Parsing is chunked. A year of training notes produces far more structured
 * output than one AI response can hold, and takes longer than one hosted
 * request may run. So the paste is split between sessions, stored as rows in
 * `import_chunks`, and parsed one piece per request while the review page shows
 * progress. Because each piece's state is saved, closing the tab or hitting a
 * rate limit pauses the import rather than losing it.
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

const EMPTY_RESULT: ImportResult = {
  workouts: [],
  diet_days: [],
  bodyweight: [],
  unparsed: [],
  summary: "",
};

/** A chunk claimed by a request that then died (timeout, deploy) is retried after this. */
const STALE_CLAIM_MS = 6 * 60 * 1000;

// -----------------------------------------------------------------------------
// Step 1: split and queue
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
  const chunks = splitIntoChunks(text);

  const { data: record, error } = await supabase
    .from("imports")
    .insert({
      user_id: user.id,
      kind: "mixed",
      raw_text: text,
      status: "parsing",
      // Carried until parsing finishes, so every chunk resolves "11/18" against
      // the same day even if parsing spans midnight.
      parsed: { reference_date: today },
    })
    .select("id")
    .single();
  if (error || !record) return { ok: false, error: error?.message ?? "Could not start the import." };

  const { error: chunkError } = await supabase.from("import_chunks").insert(
    chunks.map((chunkText, idx) => ({
      user_id: user.id,
      import_id: record.id,
      idx,
      text: chunkText,
    })),
  );
  if (chunkError) {
    await supabase.from("imports").delete().eq("id", record.id);
    return {
      ok: false,
      error: chunkError.message.includes("import_chunks")
        ? "The database needs an update for large imports — run supabase/schema.sql again (see DEPLOY.md)."
        : chunkError.message,
    };
  }

  redirect(`/import/${record.id}`);
}

// -----------------------------------------------------------------------------
// Step 1b: parse one chunk per call (driven by the review page)
// -----------------------------------------------------------------------------

export type ChunkProgress = {
  ok: boolean;
  /** True once every chunk is done or failed and the merged result is saved. */
  finished: boolean;
  /** False when there was nothing left to claim (other workers are on the rest). */
  claimed: boolean;
  completed: number;
  total: number;
  error?: string;
};

async function claimNextChunk(importId: string) {
  const supabase = await getSupabase();
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();

  // Two workers can race for the same row; the conditional update below means
  // only one wins, and the loser just tries the next candidate.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: candidate } = await supabase
      .from("import_chunks")
      .select("id, idx, text, status, updated_at")
      .eq("import_id", importId)
      .or(`status.eq.pending,and(status.eq.parsing,updated_at.lt.${staleBefore})`)
      .order("idx")
      .limit(1)
      .maybeSingle();
    if (!candidate) return null;

    const { data: won } = await supabase
      .from("import_chunks")
      .update({ status: "parsing", updated_at: new Date().toISOString(), error: null })
      .eq("id", candidate.id)
      .eq("updated_at", candidate.updated_at)
      .select("id, idx, text")
      .maybeSingle();
    if (won) return won;
  }
  return null;
}

async function progressOf(importId: string) {
  const supabase = await getSupabase();
  const { data } = await supabase
    .from("import_chunks")
    .select("status")
    .eq("import_id", importId);
  const rows = data ?? [];
  const completed = rows.filter((r) => r.status === "done" || r.status === "failed").length;
  return { completed, total: rows.length };
}

/** Merges every chunk's result into the import record once nothing is left to parse. */
async function finalizeIfComplete(importId: string): Promise<boolean> {
  const supabase = await getSupabase();
  const { data: chunks } = await supabase
    .from("import_chunks")
    .select("idx, text, status, result, error")
    .eq("import_id", importId)
    .order("idx");
  if (!chunks?.length) return false;
  if (chunks.some((c) => c.status === "pending" || c.status === "parsing")) return false;

  const merged: ImportResult = structuredClone(EMPTY_RESULT);
  let failed = 0;
  for (const chunk of chunks) {
    if (chunk.status === "done" && chunk.result) {
      const r = chunk.result as ImportResult;
      merged.workouts.push(...(r.workouts ?? []));
      merged.diet_days.push(...(r.diet_days ?? []));
      merged.bodyweight.push(...(r.bodyweight ?? []));
      merged.unparsed.push(...(r.unparsed ?? []));
    } else {
      failed++;
      // Nothing is dropped: a part that couldn't be read comes back verbatim.
      merged.unparsed.push(
        `[Part ${chunk.idx + 1} of ${chunks.length} couldn't be read: ${chunk.error ?? "unknown error"}]\n${chunk.text}`,
      );
    }
  }

  const sessions = merged.workouts.length;
  const parts = [
    `${sessions} workout${sessions === 1 ? "" : "s"}`,
    merged.diet_days.length ? `${merged.diet_days.length} day(s) of food` : null,
    merged.bodyweight.length ? `${merged.bodyweight.length} weigh-in(s)` : null,
  ].filter(Boolean);
  merged.summary =
    `Found ${parts.join(", ")} across ${chunks.length} part${chunks.length === 1 ? "" : "s"}.` +
    (failed ? ` ${failed} part(s) couldn't be read — their text is listed at the bottom.` : "");

  // Conditional on still being 'parsing', so two workers finishing together
  // can't both write.
  await supabase
    .from("imports")
    .update({ parsed: merged, status: "parsed" })
    .eq("id", importId)
    .eq("status", "parsing");
  return true;
}

export async function parseNextChunk(importId: string): Promise<ChunkProgress> {
  await requireUser();
  const supabase = await getSupabase();

  const { data: record } = await supabase
    .from("imports")
    .select("status, parsed")
    .eq("id", importId)
    .maybeSingle();
  if (!record) return { ok: false, finished: false, claimed: false, completed: 0, total: 0, error: "Import not found." };
  if (record.status !== "parsing") {
    const p = await progressOf(importId);
    return { ok: true, finished: true, claimed: false, ...p };
  }

  const referenceDate =
    (record.parsed as { reference_date?: string } | null)?.reference_date ?? todayISO();

  const chunk = await claimNextChunk(importId);
  if (!chunk) {
    const finished = await finalizeIfComplete(importId);
    return { ok: true, finished, claimed: false, ...(await progressOf(importId)) };
  }

  const { total } = await progressOf(importId);

  try {
    const result = await askForStructure({
      schema: ImportResultSchema,
      system: IMPORT_SYSTEM,
      content: importUserPrompt(chunk.text, referenceDate, { index: chunk.idx, total }),
      // Extraction, not deep reasoning: medium keeps each part fast enough to
      // stay inside a hosted request's time limit, and cheaper.
      effort: "medium",
    });
    await supabase
      .from("import_chunks")
      .update({ status: "done", result, updated_at: new Date().toISOString() })
      .eq("id", chunk.id);
  } catch (error) {
    // Problems that will fail every part (no key, bad key) put the part back and
    // stop the run, so fixing Settings and reloading picks up where it left off.
    const fatal =
      error instanceof MissingKeyError || error instanceof Anthropic.AuthenticationError;
    await supabase
      .from("import_chunks")
      .update({
        status: fatal ? "pending" : "failed",
        error: explainAiError(error),
        updated_at: new Date(0).toISOString(),
      })
      .eq("id", chunk.id);
    if (fatal) {
      return { ok: false, finished: false, claimed: true, ...(await progressOf(importId)), error: explainAiError(error) };
    }
  }

  const finished = await finalizeIfComplete(importId);
  return { ok: true, finished, claimed: true, ...(await progressOf(importId)) };
}

/** Puts failed parts back in the queue — for a rate limit that has since cleared. */
export async function retryFailedChunks(fd: FormData): Promise<void> {
  await requireUser();
  const supabase = await getSupabase();
  const importId = str(fd, "import_id");
  if (!importId) return;
  await supabase
    .from("import_chunks")
    .update({ status: "pending", error: null, result: null, updated_at: new Date(0).toISOString() })
    .eq("import_id", importId)
    .eq("status", "failed");
  await supabase.from("imports").update({ status: "parsing" }).eq("id", importId).eq("status", "parsed");
  revalidatePath(`/import/${importId}`);
}

// -----------------------------------------------------------------------------
// Photo → macros. Small enough to be a single request.
// -----------------------------------------------------------------------------

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
          source: {
            type: "base64",
            media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
            data: base64,
          },
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

  const parsed: ImportResult = {
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
  };

  const { data, error } = await supabase
    .from("imports")
    .insert({
      user_id: user.id,
      kind: "photo",
      raw_text: note,
      image_path: path,
      status: "parsed",
      parsed,
    })
    .select("id")
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? "Could not save the estimate." };
  redirect(`/import/${data.id}`);
}

// -----------------------------------------------------------------------------
// Step 2: apply
// -----------------------------------------------------------------------------

type ParsedExercise = ParsedWorkout["exercises"][number];

function exerciseKey(ex: ParsedExercise) {
  return matchKey(ex.name, ex.equipment, ex.grip, ex.angle, ex.variant, ex.gym);
}

/**
 * Finds or creates the exercise row for every distinct exercise in the import,
 * once each. The key includes grip/angle/equipment/gym, so "wide-grip lever row"
 * and "neutral-grip lever row" stay distinct instead of collapsing into one
 * meaningless progression chart.
 */
async function resolveExercises(userId: string, exercises: ParsedExercise[]) {
  const supabase = await getSupabase();
  const byKey = new Map<string, ParsedExercise>();
  for (const ex of exercises) {
    const key = exerciseKey(ex);
    const known = byKey.get(key);
    // Prefer the occurrence that stated a starting resistance.
    if (!known || (!known.starting_resistance_lbs && ex.starting_resistance_lbs)) byKey.set(key, ex);
  }

  const keys = [...byKey.keys()];
  const ids = new Map<string, string>();

  const { data: existing } = await supabase
    .from("exercises")
    .select("id, match_key, starting_resistance_lbs")
    .in("match_key", keys);

  for (const row of existing ?? []) {
    ids.set(row.match_key, row.id);
    const ex = byKey.get(row.match_key)!;
    // If this import told us the machine's baseline and we didn't know it, learn it.
    if (ex.starting_resistance_lbs && !Number(row.starting_resistance_lbs)) {
      await supabase
        .from("exercises")
        .update({ starting_resistance_lbs: ex.starting_resistance_lbs })
        .eq("id", row.id);
    }
  }

  const missing = keys.filter((k) => !ids.has(k));
  if (missing.length) {
    const { data: created, error } = await supabase
      .from("exercises")
      .insert(
        missing.map((key) => {
          const ex = byKey.get(key)!;
          return {
            user_id: userId,
            name: ex.name,
            equipment: ex.equipment,
            grip: ex.grip,
            angle: ex.angle,
            variant: ex.variant,
            gym: ex.gym,
            primary_muscles: (ex.primary_muscles ?? []).filter((m): m is string => !!m),
            secondary_muscles: (ex.secondary_muscles ?? []).filter((m): m is string => !!m),
            starting_resistance_lbs: ex.starting_resistance_lbs ?? 0,
            unilateral: ex.unilateral ?? false,
            match_key: key,
          };
        }),
      )
      .select("id, match_key");
    if (error) throw new Error(`Saving exercises: ${error.message}`);
    for (const row of created ?? []) ids.set(row.match_key, row.id);
  }

  return ids;
}

/**
 * Writes one workout in four round trips (workout, blocks, sets, segments)
 * instead of one per row. A year of history is thousands of rows; one request
 * each would run past a hosted request's time limit.
 */
async function insertWorkout(
  userId: string,
  workout: ParsedWorkout,
  fallbackDate: string,
  exerciseIds: Map<string, string>,
) {
  const supabase = await getSupabase();
  const { data: created, error } = await supabase
    .from("workouts")
    .insert({
      user_id: userId,
      date: workout.date ?? fallbackDate,
      title: workout.title,
      gym: workout.gym,
      notes: workout.notes,
    })
    .select("id")
    .single();
  if (error || !created) throw new Error(`Saving workout ${workout.date ?? ""}: ${error?.message}`);
  if (!workout.exercises.length) return;

  // Blocks — matched back to their inserted ids by position (unique per workout).
  const { data: blocks, error: blockError } = await supabase
    .from("workout_exercises")
    .insert(
      workout.exercises.map((ex, i) => ({
        user_id: userId,
        workout_id: created.id,
        exercise_id: exerciseIds.get(exerciseKey(ex))!,
        position: i + 1, // written order is performed order
        notes: ex.note,
      })),
    )
    .select("id, position");
  if (blockError) throw new Error(`Saving exercises for ${workout.date}: ${blockError.message}`);
  const blockIdByPosition = new Map((blocks ?? []).map((b) => [b.position, b.id]));

  // Sets — matched back by (block, set_index).
  const setRows = workout.exercises.flatMap((ex, i) =>
    ex.sets.map((set, s) => ({
      user_id: userId,
      workout_exercise_id: blockIdByPosition.get(i + 1)!,
      set_index: s + 1,
      is_warmup: set.is_warmup,
      rpe: set.rpe,
      notes: set.note,
    })),
  );
  if (!setRows.length) return;
  const { data: sets, error: setError } = await supabase
    .from("workout_sets")
    .insert(setRows)
    .select("id, workout_exercise_id, set_index");
  if (setError) throw new Error(`Saving sets for ${workout.date}: ${setError.message}`);
  const setId = new Map((sets ?? []).map((s) => [`${s.workout_exercise_id}:${s.set_index}`, s.id]));

  const segmentRows = workout.exercises.flatMap((ex, i) =>
    ex.sets.flatMap((set, s) => {
      const id = setId.get(`${blockIdByPosition.get(i + 1)}:${s + 1}`)!;
      const segments = set.segments.length ? set.segments : [{ weight_lbs: null, reps: null, note: null }];
      return segments.map((seg, g) => ({
        user_id: userId,
        set_id: id,
        segment_index: g + 1,
        weight_lbs: seg.weight_lbs,
        reps: seg.reps,
        notes: seg.note,
      }));
    }),
  );
  const { error: segError } = await supabase.from("set_segments").insert(segmentRows);
  if (segError) {
    throw new Error(
      segError.message.includes("integer")
        ? "The database still stores reps as whole numbers — run supabase/schema.sql again to allow half reps."
        : `Saving sets for ${workout.date}: ${segError.message}`,
    );
  }
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
  if (record.status !== "parsed") return { ok: false, error: "That import is still being read." };

  const parsed = record.parsed as ImportResult;
  const fallbackDate = str(fd, "fallback_date") ?? todayISO();

  // Which sections the user chose to keep on the review screen.
  const keepWorkouts = new Set(fd.getAll("keep_workout").map(String));
  const keepDietDays = new Set(fd.getAll("keep_diet_day").map(String));
  const keepWeights = new Set(fd.getAll("keep_weight").map(String));

  let workoutsAdded = 0;
  let entriesAdded = 0;
  let weightsAdded = 0;

  try {
    // ---- lifts ---------------------------------------------------------------
    const chosen = parsed.workouts.filter((_, i) => keepWorkouts.has(String(i)));
    const exerciseIds = await resolveExercises(
      user.id,
      chosen.flatMap((w) => w.exercises),
    );
    // A few at a time: fast, without flooding the database with parallel writes.
    for (let i = 0; i < chosen.length; i += 4) {
      await Promise.all(
        chosen.slice(i, i + 4).map((w) => insertWorkout(user.id, w, fallbackDate, exerciseIds)),
      );
      workoutsAdded += chosen.slice(i, i + 4).length;
    }

    // ---- diet ----------------------------------------------------------------
    const { data: defaultFoods } = await supabase
      .from("food_items")
      .select("*")
      .eq("is_default", true);
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
        const { error } = await supabase.from("diet_entries").insert(rows);
        if (error) throw new Error(`Saving food for ${date}: ${error.message}`);
        entriesAdded += rows.length;
      }
    }

    // ---- bodyweight ----------------------------------------------------------
    const weights = parsed.bodyweight
      .map((w, i) => ({ w, i }))
      .filter(({ i }) => keepWeights.has(String(i)))
      .map(({ w }) => {
        const date = w.date ?? fallbackDate;
        return {
          user_id: user.id,
          date,
          logged_at: w.time ? new Date(`${date}T${w.time}:00`).toISOString() : null,
          weight_lbs: w.unit === "kg" ? w.weight * 2.2046226218 : w.weight,
          note: w.note,
        };
      });
    if (weights.length) {
      const { error } = await supabase.from("bodyweight_logs").insert(weights);
      if (error) throw new Error(`Saving weigh-ins: ${error.message}`);
      weightsAdded = weights.length;
    }
  } catch (error) {
    // Report what made it in, so a retry doesn't silently double-import.
    const done = workoutsAdded ? ` ${workoutsAdded} workout(s) were saved before this.` : "";
    return { ok: false, error: `${error instanceof Error ? error.message : "Import failed."}${done}` };
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
