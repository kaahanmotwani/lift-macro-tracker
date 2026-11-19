"use server";

import { revalidatePath } from "next/cache";
import { getSupabase, requireUser } from "@/lib/supabase/server";
import { kcalFromMacros, matchKey, todayISO } from "@/lib/units";
import { getDietEntries } from "@/lib/data";
import type { ActionResult } from "@/lib/types";

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

/** Micros come from the AI as a name/amount list; we store them as a flat object. */
function microsFromForm(fd: FormData): Record<string, string> {
  const raw = str(fd, "micros_json");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

// -----------------------------------------------------------------------------
// Daily entries
// -----------------------------------------------------------------------------

export async function upsertDietEntry(fd: FormData): Promise<void> {
  const user = await requireUser();
  const supabase = await getSupabase();
  const id = str(fd, "id");
  const date = str(fd, "date") ?? todayISO();
  const name = str(fd, "name");
  if (!name) return;

  const protein = num(fd, "protein_g");
  const carbs = num(fd, "carbs_g");
  const fat = num(fd, "fat_g");
  let kcal = num(fd, "kcal");
  // If the user gave macros but no calories, derive them rather than showing a
  // blank — 4/4/9 is exact enough and one less field to fill in on a phone.
  if (kcal === null && (protein !== null || carbs !== null || fat !== null)) {
    kcal = Math.round(kcalFromMacros(protein, carbs, fat));
  }

  const row = {
    user_id: user.id,
    date,
    meal: (str(fd, "meal") ?? "unspecified") as string,
    name,
    qty: num(fd, "qty"),
    unit: str(fd, "unit"),
    kcal,
    protein_g: protein,
    carbs_g: carbs,
    fat_g: fat,
    fiber_g: num(fd, "fiber_g"),
    notes: str(fd, "notes"),
    source: str(fd, "source") ?? "manual",
    confidence: str(fd, "confidence"),
    food_item_id: str(fd, "food_item_id"),
    recipe_id: str(fd, "recipe_id"),
  };

  if (id) {
    await supabase.from("diet_entries").update(row).eq("id", id);
  } else {
    const existing = await getDietEntries(date);
    await supabase.from("diet_entries").insert({ ...row, position: existing.length });
    // Touch the day so it isn't treated as untracked.
    await ensureDietDay(date);
  }
  revalidatePath("/diet");
}

export async function deleteDietEntry(fd: FormData): Promise<void> {
  await requireUser();
  const supabase = await getSupabase();
  const id = str(fd, "id");
  if (!id) return;
  await supabase.from("diet_entries").delete().eq("id", id);
  revalidatePath("/diet");
}

async function ensureDietDay(date: string) {
  const user = await requireUser();
  const supabase = await getSupabase();
  await supabase
    .from("diet_days")
    .upsert({ user_id: user.id, date }, { onConflict: "user_id,date", ignoreDuplicates: true });
}

/**
 * Marks how complete a day's logging was. This is what keeps analytics honest:
 * a day the user forgot to log dinner must not show up as a 900-calorie day in
 * the trend line.
 */
export async function setDayCompleteness(fd: FormData): Promise<void> {
  const user = await requireUser();
  const supabase = await getSupabase();
  const date = str(fd, "date");
  if (!date) return;
  await supabase.from("diet_days").upsert(
    {
      user_id: user.id,
      date,
      completeness: str(fd, "completeness") ?? "complete",
      completeness_note: str(fd, "completeness_note"),
    },
    { onConflict: "user_id,date" },
  );
  revalidatePath("/diet");
  revalidatePath("/insights");
}

/** Adds a saved recipe's macros to a day, scaled by the number of servings eaten. */
export async function logRecipe(fd: FormData): Promise<void> {
  const user = await requireUser();
  const supabase = await getSupabase();
  const recipeId = str(fd, "recipe_id");
  const date = str(fd, "date") ?? todayISO();
  const servings = num(fd, "servings") ?? 1;
  if (!recipeId) return;

  const { data: recipe } = await supabase
    .from("recipes")
    .select("id, name, servings, recipe_items ( * )")
    .eq("id", recipeId)
    .single();
  if (!recipe) return;

  const items = (recipe.recipe_items ?? []) as any[];
  const perRecipe = items.reduce(
    (acc, i) => ({
      kcal: acc.kcal + (i.kcal ?? 0),
      protein_g: acc.protein_g + (i.protein_g ?? 0),
      carbs_g: acc.carbs_g + (i.carbs_g ?? 0),
      fat_g: acc.fat_g + (i.fat_g ?? 0),
      fiber_g: acc.fiber_g + (i.fiber_g ?? 0),
    }),
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
  );

  const scale = servings / (recipe.servings || 1);
  const existing = await getDietEntries(date);

  await supabase.from("diet_entries").insert({
    user_id: user.id,
    date,
    meal: str(fd, "meal") ?? "unspecified",
    position: existing.length,
    name: recipe.name,
    qty: servings,
    unit: "serving",
    kcal: Math.round(perRecipe.kcal * scale),
    protein_g: Math.round(perRecipe.protein_g * scale * 10) / 10,
    carbs_g: Math.round(perRecipe.carbs_g * scale * 10) / 10,
    fat_g: Math.round(perRecipe.fat_g * scale * 10) / 10,
    fiber_g: Math.round(perRecipe.fiber_g * scale * 10) / 10,
    source: "recipe",
    confidence: "high",
    recipe_id: recipe.id,
  });
  await ensureDietDay(date);
  revalidatePath("/diet");
}

/** Adds a saved food, scaled by how many servings were eaten. */
export async function logFoodItem(fd: FormData): Promise<void> {
  const user = await requireUser();
  const supabase = await getSupabase();
  const foodId = str(fd, "food_item_id");
  const date = str(fd, "date") ?? todayISO();
  const qty = num(fd, "qty") ?? 1;
  if (!foodId) return;

  const { data: food } = await supabase.from("food_items").select("*").eq("id", foodId).single();
  if (!food) return;

  const scale = qty / (food.serving_qty || 1);
  const existing = await getDietEntries(date);
  const scaled = (v: number | null) => (v === null ? null : Math.round(v * scale * 10) / 10);

  await supabase.from("diet_entries").insert({
    user_id: user.id,
    date,
    meal: str(fd, "meal") ?? "unspecified",
    position: existing.length,
    name: food.brand ? `${food.name} (${food.brand})` : food.name,
    qty,
    unit: food.serving_unit,
    kcal: scaled(food.kcal),
    protein_g: scaled(food.protein_g),
    carbs_g: scaled(food.carbs_g),
    fat_g: scaled(food.fat_g),
    fiber_g: scaled(food.fiber_g),
    micros: food.micros ?? {},
    source: "food_item",
    confidence: "high",
    food_item_id: food.id,
  });
  await ensureDietDay(date);
  revalidatePath("/diet");
}

// -----------------------------------------------------------------------------
// Saved foods (brand defaults)
// -----------------------------------------------------------------------------

export async function upsertFoodItem(fd: FormData): Promise<void> {
  const user = await requireUser();
  const supabase = await getSupabase();
  const id = str(fd, "id");
  const name = str(fd, "name");
  if (!name) return;

  const brand = str(fd, "brand");
  const isDefault = bool(fd, "is_default");

  // Only one brand can be the default for a given food name, so clear the old
  // one first — the partial unique index would otherwise reject the write.
  if (isDefault) {
    await supabase
      .from("food_items")
      .update({ is_default: false })
      .eq("is_default", true)
      .ilike("name", name);
  }

  const row = {
    user_id: user.id,
    name,
    brand,
    is_default: isDefault,
    serving_qty: num(fd, "serving_qty") ?? 1,
    serving_unit: str(fd, "serving_unit") ?? "serving",
    kcal: num(fd, "kcal"),
    protein_g: num(fd, "protein_g"),
    carbs_g: num(fd, "carbs_g"),
    fat_g: num(fd, "fat_g"),
    fiber_g: num(fd, "fiber_g"),
    micros: microsFromForm(fd),
    notes: str(fd, "notes"),
    match_key: matchKey(name, brand),
  };

  if (id) {
    await supabase.from("food_items").update(row).eq("id", id);
  } else {
    await supabase.from("food_items").upsert(row, { onConflict: "user_id,match_key" });
  }
  revalidatePath("/diet/foods");
  revalidatePath("/diet");
}

export async function deleteFoodItem(fd: FormData): Promise<void> {
  await requireUser();
  const supabase = await getSupabase();
  const id = str(fd, "id");
  if (!id) return;
  await supabase.from("food_items").delete().eq("id", id);
  revalidatePath("/diet/foods");
}

// -----------------------------------------------------------------------------
// Recipes
// -----------------------------------------------------------------------------

export async function upsertRecipe(fd: FormData): Promise<void> {
  const user = await requireUser();
  const supabase = await getSupabase();
  const id = str(fd, "id");
  const name = str(fd, "name");
  if (!name) return;

  const row = {
    user_id: user.id,
    name,
    servings: num(fd, "servings") ?? 1,
    notes: str(fd, "notes"),
  };

  if (id) {
    await supabase.from("recipes").update(row).eq("id", id);
  } else {
    await supabase.from("recipes").insert(row);
  }
  revalidatePath("/diet/recipes");
}

export async function deleteRecipe(fd: FormData): Promise<void> {
  await requireUser();
  const supabase = await getSupabase();
  const id = str(fd, "id");
  if (!id) return;
  await supabase.from("recipes").delete().eq("id", id);
  revalidatePath("/diet/recipes");
}

export async function addRecipeItem(fd: FormData): Promise<void> {
  const user = await requireUser();
  const supabase = await getSupabase();
  const recipeId = str(fd, "recipe_id");
  const name = str(fd, "name");
  if (!recipeId || !name) return;

  const { count } = await supabase
    .from("recipe_items")
    .select("id", { count: "exact", head: true })
    .eq("recipe_id", recipeId);

  const protein = num(fd, "protein_g");
  const carbs = num(fd, "carbs_g");
  const fat = num(fd, "fat_g");
  let kcal = num(fd, "kcal");
  if (kcal === null && (protein !== null || carbs !== null || fat !== null)) {
    kcal = Math.round(kcalFromMacros(protein, carbs, fat));
  }

  await supabase.from("recipe_items").insert({
    user_id: user.id,
    recipe_id: recipeId,
    position: count ?? 0,
    name,
    qty: num(fd, "qty"),
    unit: str(fd, "unit"),
    kcal,
    protein_g: protein,
    carbs_g: carbs,
    fat_g: fat,
    fiber_g: num(fd, "fiber_g"),
    food_item_id: str(fd, "food_item_id"),
  });
  revalidatePath("/diet/recipes");
}

export async function deleteRecipeItem(fd: FormData): Promise<void> {
  await requireUser();
  const supabase = await getSupabase();
  const id = str(fd, "id");
  if (!id) return;
  await supabase.from("recipe_items").delete().eq("id", id);
  revalidatePath("/diet/recipes");
}

// -----------------------------------------------------------------------------
// Targets
// -----------------------------------------------------------------------------

/** Bound with <ActionForm>, so useActionState passes the previous result first. */
export async function saveTargets(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const supabase = await getSupabase();

  const { error } = await supabase.from("targets").upsert(
    {
      user_id: user.id,
      effective_from: str(fd, "effective_from") ?? todayISO(),
      kcal: num(fd, "kcal"),
      protein_g: num(fd, "protein_g"),
      carbs_g: num(fd, "carbs_g"),
      fat_g: num(fd, "fat_g"),
      fiber_g: num(fd, "fiber_g"),
      protein_mode: str(fd, "protein_mode") ?? "bodyweight",
      protein_multiplier: num(fd, "protein_multiplier") ?? 0.8,
    },
    { onConflict: "user_id,effective_from" },
  );

  if (error) return { ok: false, error: error.message };
  revalidatePath("/diet");
  revalidatePath("/settings");
  return { ok: true, message: "Targets saved." };
}
