export type WeightUnit = "lb" | "kg";
export type Completeness = "complete" | "partial" | "untracked";
export type Meal = "breakfast" | "lunch" | "dinner" | "snack" | "unspecified";
export type Confidence = "high" | "medium" | "low";

export type Exercise = {
  id: string;
  user_id: string;
  name: string;
  equipment: string | null;
  grip: string | null;
  angle: string | null;
  variant: string | null;
  gym: string | null;
  primary_muscles: string[];
  secondary_muscles: string[];
  starting_resistance_lbs: number;
  unilateral: boolean;
  notes: string | null;
  match_key: string;
  archived: boolean;
};

export type SetSegment = {
  id: string;
  set_id: string;
  segment_index: number;
  weight_lbs: number | null;
  reps: number | null;
  notes: string | null;
};

export type WorkoutSet = {
  id: string;
  workout_exercise_id: string;
  set_index: number;
  is_warmup: boolean;
  rpe: number | null;
  notes: string | null;
  set_segments: SetSegment[];
};

export type WorkoutExercise = {
  id: string;
  workout_id: string;
  exercise_id: string;
  position: number;
  notes: string | null;
  exercises: Exercise;
  workout_sets: WorkoutSet[];
};

export type Workout = {
  id: string;
  user_id: string;
  date: string;
  title: string | null;
  gym: string | null;
  notes: string | null;
  workout_exercises: WorkoutExercise[];
};

export type FoodItem = {
  id: string;
  name: string;
  brand: string | null;
  is_default: boolean;
  serving_qty: number;
  serving_unit: string;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  micros: Record<string, string>;
  notes: string | null;
  match_key: string;
};

export type RecipeItem = {
  id: string;
  recipe_id: string;
  food_item_id: string | null;
  position: number;
  name: string;
  qty: number | null;
  unit: string | null;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
};

export type Recipe = {
  id: string;
  name: string;
  servings: number;
  notes: string | null;
  recipe_items: RecipeItem[];
};

export type DietEntry = {
  id: string;
  date: string;
  meal: Meal;
  position: number;
  name: string;
  qty: number | null;
  unit: string | null;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  micros: Record<string, string>;
  source: string;
  confidence: Confidence | null;
  food_item_id: string | null;
  recipe_id: string | null;
  photo_path: string | null;
  notes: string | null;
};

export type DietDay = {
  id: string;
  date: string;
  completeness: Completeness;
  completeness_note: string | null;
  ai_micro_summary: string | null;
  ai_micro_data: unknown;
  ai_summary_at: string | null;
  notes: string | null;
};

export type Target = {
  id: string;
  effective_from: string;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  protein_mode: "bodyweight" | "manual";
  protein_multiplier: number;
};

export type BodyweightLog = {
  id: string;
  date: string;
  logged_at: string | null;
  weight_lbs: number;
  note: string | null;
};

export type MacroTotals = {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
};

export type DayTotals = MacroTotals & {
  date: string;
  completeness: Completeness;
  entryCount: number;
};

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string };
