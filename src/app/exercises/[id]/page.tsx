import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabase, getProfile } from "@/lib/supabase/server";
import { exerciseHistory } from "@/lib/data";
import { LineChart, SERIES } from "@/components/charts";
import { Badge, Card, Empty, Stat } from "@/components/ui";
import { TopBar } from "@/components/nav";
import { formatDate, fromLbs, round } from "@/lib/units";
import type { Exercise } from "@/lib/types";

export default async function ExerciseProgressPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await getSupabase();

  const [{ data }, profile, history] = await Promise.all([
    supabase.from("exercises").select("*").eq("id", id).maybeSingle(),
    getProfile(),
    exerciseHistory(id),
  ]);

  const exercise = data as Exercise | null;
  if (!exercise) notFound();

  const unit = profile?.weight_unit ?? "lb";
  const base = Number(exercise.starting_resistance_lbs ?? 0);

  const first = history[0];
  const last = history[history.length - 1];
  const e1rmChange = first && last ? last.bestE1RM - first.bestE1RM : 0;
  const pct = first?.bestE1RM ? (e1rmChange / first.bestE1RM) * 100 : 0;

  return (
    <main>
      <TopBar
        title={exercise.name}
        right={
          <Link href="/exercises" className="text-sm text-muted">
            Back
          </Link>
        }
      />

      <div className="space-y-4">
        <div className="flex flex-wrap gap-1">
          {[exercise.grip, exercise.angle, exercise.equipment, exercise.variant, exercise.gym]
            .filter(Boolean)
            .map((d) => (
              <Badge key={String(d)}>{d}</Badge>
            ))}
          {base > 0 && (
            <Badge tone="warn">
              +{round(fromLbs(base, unit), 1)}
              {unit} starting resistance
            </Badge>
          )}
        </div>

        {history.length < 2 ? (
          <Empty title="Not enough history yet">
            {history.length === 0
              ? "Log this exercise in a workout and its progression will appear here."
              : "One session logged. A second session is what makes a trend."}
          </Empty>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat
                label="Sessions"
                value={history.length}
                sub={`since ${formatDate(first.date, { weekday: undefined })}`}
              />
              <Stat
                label="Best est. 1RM"
                value={round(fromLbs(Math.max(...history.map((h) => h.bestE1RM)), unit), 1)}
                sub={unit}
                tone="accent"
              />
              <Stat
                label="Change"
                value={`${e1rmChange >= 0 ? "+" : ""}${round(pct, 1)}%`}
                sub="first → last"
                tone={e1rmChange >= 0 ? "accent" : "muted"}
              />
            </div>

            <LineChart
              title={`Estimated 1RM (${unit})`}
              yFromZero={false}
              unit={unit}
              color={SERIES.s1}
              points={history.map((h) => ({
                date: h.date,
                value: round(fromLbs(h.bestE1RM, unit), 1),
                label: `${h.topSetWeight === null ? "BW" : round(fromLbs(h.topSetWeight, unit), 1)} × ${h.topSetReps ?? "?"}`,
              }))}
            />

            <LineChart
              title={`Total volume per session (${unit} × reps)`}
              unit=""
              color={SERIES.s1}
              points={history.map((h) => ({
                date: h.date,
                value: Math.round(fromLbs(h.totalVolume, unit)),
              }))}
            />

            <Card title="Session log">
              <ul className="divide-y divide-line text-sm">
                {[...history].reverse().map((h) => (
                  <li key={h.date} className="flex items-center justify-between py-2">
                    <Link href={`/lifts/${h.workoutId}`} className="text-muted hover:text-fg">
                      {formatDate(h.date)}
                    </Link>
                    <span className="tabular">
                      {h.topSetWeight === null
                        ? "BW"
                        : `${round(fromLbs(h.topSetWeight, unit), 1)}${unit}`}{" "}
                      × {h.topSetReps ?? "?"}
                      <span className="ml-2 text-xs text-muted">
                        {h.sets} sets · {h.totalReps} reps
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </>
        )}

        {base > 0 && (
          <p className="text-xs text-muted">
            Charts add the {round(fromLbs(base, unit), 1)}
            {unit} starting resistance to every logged weight, so this line is comparable to
            free-weight movements.
          </p>
        )}
      </div>
    </main>
  );
}
