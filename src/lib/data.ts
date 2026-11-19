import "server-only";
import { getSupabase, requireUser } from "@/lib/supabase/server";
import { addDays, epley1RM, todayISO } from "@/lib/units";
import type {
  BodyweightLog,
  DayTotals,
  DietDay,
  DietEntry,
  Exercise,
  FoodItem,
  MacroTotals,
  Recipe,
  Target,
  Workout,
} from "@/lib/types";

const WORKOUT_SELECT = `
  id, user_id, date, title, gym, notes,
  workout_exercises (
    id, workout_id, exercise_id, position, notes,
    exercises ( * ),
    workout_sets (
      id, workout_exercise_id, set_index, is_warmup, rpe, notes,
      set_segments ( id, set_id, segment_index, weight_lbs, reps, notes )
    )
  )
`;

/** Sorts the nested arrays Postgres returns in arbitrary order into performed order. */
function orderWorkout(w: Workout): Workout {
  w.workout_exercises?.sort((a, b) => a.position - b.position);
  for (const we of w.workout_exercises ?? []) {
    we.workout_sets?.sort((a, b) => a.set_index - b.set_index);
    for (const s of we.workout_sets ?? []) {
      s.set_segments?.sort((a, b) => a.segment_index - b.segment_index);
    }
  }
  return w;
}

export async function listWorkouts(limit = 60): Promise<Workout[]> {
  await requireUser();
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("workouts")
    .select(WORKOUT_SELECT)
    .order("date", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Workout[]).map(orderWorkout);
}

export async function getWorkout(id: string): Promise<Workout | null> {
  await requireUser();
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("workouts")
    .select(WORKOUT_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? orderWorkout(data as unknown as Workout) : null;
}

export async function listExercises(): Promise<Exercise[]> {
  await requireUser();
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("exercises")
    .select("*")
    .eq("archived", false)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Exercise[];
}

// -----------------------------------------------------------------------------
// Strength progression
// -----------------------------------------------------------------------------

export type ExerciseSession = {
  date: string;
  workoutId: string;
  topSetWeight: number | null;
  topSetReps: number | null;
  bestE1RM: number;
  totalVolume: number;
  totalReps: number;
  sets: number;
};

/**
 * The core "am I getting stronger?" series for one exercise: one point per day
 * it was trained. Effective load includes the machine's starting resistance, so
 * a 20 lb-base machine isn't compared against a free weight as if it were 0.
 */
export async function exerciseHistory(exerciseId: string): Promise<ExerciseSession[]> {
  await requireUser();
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("workout_exercises")
    .select(
      `id, workout_id, exercises!inner ( id, starting_resistance_lbs ),
       workouts!inner ( id, date ),
       workout_sets ( id, is_warmup, set_segments ( weight_lbs, reps ) )`,
    )
    .eq("exercise_id", exerciseId);
  if (error) throw new Error(error.message);

  const sessions: ExerciseSession[] = [];

  for (const block of (data ?? []) as any[]) {
    const base = Number(block.exercises?.starting_resistance_lbs ?? 0);
    const date = block.workouts?.date as string;
    let bestE1RM = 0;
    let topSetWeight: number | null = null;
    let topSetReps: number | null = null;
    let totalVolume = 0;
    let totalReps = 0;
    let setCount = 0;

    for (const set of block.workout_sets ?? []) {
      if (set.is_warmup) continue;
      setCount++;
      for (const seg of set.set_segments ?? []) {
        const reps = Number(seg.reps ?? 0);
        if (!reps) continue;
        const weight = seg.weight_lbs === null ? 0 : Number(seg.weight_lbs) + base;
        totalReps += reps;
        totalVolume += weight * reps;
        const e = epley1RM(weight, reps);
        if (e > bestE1RM) {
          bestE1RM = e;
          topSetWeight = seg.weight_lbs === null ? null : weight;
          topSetReps = reps;
        }
      }
    }

    if (setCount === 0) continue;
    sessions.push({
      date,
      workoutId: block.workout_id,
      topSetWeight,
      topSetReps,
      bestE1RM: Math.round(bestE1RM * 10) / 10,
      totalVolume: Math.round(totalVolume),
      totalReps,
      sets: setCount,
    });
  }

  // Merge multiple blocks of the same exercise on the same day into one point.
  const byDate = new Map<string, ExerciseSession>();
  for (const s of sessions) {
    const existing = byDate.get(s.date);
    if (!existing) {
      byDate.set(s.date, s);
    } else {
      existing.totalVolume += s.totalVolume;
      existing.totalReps += s.totalReps;
      existing.sets += s.sets;
      if (s.bestE1RM > existing.bestE1RM) {
        existing.bestE1RM = s.bestE1RM;
        existing.topSetWeight = s.topSetWeight;
        existing.topSetReps = s.topSetReps;
      }
    }
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Sets per body part over a window — the "am I neglecting something?" view. */
export async function muscleVolume(sinceISO: string): Promise<Record<string, number>> {
  await requireUser();
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("workout_exercises")
    .select(
      `exercises!inner ( primary_muscles, secondary_muscles ),
       workouts!inner ( date ),
       workout_sets ( id, is_warmup )`,
    )
    .gte("workouts.date", sinceISO);
  if (error) throw new Error(error.message);

  const totals: Record<string, number> = {};
  for (const block of (data ?? []) as any[]) {
    const sets = (block.workout_sets ?? []).filter((s: any) => !s.is_warmup).length;
    if (!sets) continue;
    for (const m of block.exercises?.primary_muscles ?? []) {
      totals[m] = (totals[m] ?? 0) + sets;
    }
    // Secondary movers get half credit — they're worked, but not the point of the lift.
    for (const m of block.exercises?.secondary_muscles ?? []) {
      totals[m] = (totals[m] ?? 0) + sets * 0.5;
    }
  }
  return totals;
}

// -----------------------------------------------------------------------------
// Diet
// -----------------------------------------------------------------------------

export function sumMacros(entries: Pick<DietEntry, "kcal" | "protein_g" | "carbs_g" | "fat_g" | "fiber_g">[]): MacroTotals {
  return entries.reduce<MacroTotals>(
    (acc, e) => ({
      kcal: acc.kcal + (e.kcal ?? 0),
      protein_g: acc.protein_g + (e.protein_g ?? 0),
      carbs_g: acc.carbs_g + (e.carbs_g ?? 0),
      fat_g: acc.fat_g + (e.fat_g ?? 0),
      fiber_g: acc.fiber_g + (e.fiber_g ?? 0),
    }),
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
  );
}

export async function getDietEntries(date: string): Promise<DietEntry[]> {
  await requireUser();
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("diet_entries")
    .select("*")
    .eq("date", date)
    .order("position");
  if (error) throw new Error(error.message);
  return (data ?? []) as DietEntry[];
}

export async function getDietDay(date: string): Promise<DietDay | null> {
  await requireUser();
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("diet_days")
    .select("*")
    .eq("date", date)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as DietDay) ?? null;
}

/**
 * Daily macro totals across a window, with each day's completeness attached.
 * Charts use `completeness` to visually separate "ate little" from "logged
 * little" — conflating those two makes every trend line a lie.
 */
export async function dailyTotals(days = 30, endDate = todayISO()): Promise<DayTotals[]> {
  await requireUser();
  const supabase = await getSupabase();
  const start = addDays(endDate, -(days - 1));

  const [{ data: entries, error: e1 }, { data: dayRows, error: e2 }] = await Promise.all([
    supabase.from("diet_entries").select("*").gte("date", start).lte("date", endDate),
    supabase.from("diet_days").select("*").gte("date", start).lte("date", endDate),
  ]);
  if (e1) throw new Error(e1.message);
  if (e2) throw new Error(e2.message);

  const completenessByDate = new Map<string, DietDay>();
  for (const d of (dayRows ?? []) as DietDay[]) completenessByDate.set(d.date, d);

  const byDate = new Map<string, DietEntry[]>();
  for (const entry of (entries ?? []) as DietEntry[]) {
    const list = byDate.get(entry.date) ?? [];
    list.push(entry);
    byDate.set(entry.date, list);
  }

  const out: DayTotals[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const dayEntries = byDate.get(date) ?? [];
    const stated = completenessByDate.get(date)?.completeness;
    out.push({
      date,
      ...sumMacros(dayEntries),
      // A day with no entries and no explicit marking is untracked, not a zero-calorie day.
      completeness: stated ?? (dayEntries.length ? "complete" : "untracked"),
      entryCount: dayEntries.length,
    });
  }
  return out;
}

export async function listFoodItems(): Promise<FoodItem[]> {
  await requireUser();
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("food_items")
    .select("*")
    .order("is_default", { ascending: false })
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as FoodItem[];
}

export async function listRecipes(): Promise<Recipe[]> {
  await requireUser();
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("recipes")
    .select("id, name, servings, notes, recipe_items ( * )")
    .order("name");
  if (error) throw new Error(error.message);
  const recipes = (data ?? []) as unknown as Recipe[];
  for (const r of recipes) r.recipe_items?.sort((a, b) => a.position - b.position);
  return recipes;
}

export function recipeTotals(recipe: Recipe): MacroTotals {
  return sumMacros(recipe.recipe_items ?? []);
}

// -----------------------------------------------------------------------------
// Search
// -----------------------------------------------------------------------------

/** A LIKE pattern matching `q` anywhere, with LIKE's own wildcards escaped. */
function containsPattern(q: string) {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export type FoodSearchResult = {
  foods: FoodItem[];
  recipes: Recipe[];
  /** Matching log entries, newest first. */
  entries: DietEntry[];
};

/**
 * Searches saved foods (name or brand), recipes, and everything ever logged
 * (name or note). Case-insensitive substring match: at personal scale — a few
 * thousand entries — that's instant without a search index.
 */
export async function searchFood(q: string, limit = 60): Promise<FoodSearchResult> {
  await requireUser();
  const supabase = await getSupabase();
  const like = containsPattern(q.trim());

  const [byName, byBrand, recipes, entriesByName, entriesByNote] = await Promise.all([
    supabase.from("food_items").select("*").ilike("name", like).order("name"),
    supabase.from("food_items").select("*").ilike("brand", like).order("name"),
    supabase
      .from("recipes")
      .select("id, name, servings, notes, recipe_items ( * )")
      .ilike("name", like)
      .order("name"),
    supabase
      .from("diet_entries")
      .select("*")
      .ilike("name", like)
      .order("date", { ascending: false })
      .limit(limit),
    supabase
      .from("diet_entries")
      .select("*")
      .ilike("notes", like)
      .order("date", { ascending: false })
      .limit(limit),
  ]);
  for (const r of [byName, byBrand, recipes, entriesByName, entriesByNote]) {
    if (r.error) throw new Error(r.error.message);
  }

  const unique = <T extends { id: string }>(...lists: (T[] | null)[]) => {
    const seen = new Map<string, T>();
    for (const list of lists) for (const item of list ?? []) seen.set(item.id, item);
    return [...seen.values()];
  };

  const entries = unique(entriesByName.data as DietEntry[], entriesByNote.data as DietEntry[])
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, limit);

  return {
    foods: unique(byName.data as FoodItem[], byBrand.data as FoodItem[]),
    recipes: (recipes.data ?? []) as unknown as Recipe[],
    entries,
  };
}

/**
 * The foods logged most often recently, each with its latest entry — what the
 * search page shows before you type, for one-tap re-logging.
 */
export async function frequentFoods(days = 60, top = 12) {
  await requireUser();
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("diet_entries")
    .select("*")
    .gte("date", addDays(todayISO(), -days))
    .order("date", { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);

  const groups = new Map<string, { latest: DietEntry; count: number }>();
  for (const e of (data ?? []) as DietEntry[]) {
    const key = e.name.trim().toLowerCase();
    const g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { latest: e, count: 1 });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, top);
}

// -----------------------------------------------------------------------------
// Targets & bodyweight
// -----------------------------------------------------------------------------

export async function getCurrentTarget(): Promise<Target | null> {
  await requireUser();
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("targets")
    .select("*")
    .lte("effective_from", todayISO())
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Target) ?? null;
}

export async function listBodyweight(limit = 180): Promise<BodyweightLog[]> {
  await requireUser();
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("bodyweight_logs")
    .select("*")
    .order("date", { ascending: false })
    .order("logged_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as BodyweightLog[];
}

export async function latestBodyweight(): Promise<BodyweightLog | null> {
  const logs = await listBodyweight(1);
  return logs[0] ?? null;
}

/**
 * The effective protein target. When protein_mode is 'bodyweight' this is
 * recomputed from the most recent weigh-in, so the target follows the user
 * instead of going stale the moment their weight changes.
 */
export async function resolveTargets(): Promise<{
  target: Target | null;
  proteinTarget: number | null;
  bodyweightLbs: number | null;
}> {
  const [target, bw] = await Promise.all([getCurrentTarget(), latestBodyweight()]);
  const bodyweightLbs = bw?.weight_lbs ?? null;

  let proteinTarget: number | null = target?.protein_g ?? null;
  if (target?.protein_mode === "bodyweight" && bodyweightLbs) {
    proteinTarget = Math.round(bodyweightLbs * (target.protein_multiplier ?? 0.8));
  }
  return { target, proteinTarget, bodyweightLbs };
}
