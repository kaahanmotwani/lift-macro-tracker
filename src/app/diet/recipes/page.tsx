import Link from "next/link";
import { listRecipes, recipeTotals } from "@/lib/data";
import {
  addRecipeItem,
  deleteRecipe,
  deleteRecipeItem,
  upsertRecipe,
} from "@/app/actions/diet";
import { Card, Empty, Field, Input, Textarea } from "@/components/ui";
import { MiniSubmit, SubmitButton, Disclosure } from "@/components/form";
import { TopBar } from "@/components/nav";

export const metadata = { title: "Recipes" };

export default async function RecipesPage() {
  const recipes = await listRecipes();

  return (
    <main>
      <TopBar
        title="Recipes"
        right={
          <Link href="/diet" className="text-sm text-muted">
            Back
          </Link>
        }
      />

      <div className="space-y-4">
        <p className="text-sm text-muted">
          A recipe is a mix you eat often — overnight oats, your usual shake. Log it in one tap
          and scale it by servings instead of re-entering every ingredient.
        </p>

        <Card title="New recipe">
          <form action={upsertRecipe} className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <Field label="Name" className="col-span-2">
                <Input name="name" required placeholder="Overnight oats" />
              </Field>
              <Field label="Servings">
                <Input name="servings" type="number" step="0.5" defaultValue="1" />
              </Field>
            </div>
            <SubmitButton pendingLabel="Creating…">Create</SubmitButton>
          </form>
        </Card>

        {recipes.length === 0 ? (
          <Empty title="No recipes saved yet" />
        ) : (
          recipes.map((r) => {
            const totals = recipeTotals(r);
            const perServing = (v: number) => Math.round((v / (r.servings || 1)) * 10) / 10;
            return (
              <Card
                key={r.id}
                title={r.name}
                action={
                  <form action={deleteRecipe}>
                    <input type="hidden" name="id" value={r.id} />
                    <MiniSubmit title="Delete recipe">×</MiniSubmit>
                  </form>
                }
              >
                <p className="tabular mb-3 text-xs text-muted">
                  Makes {r.servings} serving{r.servings === 1 ? "" : "s"} · per serving:{" "}
                  {perServing(totals.kcal)} kcal · P{perServing(totals.protein_g)} · C
                  {perServing(totals.carbs_g)} · F{perServing(totals.fat_g)} · Fib
                  {perServing(totals.fiber_g)}
                </p>

                {r.recipe_items?.length ? (
                  <ul className="mb-3 divide-y divide-line text-sm">
                    {r.recipe_items.map((item) => (
                      <li key={item.id} className="flex items-center justify-between py-2">
                        <span className="min-w-0">
                          <span className="block truncate">{item.name}</span>
                          <span className="tabular text-xs text-muted">
                            {item.qty ? `${item.qty}${item.unit ? ` ${item.unit}` : ""} · ` : ""}
                            {Math.round(item.kcal ?? 0)} kcal · P{item.protein_g ?? 0} · C
                            {item.carbs_g ?? 0} · F{item.fat_g ?? 0}
                          </span>
                        </span>
                        <form action={deleteRecipeItem}>
                          <input type="hidden" name="id" value={item.id} />
                          <MiniSubmit title="Remove ingredient">×</MiniSubmit>
                        </form>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mb-3 text-sm text-muted">No ingredients yet.</p>
                )}

                <Disclosure label="+ Add ingredient">
                  <form action={addRecipeItem} className="space-y-3">
                    <input type="hidden" name="recipe_id" value={r.id} />
                    <Field label="Ingredient">
                      <Input name="name" required placeholder="Rolled oats" />
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Qty">
                        <Input name="qty" type="number" step="0.25" />
                      </Field>
                      <Field label="Unit">
                        <Input name="unit" placeholder="g" />
                      </Field>
                    </div>
                    <div className="grid grid-cols-5 gap-2">
                      <Field label="kcal">
                        <Input name="kcal" type="number" />
                      </Field>
                      <Field label="P">
                        <Input name="protein_g" type="number" step="0.1" />
                      </Field>
                      <Field label="C">
                        <Input name="carbs_g" type="number" step="0.1" />
                      </Field>
                      <Field label="F">
                        <Input name="fat_g" type="number" step="0.1" />
                      </Field>
                      <Field label="Fib">
                        <Input name="fiber_g" type="number" step="0.1" />
                      </Field>
                    </div>
                    <SubmitButton>Add ingredient</SubmitButton>
                  </form>
                </Disclosure>

                <Disclosure label="Edit recipe">
                  <form action={upsertRecipe} className="space-y-3">
                    <input type="hidden" name="id" value={r.id} />
                    <div className="grid grid-cols-3 gap-2">
                      <Field label="Name" className="col-span-2">
                        <Input name="name" required defaultValue={r.name} />
                      </Field>
                      <Field label="Servings">
                        <Input name="servings" type="number" step="0.5" defaultValue={r.servings} />
                      </Field>
                    </div>
                    <Field label="Notes">
                      <Textarea name="notes" rows={2} defaultValue={r.notes ?? ""} />
                    </Field>
                    <SubmitButton>Save changes</SubmitButton>
                  </form>
                </Disclosure>
              </Card>
            );
          })
        )}
      </div>
    </main>
  );
}
