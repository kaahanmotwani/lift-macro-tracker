import Link from "next/link";
import {
  dailyTotals,
  getDietDay,
  getDietEntries,
  listFoodItems,
  listRecipes,
  resolveTargets,
  sumMacros,
} from "@/lib/data";
import {
  deleteDietEntry,
  logFoodItem,
  logRecipe,
  setDayCompleteness,
  upsertDietEntry,
} from "@/app/actions/diet";
import { summarizeMicros } from "@/app/actions/insights";
import { Badge, Card, Empty, Field, Input, Select, Stat, TargetBar, Textarea } from "@/components/ui";
import { ActionForm, MiniSubmit, SubmitButton, Disclosure } from "@/components/form";
import { LineChart, SERIES, StackedBarChart } from "@/components/charts";
import { TopBar } from "@/components/nav";
import { addDays, formatDate, todayISO } from "@/lib/units";

export const metadata = { title: "Diet" };

const MEALS = ["breakfast", "lunch", "dinner", "snack", "unspecified"] as const;

export default async function DietPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; range?: string }>;
}) {
  const sp = await searchParams;
  const date = sp.date ?? todayISO();
  const range = Number(sp.range) || 30;

  const [entries, day, targets, foods, recipes, totalsSeries] = await Promise.all([
    getDietEntries(date),
    getDietDay(date),
    resolveTargets(),
    listFoodItems(),
    listRecipes(),
    dailyTotals(range),
  ]);

  const totals = sumMacros(entries);
  const completeness = day?.completeness ?? (entries.length ? "complete" : "untracked");

  return (
    <main>
      <TopBar
        title="Diet"
        right={
          <span className="flex gap-3 text-sm">
            <Link href="/diet/foods" className="text-accent">
              Foods
            </Link>
            <Link href="/diet/recipes" className="text-accent">
              Recipes
            </Link>
          </span>
        }
      />

      <div className="space-y-4">
        {/* Day picker */}
        <div className="flex items-center gap-2">
          <Link
            href={`/diet?date=${addDays(date, -1)}&range=${range}`}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-line"
            aria-label="Previous day"
          >
            ‹
          </Link>
          {/* A plain GET form: picking a date and submitting navigates. Works
              without JavaScript, which is the point. */}
          <form className="flex flex-1 gap-2">
            <input type="hidden" name="range" value={range} />
            <Input type="date" name="date" defaultValue={date} className="text-center" />
            <button
              type="submit"
              className="min-h-11 shrink-0 rounded-xl border border-line px-3 text-sm text-accent"
            >
              Go
            </button>
          </form>
          <Link
            href={`/diet?date=${addDays(date, 1)}&range=${range}`}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-line"
            aria-label="Next day"
          >
            ›
          </Link>
        </div>

        <div className="grid grid-cols-4 gap-2">
          <Stat label="kcal" value={Math.round(totals.kcal) || "—"} />
          <Stat label="Protein" value={Math.round(totals.protein_g) || "—"} tone="accent" />
          <Stat label="Carbs" value={Math.round(totals.carbs_g) || "—"} />
          <Stat label="Fat" value={Math.round(totals.fat_g) || "—"} />
        </div>

        <Card title={`${formatDate(date)} — targets`}>
          <div className="space-y-3">
            <TargetBar label="Calories" value={totals.kcal} target={targets.target?.kcal ?? null} unit="kcal" color={SERIES.s1} />
            <TargetBar label="Protein" value={totals.protein_g} target={targets.proteinTarget} color={SERIES.s1} />
            <TargetBar label="Carbs" value={totals.carbs_g} target={targets.target?.carbs_g ?? null} color={SERIES.s2} />
            <TargetBar label="Fat" value={totals.fat_g} target={targets.target?.fat_g ?? null} color={SERIES.s3} />
            <TargetBar label="Fiber" value={totals.fiber_g} target={targets.target?.fiber_g ?? null} color={SERIES.s4} />
          </div>
          <p className="mt-3 text-xs text-muted">
            Set targets in{" "}
            <Link href="/settings" className="text-accent">
              Settings
            </Link>
            .
          </p>
        </Card>

        {/* Entries */}
        <Card
          title="Logged today"
          action={<Badge tone={completeness === "complete" ? "good" : "warn"}>{completeness}</Badge>}
        >
          {entries.length === 0 ? (
            <Empty title="Nothing logged for this day">
              Add something below, or{" "}
              <Link href="/import" className="text-accent">
                import from a photo or notes
              </Link>
              .
            </Empty>
          ) : (
            <ul className="divide-y divide-line">
              {entries.map((e) => (
                <li key={e.id} className="py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{e.name}</p>
                      <p className="tabular text-xs text-muted">
                        {e.qty ? `${e.qty}${e.unit ? ` ${e.unit}` : ""} · ` : ""}
                        {Math.round(e.kcal ?? 0)} kcal · P{Math.round(e.protein_g ?? 0)} · C
                        {Math.round(e.carbs_g ?? 0)} · F{Math.round(e.fat_g ?? 0)} · Fib
                        {Math.round(e.fiber_g ?? 0)}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge>{e.meal}</Badge>
                        {e.confidence && e.confidence !== "high" && (
                          <Badge tone="warn">{e.confidence} confidence</Badge>
                        )}
                        {e.source !== "manual" && <Badge>{e.source.replace("_", " ")}</Badge>}
                      </div>
                      {e.notes && <p className="mt-1 text-xs text-muted">{e.notes}</p>}
                    </div>
                    <form action={deleteDietEntry}>
                      <input type="hidden" name="id" value={e.id} />
                      <MiniSubmit title="Delete entry">×</MiniSubmit>
                    </form>
                  </div>

                  <Disclosure label="Edit">
                    <EntryForm date={date} entry={e} />
                  </Disclosure>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Completeness — the thing that keeps analytics honest */}
        <Card title="How complete is this day's log?">
          <form action={setDayCompleteness} className="space-y-3">
            <input type="hidden" name="date" value={date} />
            <Field
              label="Completeness"
              hint="Days marked partial or untracked are excluded from averages and shown as gaps in charts — a day you forgot to log isn't a low-calorie day."
            >
              <Select name="completeness" defaultValue={completeness}>
                <option value="complete">Complete — everything I ate is here</option>
                <option value="partial">Partial — I missed some things</option>
                <option value="untracked">Untracked — didn&rsquo;t log this day</option>
              </Select>
            </Field>
            <Field label="What's missing?">
              <Input
                name="completeness_note"
                defaultValue={day?.completeness_note ?? ""}
                placeholder="Ate out for dinner, no idea on macros"
              />
            </Field>
            <SubmitButton variant="secondary">Save</SubmitButton>
          </form>
        </Card>

        {/* Add entry */}
        <Card title="Add food">
          <div className="space-y-3">
            <Disclosure label="Type it in" defaultOpen={entries.length === 0}>
              <EntryForm date={date} />
            </Disclosure>

            {foods.length > 0 && (
              <Disclosure label="From saved foods">
                <form action={logFoodItem} className="space-y-2">
                  <input type="hidden" name="date" value={date} />
                  <Field label="Food">
                    <Select name="food_item_id" required>
                      {foods.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                          {f.brand ? ` — ${f.brand}` : ""}
                          {f.is_default ? " (default)" : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Quantity">
                      <Input name="qty" type="number" step="0.25" defaultValue="1" />
                    </Field>
                    <Field label="Meal">
                      <Select name="meal" defaultValue="unspecified">
                        {MEALS.map((m) => (
                          <option key={m}>{m}</option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <SubmitButton>Add</SubmitButton>
                </form>
              </Disclosure>
            )}

            {recipes.length > 0 && (
              <Disclosure label="From saved recipes">
                <form action={logRecipe} className="space-y-2">
                  <input type="hidden" name="date" value={date} />
                  <Field label="Recipe">
                    <Select name="recipe_id" required>
                      {recipes.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Servings">
                      <Input name="servings" type="number" step="0.25" defaultValue="1" />
                    </Field>
                    <Field label="Meal">
                      <Select name="meal" defaultValue="unspecified">
                        {MEALS.map((m) => (
                          <option key={m}>{m}</option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <SubmitButton>Add</SubmitButton>
                </form>
              </Disclosure>
            )}
          </div>
        </Card>

        {/* Micronutrients — generated, never typed */}
        <Card title="Micronutrients">
          {day?.ai_micro_summary ? (
            <p className="text-sm leading-relaxed">{day.ai_micro_summary}</p>
          ) : (
            <p className="text-sm text-muted">
              You never log these by hand — Claude estimates them from what you ate.
            </p>
          )}
          <ActionForm action={summarizeMicros} className="mt-3">
            <input type="hidden" name="date" value={date} />
            <SubmitButton variant="secondary" pendingLabel="Thinking…">
              {day?.ai_micro_summary ? "Regenerate" : "Summarize this day"}
            </SubmitButton>
          </ActionForm>
        </Card>

        {/* Trends */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Trends
            </h2>
            <span className="flex gap-2 text-xs">
              {[14, 30, 90].map((r) => (
                <Link
                  key={r}
                  href={`/diet?date=${date}&range=${r}`}
                  className={r === range ? "text-accent" : "text-muted"}
                >
                  {r}d
                </Link>
              ))}
            </span>
          </div>

          <LineChart
            title="Calories per day"
            unit=" kcal"
            color={SERIES.s1}
            points={totalsSeries.map((d) => ({
              date: d.date,
              // Untracked days are holes in the line, not zeros.
              value: d.completeness === "untracked" ? null : Math.round(d.kcal),
              state: d.completeness,
            }))}
          />

          <StackedBarChart
            title="Macros per day (g)"
            seriesNames={["Protein", "Carbs", "Fat", "Fiber"]}
            rows={totalsSeries.map((d) => ({
              date: d.date,
              state: d.completeness,
              values: [d.protein_g, d.carbs_g, d.fat_g, d.fiber_g],
            }))}
          />

          <p className="text-xs text-muted">
            Hollow markers and faded bars are partially-logged days; a tick on the baseline
            means the day wasn&rsquo;t tracked at all. Neither is counted as a low-intake day.
          </p>
        </div>
      </div>
    </main>
  );
}

function EntryForm({
  date,
  entry,
}: {
  date: string;
  entry?: Awaited<ReturnType<typeof getDietEntries>>[number];
}) {
  return (
    <form action={upsertDietEntry} className="space-y-3">
      <input type="hidden" name="date" value={date} />
      {entry && <input type="hidden" name="id" value={entry.id} />}
      <Field label="What did you eat?">
        <Input name="name" required defaultValue={entry?.name ?? ""} placeholder="Overnight oats" />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Qty">
          <Input name="qty" type="number" step="0.25" inputMode="decimal" defaultValue={entry?.qty ?? ""} />
        </Field>
        <Field label="Unit">
          <Input name="unit" defaultValue={entry?.unit ?? ""} placeholder="cup" />
        </Field>
        <Field label="Meal">
          <Select name="meal" defaultValue={entry?.meal ?? "unspecified"}>
            {MEALS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-5 gap-2">
        <Field label="kcal">
          <Input name="kcal" type="number" inputMode="numeric" defaultValue={entry?.kcal ?? ""} />
        </Field>
        <Field label="P">
          <Input name="protein_g" type="number" inputMode="decimal" defaultValue={entry?.protein_g ?? ""} />
        </Field>
        <Field label="C">
          <Input name="carbs_g" type="number" inputMode="decimal" defaultValue={entry?.carbs_g ?? ""} />
        </Field>
        <Field label="F">
          <Input name="fat_g" type="number" inputMode="decimal" defaultValue={entry?.fat_g ?? ""} />
        </Field>
        <Field label="Fib">
          <Input name="fiber_g" type="number" inputMode="decimal" defaultValue={entry?.fiber_g ?? ""} />
        </Field>
      </div>
      <p className="text-xs text-muted">
        Leave calories blank and they&rsquo;ll be computed from the macros.
      </p>
      <Field label="Note">
        <Textarea name="notes" rows={2} defaultValue={entry?.notes ?? ""} />
      </Field>
      <SubmitButton pendingLabel="Saving…">{entry ? "Save changes" : "Add entry"}</SubmitButton>
    </form>
  );
}
