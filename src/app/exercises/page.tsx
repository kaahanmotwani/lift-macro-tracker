import Link from "next/link";
import { listExercises } from "@/lib/data";
import { getProfile } from "@/lib/supabase/server";
import { archiveExercise, upsertExercise } from "@/app/actions/lifts";
import { Badge, Empty, Field, Input, Textarea } from "@/components/ui";
import { MiniSubmit, SubmitButton, Disclosure } from "@/components/form";
import { TopBar } from "@/components/nav";
import { fromLbs, round } from "@/lib/units";

export const metadata = { title: "Exercises" };

export default async function ExercisesPage() {
  const [exercises, profile] = await Promise.all([listExercises(), getProfile()]);
  const unit = profile?.weight_unit ?? "lb";

  return (
    <main>
      <TopBar
        title="Exercises"
        right={
          <Link href="/lifts" className="text-sm text-[--color-muted]">
            Back
          </Link>
        }
      />

      <div className="space-y-4">
        <p className="text-sm text-[--color-muted]">
          Similar movements are kept separate on purpose. A wide-grip row and a neutral-grip
          row are different exercises, and the same nominal machine at two gyms rarely feels
          the same — so each gets its own progression.
        </p>

        <Disclosure label="+ Add an exercise">
          <ExerciseForm unit={unit} />
        </Disclosure>

        {exercises.length === 0 ? (
          <Empty title="No exercises yet">
            They&rsquo;re created automatically when you log or import a workout.
          </Empty>
        ) : (
          <ul className="space-y-2">
            {exercises.map((e) => (
              <li key={e.id} className="rounded-2xl border border-[--color-line] bg-[--color-surface] p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/exercises/${e.id}`} className="font-medium hover:text-[--color-accent]">
                      {e.name}
                    </Link>
                    <p className="truncate text-xs text-[--color-muted]">
                      {[e.grip, e.angle, e.equipment, e.variant, e.gym].filter(Boolean).join(" · ") ||
                        "no details recorded"}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {e.primary_muscles.map((m) => (
                        <Badge key={m} tone="good">
                          {m}
                        </Badge>
                      ))}
                      {e.secondary_muscles.map((m) => (
                        <Badge key={m}>{m}</Badge>
                      ))}
                      {Number(e.starting_resistance_lbs) > 0 && (
                        <Badge tone="warn">
                          +{round(fromLbs(Number(e.starting_resistance_lbs), unit), 1)}
                          {unit} base
                        </Badge>
                      )}
                      {e.unilateral && <Badge>unilateral</Badge>}
                    </div>
                  </div>
                  <form action={archiveExercise}>
                    <input type="hidden" name="id" value={e.id} />
                    <MiniSubmit title="Archive">×</MiniSubmit>
                  </form>
                </div>

                <Disclosure label="Edit">
                  <ExerciseForm unit={unit} exercise={e} />
                </Disclosure>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function ExerciseForm({
  unit,
  exercise,
}: {
  unit: "lb" | "kg";
  exercise?: Awaited<ReturnType<typeof listExercises>>[number];
}) {
  return (
    <form action={upsertExercise} className="space-y-3">
      {exercise && <input type="hidden" name="id" value={exercise.id} />}
      <Field label="Name">
        <Input name="name" required defaultValue={exercise?.name ?? ""} placeholder="Cable row" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Equipment">
          <Input name="equipment" defaultValue={exercise?.equipment ?? ""} placeholder="cable" />
        </Field>
        <Field label="Grip">
          <Input name="grip" defaultValue={exercise?.grip ?? ""} placeholder="wide" />
        </Field>
        <Field label="Angle">
          <Input name="angle" defaultValue={exercise?.angle ?? ""} placeholder="incline" />
        </Field>
        <Field label="Variant">
          <Input name="variant" defaultValue={exercise?.variant ?? ""} placeholder="single-arm" />
        </Field>
      </div>
      <Field label="Gym / machine brand" hint="Two gyms' machines aren't comparable — this keeps them apart.">
        <Input name="gym" defaultValue={exercise?.gym ?? ""} placeholder="Equinox — Hammer Strength" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Primary muscles" hint="comma separated">
          <Input
            name="primary_muscles"
            defaultValue={exercise?.primary_muscles.join(", ") ?? ""}
            placeholder="lats, mid-back"
          />
        </Field>
        <Field label="Secondary muscles" hint="comma separated">
          <Input
            name="secondary_muscles"
            defaultValue={exercise?.secondary_muscles.join(", ") ?? ""}
            placeholder="biceps, rear delts"
          />
        </Field>
      </div>
      <Field
        label={`Starting resistance (${unit})`}
        hint="If the stack or carriage isn't zero at the bottom. Added to every logged weight when charting."
      >
        <Input
          name="starting_resistance"
          type="number"
          step="0.5"
          inputMode="decimal"
          defaultValue={
            exercise?.starting_resistance_lbs
              ? round(fromLbs(Number(exercise.starting_resistance_lbs), unit), 1)
              : ""
          }
          placeholder="0"
        />
      </Field>
      <label className="flex items-center gap-2 text-sm text-[--color-muted]">
        <input
          type="checkbox"
          name="unilateral"
          defaultChecked={exercise?.unilateral}
          className="h-4 w-4 accent-[--color-accent]"
        />
        One side at a time
      </label>
      <Field label="Notes">
        <Textarea name="notes" rows={2} defaultValue={exercise?.notes ?? ""} />
      </Field>
      <SubmitButton pendingLabel="Saving…">{exercise ? "Save changes" : "Add exercise"}</SubmitButton>
    </form>
  );
}
