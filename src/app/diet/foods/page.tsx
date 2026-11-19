import Link from "next/link";
import { listFoodItems } from "@/lib/data";
import { deleteFoodItem, upsertFoodItem } from "@/app/actions/diet";
import { Badge, Card, Empty, Field, Input, Textarea } from "@/components/ui";
import { MiniSubmit, SubmitButton, Disclosure } from "@/components/form";
import { TopBar } from "@/components/nav";

export const metadata = { title: "Saved foods" };

export default async function FoodsPage() {
  const foods = await listFoodItems();

  return (
    <main>
      <TopBar
        title="Saved foods"
        right={
          <Link href="/diet" className="text-sm text-muted">
            Back
          </Link>
        }
      />

      <div className="space-y-4">
        <p className="text-sm text-muted">
          Save the brands you actually buy. Mark one as the default for a food, and when you
          (or an import) just say &ldquo;greek yogurt&rdquo;, those macros get used instead of an
          estimate — still editable per entry when you bought a different brand.
        </p>

        <Disclosure label="+ Add a food" defaultOpen={foods.length === 0}>
          <FoodForm />
        </Disclosure>

        {foods.length === 0 ? (
          <Empty title="No saved foods yet" />
        ) : (
          <ul className="space-y-2">
            {foods.map((f) => (
              <li key={f.id} className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {f.name}
                      {f.brand && <span className="text-muted"> — {f.brand}</span>}
                    </p>
                    <p className="tabular text-xs text-muted">
                      per {f.serving_qty} {f.serving_unit} · {Math.round(f.kcal ?? 0)} kcal · P
                      {f.protein_g ?? 0} · C{f.carbs_g ?? 0} · F{f.fat_g ?? 0} · Fib{f.fiber_g ?? 0}
                    </p>
                    {f.is_default && (
                      <p className="mt-1">
                        <Badge tone="good">default for &ldquo;{f.name}&rdquo;</Badge>
                      </p>
                    )}
                  </div>
                  <form action={deleteFoodItem}>
                    <input type="hidden" name="id" value={f.id} />
                    <MiniSubmit title="Delete">×</MiniSubmit>
                  </form>
                </div>
                <Disclosure label="Edit">
                  <FoodForm food={f} />
                </Disclosure>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function FoodForm({ food }: { food?: Awaited<ReturnType<typeof listFoodItems>>[number] }) {
  return (
    <form action={upsertFoodItem} className="space-y-3">
      {food && <input type="hidden" name="id" value={food.id} />}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Food" hint="the generic name">
          <Input name="name" required defaultValue={food?.name ?? ""} placeholder="greek yogurt" />
        </Field>
        <Field label="Brand">
          <Input name="brand" defaultValue={food?.brand ?? ""} placeholder="Fage 0%" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Serving size">
          <Input name="serving_qty" type="number" step="0.25" defaultValue={food?.serving_qty ?? 1} />
        </Field>
        <Field label="Unit">
          <Input name="serving_unit" defaultValue={food?.serving_unit ?? "serving"} placeholder="g" />
        </Field>
      </div>
      <div className="grid grid-cols-5 gap-2">
        <Field label="kcal">
          <Input name="kcal" type="number" defaultValue={food?.kcal ?? ""} />
        </Field>
        <Field label="P">
          <Input name="protein_g" type="number" step="0.1" defaultValue={food?.protein_g ?? ""} />
        </Field>
        <Field label="C">
          <Input name="carbs_g" type="number" step="0.1" defaultValue={food?.carbs_g ?? ""} />
        </Field>
        <Field label="F">
          <Input name="fat_g" type="number" step="0.1" defaultValue={food?.fat_g ?? ""} />
        </Field>
        <Field label="Fib">
          <Input name="fiber_g" type="number" step="0.1" defaultValue={food?.fiber_g ?? ""} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          name="is_default"
          defaultChecked={food?.is_default}
          className="h-4 w-4 accent-accent"
        />
        Use this brand by default for this food
      </label>
      <Field label="Notes">
        <Textarea name="notes" rows={2} defaultValue={food?.notes ?? ""} />
      </Field>
      <SubmitButton pendingLabel="Saving…">{food ? "Save changes" : "Add food"}</SubmitButton>
    </form>
  );
}
