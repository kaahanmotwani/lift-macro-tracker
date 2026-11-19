import Link from "next/link";
import { notFound } from "next/navigation";
import { getProfile, getSupabase } from "@/lib/supabase/server";
import { applyImport, deleteImport } from "@/app/actions/import";
import { Badge, Card, Empty } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/form";
import { TopBar } from "@/components/nav";
import { formatDate, fromLbs, round, todayISO } from "@/lib/units";
import type { ImportResult } from "@/lib/ai/schemas";

/**
 * The review screen. Everything Claude extracted is shown exactly as it will be
 * written, with a checkbox per section, before anything touches the log.
 */
export default async function ReviewImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await getSupabase();

  const [{ data: record }, profile] = await Promise.all([
    supabase.from("imports").select("*").eq("id", id).maybeSingle(),
    getProfile(),
  ]);
  if (!record) notFound();

  const unit = profile?.weight_unit ?? "lb";
  const parsed = record.parsed as ImportResult | null;
  const applied = record.status === "applied";

  const w = (lbs: number | null) =>
    lbs === null ? "BW" : `${round(fromLbs(lbs, unit), 1)}${unit}`;

  return (
    <main>
      <TopBar
        title="Review import"
        right={
          <Link href="/import" className="text-sm text-[--color-muted]">
            Back
          </Link>
        }
      />

      <div className="space-y-4">
        {record.status === "failed" && (
          <div className="rounded-2xl border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-300">
            <p className="font-medium">This import failed</p>
            <p className="mt-1">{record.error}</p>
          </div>
        )}

        {applied && (
          <div className="rounded-2xl border border-emerald-900/60 bg-emerald-950/30 p-4 text-sm text-emerald-300">
            Already applied to your log. Re-importing would duplicate it.
          </div>
        )}

        {parsed?.summary && (
          <Card title="What Claude found">
            <p className="text-sm leading-relaxed">{parsed.summary}</p>
          </Card>
        )}

        {parsed && !applied ? (
          <ActionForm action={applyImport} className="space-y-4">
            <input type="hidden" name="import_id" value={record.id} />
            <input type="hidden" name="fallback_date" value={todayISO()} />

            {/* Workouts */}
            {parsed.workouts.map((workout, wi) => (
              <Card
                key={wi}
                title={
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    <input
                      type="checkbox"
                      name="keep_workout"
                      value={wi}
                      defaultChecked
                      className="h-4 w-4 accent-[--color-accent]"
                    />
                    {workout.title ?? "Workout"} ·{" "}
                    {workout.date ? formatDate(workout.date) : "no date — will use today"}
                  </label>
                }
              >
                {workout.gym && <p className="mb-2 text-xs text-[--color-muted]">{workout.gym}</p>}
                <ol className="space-y-3">
                  {workout.exercises.map((ex, ei) => (
                    <li key={ei}>
                      <p className="text-sm font-medium">
                        {ei + 1}. {ex.name}
                        <span className="ml-2 text-xs font-normal text-[--color-muted]">
                          {[ex.grip, ex.angle, ex.equipment, ex.variant].filter(Boolean).join(" · ")}
                        </span>
                      </p>
                      {ex.starting_resistance_lbs ? (
                        <p className="mt-0.5">
                          <Badge tone="warn">
                            starts at {w(ex.starting_resistance_lbs)}
                          </Badge>
                        </p>
                      ) : null}
                      <ul className="mt-1 space-y-0.5 text-xs">
                        {ex.sets.map((set, si) => (
                          <li key={si} className="tabular text-[--color-muted]">
                            Set {si + 1}:{" "}
                            {set.segments
                              .map((s) => `${s.reps ?? "?"} × ${w(s.weight_lbs)}`)
                              .join("  +  ")}
                            {set.segments.length > 1 && (
                              <span className="ml-2 text-[--color-accent]">superset</span>
                            )}
                            {set.is_warmup && <span className="ml-2">warmup</span>}
                            {set.rpe && <span className="ml-2">RPE {set.rpe}</span>}
                            {set.note && <span className="ml-2 italic">{set.note}</span>}
                          </li>
                        ))}
                      </ul>
                      {(ex.primary_muscles.length > 0 || ex.secondary_muscles.length > 0) && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {ex.primary_muscles.map((m) => (
                            <Badge key={m} tone="good">
                              {m}
                            </Badge>
                          ))}
                          {ex.secondary_muscles.map((m) => (
                            <Badge key={m}>{m}</Badge>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </Card>
            ))}

            {/* Diet */}
            {parsed.diet_days.map((day, di) => (
              <Card
                key={di}
                title={
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    <input
                      type="checkbox"
                      name="keep_diet_day"
                      value={di}
                      defaultChecked
                      className="h-4 w-4 accent-[--color-accent]"
                    />
                    Food · {day.date ? formatDate(day.date) : "no date — will use today"}
                  </label>
                }
                action={
                  <Badge tone={day.completeness === "complete" ? "good" : "warn"}>
                    {day.completeness}
                  </Badge>
                }
              >
                {day.completeness_note && (
                  <p className="mb-2 text-xs text-amber-300">{day.completeness_note}</p>
                )}
                <ul className="divide-y divide-[--color-line] text-sm">
                  {day.entries.map((e, ei) => (
                    <li key={ei} className="py-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate">
                          {e.name}
                          {e.brand && <span className="text-[--color-muted]"> — {e.brand}</span>}
                        </span>
                        {e.confidence !== "high" && <Badge tone="warn">{e.confidence}</Badge>}
                      </div>
                      <p className="tabular text-xs text-[--color-muted]">
                        {e.qty ? `${e.qty}${e.unit ? ` ${e.unit}` : ""} · ` : ""}
                        {e.kcal ?? "?"} kcal · P{e.protein_g ?? "?"} · C{e.carbs_g ?? "?"} · F
                        {e.fat_g ?? "?"} · Fib{e.fiber_g ?? "?"}
                      </p>
                      {e.note && <p className="text-xs text-[--color-muted] italic">{e.note}</p>}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}

            {/* Bodyweight */}
            {parsed.bodyweight.length > 0 && (
              <Card title="Weigh-ins">
                <ul className="space-y-2 text-sm">
                  {parsed.bodyweight.map((b, bi) => (
                    <li key={bi}>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          name="keep_weight"
                          value={bi}
                          defaultChecked
                          className="h-4 w-4 accent-[--color-accent]"
                        />
                        <span className="tabular">
                          {b.weight} {b.unit}
                        </span>
                        <span className="text-xs text-[--color-muted]">
                          {b.date ? formatDate(b.date) : "today"}
                          {b.time ? ` · ${b.time}` : ""}
                          {b.note ? ` · ${b.note}` : ""}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {parsed.unparsed.length > 0 && (
              <Card title="Couldn't map these lines">
                <ul className="list-disc space-y-1 pl-5 text-sm text-[--color-muted]">
                  {parsed.unparsed.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-[--color-muted]">
                  Nothing is dropped silently — add these by hand if they matter.
                </p>
              </Card>
            )}

            {parsed.workouts.length === 0 &&
              parsed.diet_days.length === 0 &&
              parsed.bodyweight.length === 0 && (
                <Empty title="Nothing structured came out of that">
                  Try adding a bit more detail, or log it by hand.
                </Empty>
              )}

            <div className="sticky bottom-20 rounded-2xl border border-[--color-line] bg-[--color-surface] p-3">
              <SubmitButton pendingLabel="Writing to your log…" className="w-full">
                Import the checked items
              </SubmitButton>
            </div>
          </ActionForm>
        ) : null}

        {record.raw_text && (
          <Card title="Original text">
            <pre className="overflow-auto whitespace-pre-wrap font-mono text-xs text-[--color-muted]">
              {record.raw_text}
            </pre>
          </Card>
        )}

        <form action={deleteImport}>
          <input type="hidden" name="id" value={record.id} />
          <SubmitButton variant="danger">Delete this import record</SubmitButton>
        </form>
      </div>
    </main>
  );
}
