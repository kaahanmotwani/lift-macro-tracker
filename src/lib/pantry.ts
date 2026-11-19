import "server-only";
import { getSupabase } from "@/lib/supabase/server";
import { listFoodItems, listRecipes, recipeTotals } from "@/lib/data";
import { matchKey } from "@/lib/units";
import type { Macros, PantryItem } from "@/lib/pantry-link";

export { linkToPantry, pantryPrompt, type PantryItem } from "@/lib/pantry-link";

/**
 * "Pantry" = the user's saved foods and recipes, in the form the AI and the
 * importer need.
 *
 * How saved items get used during a text import:
 *   1. The list goes into the prompt with a short ref per item ("F3", "R1").
 *   2. Claude marks an entry with a ref when it recognizes the food, and says
 *      how much was eaten.
 *   3. `linkToPantry` then *recomputes* that entry's macros from the saved
 *      values. Claude only decides which item it is and how much; the numbers
 *      always come from what the user saved, so they can't be misquoted.
 *
 * Refs are only meaningful within one request, which is why linking happens
 * right after parsing, before the result is stored.
 */

/** Plenty for a personal pantry, and keeps the prompt small. */
const MAX_ITEMS = 300;

export async function loadPantry(): Promise<PantryItem[]> {
  const [foods, recipes] = await Promise.all([listFoodItems(), listRecipes()]);

  const items: PantryItem[] = foods.map((f, i) => ({
    ref: `F${i + 1}`,
    kind: "food",
    id: f.id,
    name: f.name,
    brand: f.brand,
    isDefault: f.is_default,
    servingQty: Number(f.serving_qty) || 1,
    servingUnit: f.serving_unit || "serving",
    perServing: {
      kcal: f.kcal,
      protein_g: f.protein_g,
      carbs_g: f.carbs_g,
      fat_g: f.fat_g,
      fiber_g: f.fiber_g,
    },
  }));

  recipes.forEach((r, i) => {
    const totals = recipeTotals(r);
    const servings = Number(r.servings) || 1;
    items.push({
      ref: `R${i + 1}`,
      kind: "recipe",
      id: r.id,
      name: r.name,
      brand: null,
      isDefault: false,
      servingQty: 1,
      servingUnit: "serving",
      perServing: {
        kcal: totals.kcal / servings,
        protein_g: totals.protein_g / servings,
        carbs_g: totals.carbs_g / servings,
        fat_g: totals.fat_g / servings,
        fiber_g: totals.fiber_g / servings,
      },
    });
  });

  return items.slice(0, MAX_ITEMS);
}

/**
 * Saves (or updates) a food in the user's saved foods from something they
 * logged. Keyed by name + brand, so remembering the same food again updates it
 * rather than adding a duplicate. Leaves an existing "default brand" mark alone.
 */
export async function rememberFood(
  userId: string,
  food: {
    name: string;
    brand?: string | null;
    qty: number | null;
    unit: string | null;
  } & Macros,
): Promise<void> {
  // Nothing worth remembering without numbers.
  if (food.kcal === null && food.protein_g === null && food.carbs_g === null && food.fat_g === null) {
    return;
  }
  const supabase = await getSupabase();
  const { error } = await supabase.from("food_items").upsert(
    {
      user_id: userId,
      name: food.name,
      brand: food.brand ?? null,
      serving_qty: food.qty && food.qty > 0 ? food.qty : 1,
      serving_unit: food.unit || "serving",
      kcal: food.kcal,
      protein_g: food.protein_g,
      carbs_g: food.carbs_g,
      fat_g: food.fat_g,
      fiber_g: food.fiber_g,
      match_key: matchKey(food.name, food.brand),
    },
    { onConflict: "user_id,match_key" },
  );
  if (error) throw new Error(`Remembering "${food.name}": ${error.message}`);
}
