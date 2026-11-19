"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getProfile, getSupabase, requireUser } from "@/lib/supabase/server";
import { matchKey, toLbs, todayISO } from "@/lib/units";

/**
 * All lifting mutations. Every one is a server action bound directly to a
 * <form>, so the app keeps working with JavaScript disabled or still loading —
 * which matters when you're logging a set on gym wifi.
 */

function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function num(fd: FormData, key: string): number | null {
  const v = str(fd, key);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bool(fd: FormData, key: string): boolean {
  return fd.get(key) === "on" || fd.get(key) === "true";
}

function list(fd: FormData, key: string): string[] {
  const v = str(fd, key);
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function parseOrNull(v: FormDataEntryValue | null): number | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function emptyToNull(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

async function displayUnit() {
  const profile = await getProfile();
  return profile?.weight_unit ?? "lb";
}

// -----------------------------------------------------------------------------
// Exercise library
// -----------------------------------------------------------------------------

export async function upsertExercise(fd: FormData): Promise<void> {
  const user = await requireUser();
  const supabase = await getSupabase();
  const id = str(fd, "id");
  const unit = await displayUnit();

  const name = str(fd, "name");
  if (!name) return;

  const equipment = str(fd, "equipment");
  const grip = str(fd, "grip");
  const angle = str(fd, "angle");
  const variant = str(fd, "variant");
  const gym = str(fd, "gym");
  const startingRaw = num(fd, "starting_resistance");

  const row = {
    user_id: user.id,
    name,
    equipment,
    grip,
    angle,
    variant,
    gym,
    primary_muscles: list(fd, "primary_muscles"),
    secondary_muscles: list(fd, "secondary_muscles"),
    starting_resistance_lbs: startingRaw === null ? 0 : toLbs(startingRaw, unit),
    unilateral: bool(fd, "unilateral"),
    notes: str(fd, "notes"),
    // Two movements that differ only in grip are genuinely different exercises,
    // so the dedupe key includes every distinguishing attribute.
    match_key: matchKey(name, equipment, grip, angle, variant, gym),
  };

  if (id) {
    await supabase.from("exercises").update(row).eq("id", id);
  } else {
    await supabase.from("exercises").upsert(row, { onConflict: "user_id,match_key" });
  }
  revalidatePath("/exercises");
  revalidatePath("/lifts");
}

export async function archiveExercise(fd: FormData): Promise<void> {
  await requireUser();
  const supabase = await getSupabase();
  const id = str(fd, "id");
  if (!id) return;
  await supabase.from("exercises").update({ archived: true }).eq("id", id);
  revalidatePath("/exercises");
}

// -----------------------------------------------------------------------------
// Workouts
// -----------------------------------------------------------------------------

export async function createWorkout(fd: FormData): Promise<void> {
  const user = await requireUser();
  const supabase = await getSupabase();
  const date = str(fd, "date") ?? todayISO();

  const { data, error } = await supabase
    .from("workouts")
    .insert({ user_id: user.id, date, title: str(fd, "title"), gym: str(fd, "gym") })
    .select("id")
    .single();

  if (error || !data) throw new Error(error?.message ?? "Could not create workout.");
  revalidatePath("/lifts");
  redirect(`/lifts/${data.id}`);
}

export async function updateWorkout(fd: FormData): Promise<void> {
  await requireUser();
  const supabase = await getSupabase();
  const id = str(fd, "id");
  if (!id) return;
  await supabase
    .from("workouts")
    .update({
      date: str(fd, "date") ?? undefined,
      title: str(fd, "title"),
      gym: str(fd, "gym"),
      notes: str(fd, "notes"),
    })
    .eq("id", id);
  revalidatePath(`/lifts/${id}`);
  revalidatePath("/lifts");
}

export async function deleteWorkout(fd: FormData): Promise<void> {
  await requireUser();
  const supabase = await getSupabase();
  const id = str(fd, "id");
  if (!id) return;
  await supabase.from("workouts").delete().eq("id", id);
  revalidatePath("/lifts");
  redirect("/lifts");
}

// -----------------------------------------------------------------------------
// Exercise blocks within a workout
// -----------------------------------------------------------------------------

async function insertSet(blockId: string, userId: string, setIndex: number) {
  const supabase = await getSupabase();
  const { data: set } = await supabase
    .from("workout_sets")
    .insert({ user_id: userId, workout_exercise_id: blockId, set_index: setIndex })
    .select("id")
    .single();
  if (set) {
    await supabase.from("set_segments").insert({ user_id: userId, set_id: set.id, segment_index: 1 });
  }
  return set?.id ?? null;
}

export async function addExerciseToWorkout(fd: FormData): Promise<void> {
  const user = await requireUser();
  const supabase = await getSupabase();
  const workoutId = str(fd, "workout_id");
  let exerciseId = str(fd, "exercise_id");
  const newName = str(fd, "new_exercise_name");
  if (!workoutId) return;

  // Let the user type a name they've never used before without a detour into the
  // exercise library — the library entry gets created on the fly.
  if (!exerciseId && newName) {
    const key = matchKey(newName);
    const { data: existing } = await supabase
      .from("exercises")
      .select("id")
      .eq("match_key", key)
      .maybeSingle();
    if (existing) {
      exerciseId = existing.id;
    } else {
      const { data: created } = await supabase
        .from("exercises")
        .insert({ user_id: user.id, name: newName, match_key: key })
        .select("id")
        .single();
      exerciseId = created?.id ?? null;
    }
  }
  if (!exerciseId) return;

  const { data: last } = await supabase
    .from("workout_exercises")
    .select("position")
    .eq("workout_id", workoutId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: block } = await supabase
    .from("workout_exercises")
    .insert({
      user_id: user.id,
      workout_id: workoutId,
      exercise_id: exerciseId,
      position: (last?.position ?? 0) + 1,
    })
    .select("id")
    .single();

  // Start with one empty set so there's somewhere to type immediately.
  if (block) await insertSet(block.id, user.id, 1);

  revalidatePath(`/lifts/${workoutId}`);
}

export async function moveExerciseBlock(fd: FormData): Promise<void> {
  await requireUser();
  const supabase = await getSupabase();
  const id = str(fd, "id");
  const workoutId = str(fd, "workout_id");
  const dir = str(fd, "direction");
  if (!id || !workoutId || !dir) return;

  const { data: blocks } = await supabase
    .from("workout_exercises")
    .select("id, position")
    .eq("workout_id", workoutId)
    .order("position");
  if (!blocks) return;

  const index = blocks.findIndex((b) => b.id === id);
  const swapWith = dir === "up" ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= blocks.length) return;

  const a = blocks[index];
  const b = blocks[swapWith];
  await supabase.from("workout_exercises").update({ position: b.position }).eq("id", a.id);
  await supabase.from("workout_exercises").update({ position: a.position }).eq("id", b.id);
  revalidatePath(`/lifts/${workoutId}`);
}

export async function removeExerciseBlock(fd: FormData): Promise<void> {
  await requireUser();
  const supabase = await getSupabase();
  const id = str(fd, "id");
  const workoutId = str(fd, "workout_id");
  if (!id) return;
  await supabase.from("workout_exercises").delete().eq("id", id);
  if (workoutId) revalidatePath(`/lifts/${workoutId}`);
}

// -----------------------------------------------------------------------------
// Sets and segments
// -----------------------------------------------------------------------------

export async function addSet(fd: FormData): Promise<void> {
  const user = await requireUser();
  const supabase = await getSupabase();
  const blockId = str(fd, "block_id");
  const workoutId = str(fd, "workout_id");
  if (!blockId) return;

  const { data: last } = await supabase
    .from("workout_sets")
    .select("set_index")
    .eq("workout_exercise_id", blockId)
    .order("set_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  await insertSet(blockId, user.id, (last?.set_index ?? 0) + 1);
  if (workoutId) revalidatePath(`/lifts/${workoutId}`);
}

export async function deleteSet(fd: FormData): Promise<void> {
  await requireUser();
  const supabase = await getSupabase();
  const id = str(fd, "id");
  const workoutId = str(fd, "workout_id");
  if (!id) return;
  await supabase.from("workout_sets").delete().eq("id", id);
  if (workoutId) revalidatePath(`/lifts/${workoutId}`);
}

/**
 * Adds a second (third, …) weight to an existing set — the superset / drop-set
 * case: "3 reps @ 50 lb + 2 reps @ 30 lb" is one set with two segments.
 */
export async function addSegment(fd: FormData): Promise<void> {
  const user = await requireUser();
  const supabase = await getSupabase();
  const setId = str(fd, "set_id");
  const workoutId = str(fd, "workout_id");
  if (!setId) return;

  const { data: last } = await supabase
    .from("set_segments")
    .select("segment_index")
    .eq("set_id", setId)
    .order("segment_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  await supabase.from("set_segments").insert({
    user_id: user.id,
    set_id: setId,
    segment_index: (last?.segment_index ?? 0) + 1,
  });
  if (workoutId) revalidatePath(`/lifts/${workoutId}`);
}

export async function deleteSegment(fd: FormData): Promise<void> {
  await requireUser();
  const supabase = await getSupabase();
  const id = str(fd, "id");
  const workoutId = str(fd, "workout_id");
  if (!id) return;
  await supabase.from("set_segments").delete().eq("id", id);
  if (workoutId) revalidatePath(`/lifts/${workoutId}`);
}

/**
 * Saves an entire exercise block in one submit — every set and segment at once.
 * This is what the workout screen posts: on a phone you fill in the whole
 * exercise and hit save once, rather than firing a request per keystroke.
 */
export async function saveBlock(fd: FormData): Promise<void> {
  await requireUser();
  const supabase = await getSupabase();
  const workoutId = str(fd, "workout_id");
  const blockId = str(fd, "block_id");
  const unit = await displayUnit();

  if (blockId) {
    await supabase
      .from("workout_exercises")
      .update({ notes: emptyToNull(fd.get("block_notes")) })
      .eq("id", blockId);
  }

  for (const raw of fd.getAll("set_id")) {
    const setId = String(raw);
    await supabase
      .from("workout_sets")
      .update({
        is_warmup: fd.get(`set_warmup_${setId}`) === "on",
        rpe: parseOrNull(fd.get(`set_rpe_${setId}`)),
        notes: emptyToNull(fd.get(`set_notes_${setId}`)),
      })
      .eq("id", setId);
  }

  for (const raw of fd.getAll("segment_id")) {
    const segId = String(raw);
    const isBw = fd.get(`seg_bw_${segId}`) === "on";
    const weight = parseOrNull(fd.get(`seg_weight_${segId}`));
    await supabase
      .from("set_segments")
      .update({
        weight_lbs: isBw || weight === null ? null : toLbs(weight, unit),
        reps: parseOrNull(fd.get(`seg_reps_${segId}`)),
      })
      .eq("id", segId);
  }

  if (workoutId) revalidatePath(`/lifts/${workoutId}`);
}
