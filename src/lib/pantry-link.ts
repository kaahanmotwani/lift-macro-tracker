import { matchKey } from "@/lib/units";
import type { ImportResult, LinkedDietEntry } from "@/lib/ai/schemas";

/**
 * The pure half of lib/pantry.ts: turning saved foods into prompt text, and
 * matching parsed entries back to them. No database or server imports, so it
 * can be tested on its own.
 */

export type Macros = {
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
};

export type PantryItem = {
  ref: string;
  kind: "food" | "recipe";
  id: string;
  name: string;
  brand: string | null;
  isDefault: boolean;
  /** One serving: e.g. 170 g of yogurt, or 1 serving of a recipe. */
  servingQty: number;
  servingUnit: string;
  perServing: Macros;
};

const r1 = (n: number | null) => (n === null ? "?" : String(Math.round(n * 10) / 10));

/** The pantry as prompt text, or "" when there's nothing saved. */
export function pantryPrompt(items: PantryItem[]): string {
  if (items.length === 0) return "";
  const lines = items.map((it) => {
    const label =
      it.kind === "recipe"
        ? `${it.name} (recipe)`
        : `${it.name}${it.brand ? ` — ${it.brand}` : ""}${it.isDefault ? ` [default for "${it.name}"]` : ""}`;
    const m = it.perServing;
    return `${it.ref} | ${label} | per ${r1(it.servingQty)} ${it.servingUnit}: ${r1(m.kcal)} kcal, P${r1(m.protein_g)} C${r1(m.carbs_g)} F${r1(m.fat_g)} Fib${r1(m.fiber_g)}`;
  });

  return `The user's saved foods and recipes. Their numbers are exact and beat any estimate.
${lines.join("\n")}

How to use them:
- When a food in the notes is one of these, set saved_ref to its ref.
- Then set qty and unit to how much was eaten, either in the saved serving's unit
  ("200" + "g") or as servings ("1.5" + "serving"). No amount stated → qty 1, unit "serving".
- A generic name ("greek yogurt") means the item marked default for that name, unless
  the notes name a different brand.
- Only match when it is clearly the same food. "oats" is not "overnight oats".
- You may leave the macros of a matched entry as your best guess; the app replaces them
  with the saved values.`;
}

function sameUnit(a: string | null | undefined, b: string | null | undefined) {
  const norm = (u: string) => u.trim().toLowerCase().replace(/s$/, "").replace(/^gram$/, "g");
  return !!a && !!b && norm(a) === norm(b);
}

/** How many servings of `item` the entry describes, or null if the units don't line up. */
function servingsOf(entry: LinkedDietEntry, item: PantryItem): number | null {
  if (entry.qty === null || entry.qty === undefined) return 1;
  if (!entry.unit || /^servings?$/i.test(entry.unit)) return entry.qty;
  if (sameUnit(entry.unit, item.servingUnit)) return entry.qty / item.servingQty;
  return null;
}

function linkEntry(
  entry: LinkedDietEntry,
  item: PantryItem,
  servings: number,
): LinkedDietEntry {
  const scale = (v: number | null) => (v === null ? null : Math.round(v * servings * 10) / 10);
  const isRecipe = item.kind === "recipe";
  return {
    ...entry,
    name: item.name,
    brand: item.brand,
    qty: isRecipe ? Math.round(servings * 100) / 100 : Math.round(servings * item.servingQty * 10) / 10,
    unit: isRecipe ? "serving" : item.servingUnit,
    kcal: scale(item.perServing.kcal),
    protein_g: scale(item.perServing.protein_g),
    carbs_g: scale(item.perServing.carbs_g),
    fat_g: scale(item.perServing.fat_g),
    fiber_g: scale(item.perServing.fiber_g),
    confidence: "high",
    note: [entry.note, `Macros from your saved ${isRecipe ? "recipe" : "food"}`]
      .filter(Boolean)
      .join(" · "),
    food_item_id: isRecipe ? null : item.id,
    recipe_id: isRecipe ? item.id : null,
  };
}

/**
 * Replaces Claude's numbers with saved ones wherever an entry matches a saved
 * item: first by the ref Claude chose, then — as a safety net — by exact name
 * against a default brand when Claude only estimated and named no brand.
 */
export function linkToPantry(result: ImportResult, items: PantryItem[]): ImportResult {
  if (items.length === 0) return result;
  const byRef = new Map(items.map((it) => [it.ref.toUpperCase(), it]));
  const defaults = new Map(
    items.filter((it) => it.kind === "food" && it.isDefault).map((it) => [matchKey(it.name), it]),
  );

  return {
    ...result,
    diet_days: result.diet_days.map((day) => ({
      ...day,
      entries: day.entries.map((raw) => {
        const entry = raw as LinkedDietEntry;
        const ref = entry.saved_ref?.trim().toUpperCase();
        const byClaude = ref ? byRef.get(ref) : undefined;
        if (byClaude) {
          const servings = servingsOf(entry, byClaude);
          if (servings !== null) return linkEntry(entry, byClaude, servings);
        }
        const fallback =
          !entry.brand && entry.confidence !== "high" ? defaults.get(matchKey(entry.name)) : undefined;
        if (fallback) {
          const servings = servingsOf(entry, fallback);
          if (servings !== null) return linkEntry(entry, fallback, servings);
        }
        return entry;
      }),
    })),
  };
}
