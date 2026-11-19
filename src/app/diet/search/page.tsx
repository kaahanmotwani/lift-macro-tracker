import Link from "next/link";
import { frequentFoods, recipeTotals, searchFood, sumMacros } from "@/lib/data";
import { logFoodItem, logRecipe, relogEntry } from "@/app/actions/diet";
import { Badge, Button, Card, Empty, Input, Select } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { TopBar } from "@/components/nav";
import { formatDate, todayISO } from "@/lib/units";
import type { DietEntry } from "@/lib/types";

export const metadata = { title: "Search food" };

const MEALS = ["breakfast", "lunch", "dinner", "snack", "unspecified"] as const;

const r = (n: number | null | undefined) => Math.round(n ?? 0);
const macroLine = (m: {
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
}) => `${r(m.kcal)} kcal · P${r(m.protein_g)} · C${r(m.carbs_g)} · F${r(m.fat_g)} · Fib${r(m.fiber_g)}`;

/**
 * One search box over everything food-related: saved foods, recipes, and the
 * whole diet log. Every result has an "Add" button that logs it to the day you
 * came from (today by default) and takes you back there.
 */
export default async function FoodSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; date?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const date = sp.date ?? todayISO();

  const results = q ? await searchFood(q) : null;
  const frequent = q ? [] : await frequentFoods();

  return (
    <main>
      <TopBar
        title="Search food"
        right={
          <Link href={`/diet?date=${date}`} className="text-sm text-muted">
            Back
          </Link>
        }
      />

      <div className="space-y-4">
        <form className="flex gap-2" role="search">
          <input type="hidden" name="date" value={date} />
          <Input
            name="q"
            type="search"
            defaultValue={q}
            placeholder="oats, fage, chipotle…"
            autoFocus
            aria-label="Search foods, recipes and your log"
          />
          <Button type="submit" className="shrink-0">
            Search
          </Button>
        </form>
        <p className="text-xs text-muted">
          Adding a result logs it to <span className="text-fg">{formatDate(date)}</span>.
        </p>

        {!results && (
          <Card title="Logged most in the last 60 days">
            {frequent.length === 0 ? (
              <Empty title="Nothing logged yet">Your most-eaten foods will show up here.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {frequent.map(({ latest, count }) => (
                  <EntryRow key={latest.id} entry={latest} date={date} extra={`${count}×`} />
                ))}
              </ul>
            )}
          </Card>
        )}

        {results && (
          <>
            {results.foods.length + results.recipes.length + results.entries.length === 0 && (
              <Empty title={`Nothing matches “${q}”`}>
                Try a shorter word, or{" "}
                <Link href="/diet/foods" className="text-accent">
                  save it as a food
                </Link>
                .
              </Empty>
            )}

            {results.recipes.length > 0 && (
              <Card title="Your recipes">
                <ul className="divide-y divide-line">
                  {results.recipes.map((recipe) => {
                    const servings = Number(recipe.servings) || 1;
                    const t = recipeTotals(recipe);
                    return (
                      <li key={recipe.id} className="py-2.5">
                        <p className="text-sm font-medium">{recipe.name}</p>
                        <p className="tabular text-xs text-muted">
                          per serving ·{" "}
                          {macroLine({
                            kcal: t.kcal / servings,
                            protein_g: t.protein_g / servings,
                            carbs_g: t.carbs_g / servings,
                            fat_g: t.fat_g / servings,
                            fiber_g: t.fiber_g / servings,
                          })}
                        </p>
                        <form action={logRecipe} className="mt-2 flex items-end gap-2">
                          <input type="hidden" name="recipe_id" value={recipe.id} />
                          <input type="hidden" name="date" value={date} />
                          <input type="hidden" name="back_to_day" value="true" />
                          <AmountAndMeal name="servings" label="servings" />
                          <SubmitButton variant="secondary">Add</SubmitButton>
                        </form>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}

            {results.foods.length > 0 && (
              <Card title="Your saved foods">
                <ul className="divide-y divide-line">
                  {results.foods.map((f) => (
                    <li key={f.id} className="py-2.5">
                      <p className="text-sm font-medium">
                        {f.name}
                        {f.brand && <span className="text-muted"> — {f.brand}</span>}
                        {f.is_default && (
                          <span className="ml-2">
                            <Badge tone="good">default</Badge>
                          </span>
                        )}
                      </p>
                      <p className="tabular text-xs text-muted">
                        per {f.serving_qty} {f.serving_unit} · {macroLine(f)}
                      </p>
                      <form action={logFoodItem} className="mt-2 flex items-end gap-2">
                        <input type="hidden" name="food_item_id" value={f.id} />
                        <input type="hidden" name="date" value={date} />
                        <input type="hidden" name="back_to_day" value="true" />
                        <AmountAndMeal
                          name="qty"
                          label={f.serving_unit}
                          defaultValue={String(f.serving_qty)}
                        />
                        <SubmitButton variant="secondary">Add</SubmitButton>
                      </form>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {results.entries.length > 0 && (
              <Card title="From your log">
                <HistorySummary entries={results.entries} />
                <ul className="divide-y divide-line">
                  {results.entries.map((e) => (
                    <EntryRow key={e.id} entry={e} date={date} showDate />
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function AmountAndMeal({
  name,
  label,
  defaultValue = "1",
}: {
  name: string;
  label: string;
  defaultValue?: string;
}) {
  return (
    <>
      <label className="w-24 text-xs text-muted">
        {label}
        <Input name={name} type="number" step="0.25" inputMode="decimal" defaultValue={defaultValue} />
      </label>
      <label className="flex-1 text-xs text-muted">
        meal
        <Select name="meal" defaultValue="unspecified">
          {MEALS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </Select>
      </label>
    </>
  );
}

/** "Eaten 14 times since Mar 3 · usually 420 kcal, 32 g protein". */
function HistorySummary({ entries }: { entries: DietEntry[] }) {
  const n = entries.length;
  const avg = sumMacros(entries);
  const oldest = entries[entries.length - 1]?.date;
  return (
    <p className="mb-2 text-xs text-muted">
      {n} entr{n === 1 ? "y" : "ies"}
      {n >= 60 ? " (most recent shown)" : ""}
      {oldest ? ` since ${formatDate(oldest)}` : ""} · avg {r(avg.kcal / n)} kcal, {r(avg.protein_g / n)} g
      protein per entry
    </p>
  );
}

function EntryRow({
  entry: e,
  date,
  showDate,
  extra,
}: {
  entry: DietEntry;
  date: string;
  showDate?: boolean;
  extra?: string;
}) {
  return (
    <li className="flex items-start justify-between gap-2 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {e.name}
          {extra && <span className="ml-2 text-xs font-normal text-muted">{extra}</span>}
        </p>
        <p className="tabular text-xs text-muted">
          {e.qty ? `${e.qty}${e.unit ? ` ${e.unit}` : ""} · ` : ""}
          {macroLine(e)}
        </p>
        <p className="text-xs text-muted">
          {showDate ? (
            <Link href={`/diet?date=${e.date}`} className="text-accent">
              {formatDate(e.date)}
            </Link>
          ) : (
            <>last {formatDate(e.date)}</>
          )}{" "}
          · {e.meal}
        </p>
      </div>
      <form action={relogEntry}>
        <input type="hidden" name="id" value={e.id} />
        <input type="hidden" name="date" value={date} />
        <input type="hidden" name="back_to_day" value="true" />
        <SubmitButton variant="secondary">Add again</SubmitButton>
      </form>
    </li>
  );
}
