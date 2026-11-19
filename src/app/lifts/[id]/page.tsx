import Link from "next/link";
import { notFound } from "next/navigation";
import { getProfile } from "@/lib/supabase/server";
import { exerciseHistory, getWorkout, listExercises } from "@/lib/data";
import {
  addExerciseToWorkout,
  addSegment,
  addSet,
  deleteSegment,
  deleteSet,
  deleteWorkout,
  moveExerciseBlock,
  removeExerciseBlock,
  saveBlock,
  updateWorkout,
} from "@/app/actions/lifts";
import { Badge, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { MiniSubmit, SubmitButton, Disclosure } from "@/components/form";
import { TopBar } from "@/components/nav";
import { formatDate, round, fromLbs } from "@/lib/units";

export default async function WorkoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [workout, exercises, profile] = await Promise.all([
    getWorkout(id),
    listExercises(),
    getProfile(),
  ]);
  if (!workout) notFound();

  const unit = profile?.weight_unit ?? "lb";
  const blocks = workout.workout_exercises ?? [];

  // "What did I do last time?" is the single most useful thing to see while
  // logging — it's the comparison the whole app exists to make.
  const previous = new Map<string, string>();
  await Promise.all(
    blocks.map(async (block) => {
      const history = await exerciseHistory(block.exercise_id);
      const prior = history.filter((s) => s.date < workout.date).pop();
      if (prior) {
        const w =
          prior.topSetWeight === null
            ? "BW"
            : `${round(fromLbs(prior.topSetWeight, unit), 1)}${unit}`;
        previous.set(
          block.id,
          `Last (${formatDate(prior.date, { weekday: undefined })}): top set ${w} × ${prior.topSetReps ?? "?"}, ${prior.sets} sets`,
        );
      }
    }),
  );

  return (
    <main>
      <TopBar
        title={workout.title ?? formatDate(workout.date)}
        right={
          <Link href="/lifts" className="text-sm text-muted">
            Done
          </Link>
        }
      />

      <div className="space-y-4">
        <Disclosure label="Session details">
          <form action={updateWorkout} className="space-y-3">
            <input type="hidden" name="id" value={workout.id} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Date">
                <Input type="date" name="date" defaultValue={workout.date} />
              </Field>
              <Field label="Name">
                <Input name="title" defaultValue={workout.title ?? ""} placeholder="Push day" />
              </Field>
            </div>
            <Field label="Gym" hint="Machines differ between gyms — recording this keeps comparisons honest.">
              <Input name="gym" defaultValue={workout.gym ?? ""} placeholder="Equinox Bryant Park" />
            </Field>
            <Field label="Notes">
              <Textarea name="notes" rows={2} defaultValue={workout.notes ?? ""} placeholder="Slept badly, left elbow sore" />
            </Field>
            <div className="flex justify-between">
              <SubmitButton variant="secondary">Save details</SubmitButton>
            </div>
          </form>

          <form action={deleteWorkout} className="mt-3 border-t border-line pt-3">
            <input type="hidden" name="id" value={workout.id} />
            <SubmitButton variant="danger" pendingLabel="Deleting…">
              Delete this session
            </SubmitButton>
          </form>
        </Disclosure>

        {blocks.map((block, blockIndex) => {
          const ex = block.exercises;
          const detail = [ex?.grip, ex?.angle, ex?.equipment, ex?.variant]
            .filter(Boolean)
            .join(" · ");
          const sets = block.workout_sets ?? [];

          return (
            <section
              key={block.id}
              className="rounded-2xl border border-line bg-surface p-4"
            >
              <header className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate font-semibold">
                    <Link href={`/exercises/${block.exercise_id}`} className="hover:text-accent">
                      {blockIndex + 1}. {ex?.name}
                    </Link>
                  </h2>
                  {detail && <p className="truncate text-xs text-muted">{detail}</p>}
                  {Number(ex?.starting_resistance_lbs) > 0 && (
                    <p className="mt-1">
                      <Badge>
                        stack starts at {round(fromLbs(Number(ex.starting_resistance_lbs), unit), 1)}
                        {unit}
                      </Badge>
                    </p>
                  )}
                  {previous.get(block.id) && (
                    <p className="mt-1 text-xs text-accent">{previous.get(block.id)}</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <form action={moveExerciseBlock}>
                    <input type="hidden" name="id" value={block.id} />
                    <input type="hidden" name="workout_id" value={workout.id} />
                    <input type="hidden" name="direction" value="up" />
                    <MiniSubmit title="Move up">↑</MiniSubmit>
                  </form>
                  <form action={moveExerciseBlock}>
                    <input type="hidden" name="id" value={block.id} />
                    <input type="hidden" name="workout_id" value={workout.id} />
                    <input type="hidden" name="direction" value="down" />
                    <MiniSubmit title="Move down">↓</MiniSubmit>
                  </form>
                  <form action={removeExerciseBlock}>
                    <input type="hidden" name="id" value={block.id} />
                    <input type="hidden" name="workout_id" value={workout.id} />
                    <MiniSubmit title="Remove exercise">×</MiniSubmit>
                  </form>
                </div>
              </header>

              {/* One form per exercise: fill in every set, then save once. */}
              <form action={saveBlock} id={`save-${block.id}`} className="space-y-3">
                <input type="hidden" name="workout_id" value={workout.id} />
                <input type="hidden" name="block_id" value={block.id} />

                {sets.map((set) => {
                  const segments = set.set_segments ?? [];
                  const isSuperset = segments.length > 1;
                  return (
                    <div
                      key={set.id}
                      className="rounded-xl border border-line bg-surface-2 p-2.5"
                    >
                      <input type="hidden" name="set_id" value={set.id} />
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-medium text-muted">
                          Set {set.set_index}
                          {isSuperset && (
                            <span className="ml-2 text-accent">
                              superset · {segments.length} weights
                            </span>
                          )}
                        </span>
                        <MiniSubmit title="Delete set" form={`delset-${set.id}`}>
                          ×
                        </MiniSubmit>
                      </div>

                      {segments.map((seg, segIndex) => (
                        <div key={seg.id} className="mb-2 flex items-end gap-2">
                          <input type="hidden" name="segment_id" value={seg.id} />
                          <Field label={segIndex === 0 ? `Weight (${unit})` : `then (${unit})`} className="flex-1">
                            <Input
                              name={`seg_weight_${seg.id}`}
                              type="number"
                              step="0.5"
                              inputMode="decimal"
                              defaultValue={
                                seg.weight_lbs === null ? "" : round(fromLbs(seg.weight_lbs, unit), 1)
                              }
                              placeholder="—"
                              className="tabular"
                            />
                          </Field>
                          <Field label="Reps" className="w-24">
                            <Input
                              name={`seg_reps_${seg.id}`}
                              type="number"
                              inputMode="numeric"
                              defaultValue={seg.reps ?? ""}
                              placeholder="—"
                              className="tabular"
                            />
                          </Field>
                          <label className="flex h-11 items-center gap-1 text-xs text-muted">
                            <input
                              type="checkbox"
                              name={`seg_bw_${seg.id}`}
                              defaultChecked={seg.weight_lbs === null}
                              className="h-4 w-4 accent-accent"
                            />
                            BW
                          </label>
                          {segments.length > 1 && (
                            <MiniSubmit title="Remove this weight" form={`delseg-${seg.id}`}>
                              −
                            </MiniSubmit>
                          )}
                        </div>
                      ))}

                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="submit"
                          form={`addseg-${set.id}`}
                          className="text-xs text-accent"
                        >
                          + add a second weight to this set
                        </button>
                        <label className="flex items-center gap-1 text-xs text-muted">
                          <input
                            type="checkbox"
                            name={`set_warmup_${set.id}`}
                            defaultChecked={set.is_warmup}
                            className="h-4 w-4 accent-accent"
                          />
                          warmup
                        </label>
                        <label className="flex items-center gap-1 text-xs text-muted">
                          RPE
                          <input
                            name={`set_rpe_${set.id}`}
                            type="number"
                            step="0.5"
                            min="1"
                            max="10"
                            defaultValue={set.rpe ?? ""}
                            className="tabular h-8 w-14 rounded-md border border-line bg-surface px-1.5"
                          />
                        </label>
                      </div>

                      <input
                        name={`set_notes_${set.id}`}
                        defaultValue={set.notes ?? ""}
                        placeholder="note — pain, form, felt heavy…"
                        className="mt-2 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs placeholder:text-muted/60"
                      />
                    </div>
                  );
                })}

                <Field label="Exercise note">
                  <Input
                    name="block_notes"
                    defaultValue={block.notes ?? ""}
                    placeholder="Left shoulder clicked on the last set"
                  />
                </Field>

                <div className="flex gap-2">
                  <SubmitButton pendingLabel="Saving…">Save {ex?.name}</SubmitButton>
                  <Button type="submit" form={`addset-${block.id}`} variant="secondary">
                    + Set
                  </Button>
                </div>
              </form>

              {/* Companion forms — HTML forms can't nest, so these live outside the
                  save form and are triggered by the buttons above via form="…". */}
              <form action={addSet} id={`addset-${block.id}`} hidden>
                <input type="hidden" name="block_id" value={block.id} />
                <input type="hidden" name="workout_id" value={workout.id} />
              </form>
              {sets.map((set) => (
                <div key={`aux-${set.id}`}>
                  <form action={deleteSet} id={`delset-${set.id}`} hidden>
                    <input type="hidden" name="id" value={set.id} />
                    <input type="hidden" name="workout_id" value={workout.id} />
                  </form>
                  <form action={addSegment} id={`addseg-${set.id}`} hidden>
                    <input type="hidden" name="set_id" value={set.id} />
                    <input type="hidden" name="workout_id" value={workout.id} />
                  </form>
                  {(set.set_segments ?? []).map((seg) => (
                    <form action={deleteSegment} id={`delseg-${seg.id}`} key={seg.id} hidden>
                      <input type="hidden" name="id" value={seg.id} />
                      <input type="hidden" name="workout_id" value={workout.id} />
                    </form>
                  ))}
                </div>
              ))}
            </section>
          );
        })}

        <Card title="Add exercise">
          <form action={addExerciseToWorkout} className="space-y-3">
            <input type="hidden" name="workout_id" value={workout.id} />
            <Field label="From your library">
              <Select name="exercise_id" defaultValue="">
                <option value="">— choose —</option>
                {exercises.map((e) => (
                  <option key={e.id} value={e.id}>
                    {[e.name, e.grip, e.angle, e.equipment, e.gym].filter(Boolean).join(" · ")}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="…or type a new one"
              hint="It gets added to your library. Add grip, angle, and gym later so similar machines stay separate."
            >
              <Input name="new_exercise_name" placeholder="Wide-grip cable row" />
            </Field>
            <SubmitButton pendingLabel="Adding…">Add to session</SubmitButton>
          </form>
        </Card>
      </div>
    </main>
  );
}
