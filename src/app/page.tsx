import Link from "next/link";
import { requireUser, getProfile } from "@/lib/supabase/server";
import {
  dailyTotals,
  getDietEntries,
  latestBodyweight,
  listWorkouts,
  resolveTargets,
  sumMacros,
} from "@/lib/data";
import { Card, Empty, Stat, TargetBar, Badge } from "@/components/ui";
import { SERIES } from "@/components/charts";
import { TopBar } from "@/components/nav";
import { formatDate, formatWeight, todayISO } from "@/lib/units";

export default async function Dashboard() {
  await requireUser();

  const today = todayISO();
  const [profile, entries, targets, weight, allWorkouts, week] = await Promise.all([
    getProfile(),
    getDietEntries(today),
    resolveTargets(),
    latestBodyweight(),
    // Enough history to count this week's sessions, not just the three shown.
    listWorkouts(30),
    dailyTotals(7),
  ]);

  const unit = profile?.weight_unit ?? "lb";
  const totals = sumMacros(entries);
  const workouts = allWorkouts.slice(0, 3);
  const lastWorkout = workouts[0];
  const weekDates = new Set(week.map((d) => d.date));
  const daysTrainedThisWeek = new Set(
    allWorkouts.filter((w) => weekDates.has(w.date)).map((w) => w.date),
  ).size;

  return (
    <main>
      <TopBar
        title={profile?.display_name ? `Hey, ${profile.display_name}` : "Today"}
        right={
          <Link href="/settings" className="text-sm text-muted" aria-label="Settings">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H7a1.7 1.7 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V7a1.7 1.7 0 0 0 1.5 1H23a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
            </svg>
          </Link>
        }
      />

      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <Stat
            label="Bodyweight"
            value={weight ? formatWeight(weight.weight_lbs, unit).split(" ")[0] : "—"}
            sub={weight ? `${unit} · ${formatDate(weight.date, { weekday: undefined })}` : "not logged"}
          />
          <Stat label="Calories today" value={Math.round(totals.kcal) || "—"} sub={targets.target?.kcal ? `of ${targets.target.kcal}` : "no target"} />
          <Stat
            label="Trained"
            value={daysTrainedThisWeek}
            sub="days this week"
            tone={daysTrainedThisWeek > 0 ? "accent" : "muted"}
          />
        </div>

        <Card
          title="Today's macros"
          action={
            <Link href="/diet" className="text-sm text-accent">
              Log food
            </Link>
          }
        >
          {entries.length === 0 ? (
            <Empty title="Nothing logged yet today">
              <Link href="/import" className="text-accent">
                Paste your notes
              </Link>{" "}
              or{" "}
              <Link href="/diet" className="text-accent">
                add a meal
              </Link>
              .
            </Empty>
          ) : (
            <div className="space-y-3">
              <TargetBar
                label="Protein"
                value={totals.protein_g}
                target={targets.proteinTarget}
                color={SERIES.s1}
              />
              <TargetBar
                label="Carbs"
                value={totals.carbs_g}
                target={targets.target?.carbs_g ?? null}
                color={SERIES.s2}
              />
              <TargetBar
                label="Fat"
                value={totals.fat_g}
                target={targets.target?.fat_g ?? null}
                color={SERIES.s3}
              />
              <TargetBar
                label="Fiber"
                value={totals.fiber_g}
                target={targets.target?.fiber_g ?? null}
                color={SERIES.s4}
              />
              {targets.target?.protein_mode === "bodyweight" && targets.bodyweightLbs && (
                <p className="text-xs text-muted">
                  Protein target is {targets.target.protein_multiplier}× your bodyweight
                  ({Math.round(targets.bodyweightLbs)} lb).
                </p>
              )}
            </div>
          )}
        </Card>

        <Card
          title="Recent training"
          action={
            <Link href="/lifts" className="text-sm text-accent">
              All workouts
            </Link>
          }
        >
          {!lastWorkout ? (
            <Empty title="No workouts logged">
              <Link href="/lifts" className="text-accent">
                Log your first session
              </Link>
              .
            </Empty>
          ) : (
            <ul className="space-y-2">
              {workouts.map((w) => (
                <li key={w.id}>
                  <Link
                    href={`/lifts/${w.id}`}
                    className="flex items-center justify-between rounded-xl border border-line bg-surface-2 px-3 py-2.5"
                  >
                    <span>
                      <span className="block text-sm font-medium">
                        {w.title ?? formatDate(w.date)}
                      </span>
                      <span className="text-xs text-muted">
                        {w.workout_exercises?.length ?? 0} exercises ·{" "}
                        {(w.workout_exercises ?? []).reduce(
                          (n, b) => n + (b.workout_sets?.length ?? 0),
                          0,
                        )}{" "}
                        sets
                      </span>
                    </span>
                    <Badge>{formatDate(w.date, { weekday: undefined })}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/import"
            className="flex min-h-20 flex-col justify-center rounded-2xl border border-line bg-surface px-4"
          >
            <span className="text-sm font-medium">Import from notes</span>
            <span className="text-xs text-muted">Paste anything. Photo of a meal works too.</span>
          </Link>
          <Link
            href="/insights"
            className="flex min-h-20 flex-col justify-center rounded-2xl border border-line bg-surface px-4"
          >
            <span className="text-sm font-medium">Get insights</span>
            <span className="text-xs text-muted">Are the numbers going up?</span>
          </Link>
        </div>
      </div>
    </main>
  );
}
