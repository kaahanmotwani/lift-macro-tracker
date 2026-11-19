import Link from "next/link";
import { listWorkouts } from "@/lib/data";
import { createWorkout } from "@/app/actions/lifts";
import { Card, Empty, Input, Field } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { TopBar } from "@/components/nav";
import { formatDate, todayISO } from "@/lib/units";

export const metadata = { title: "Lifts" };

export default async function LiftsPage() {
  const workouts = await listWorkouts(90);

  return (
    <main>
      <TopBar
        title="Lifts"
        right={
          <span className="flex gap-3 text-sm">
            <Link href="/lifts/search" className="text-accent">
              Search
            </Link>
            <Link href="/exercises" className="text-accent">
              Exercises
            </Link>
          </span>
        }
      />

      <div className="space-y-4">
        {/* Plain GET form to the search page. */}
        <form action="/lifts/search" className="flex gap-2" role="search">
          <Input
            name="q"
            type="search"
            placeholder="Search exercises, sessions, notes"
            aria-label="Search exercises, sessions and notes"
          />
          <button
            type="submit"
            className="min-h-11 shrink-0 rounded-xl border border-line px-3 text-sm text-accent"
          >
            Search
          </button>
        </form>

        <Card title="New session">
          <form action={createWorkout} className="flex gap-2">
            <Field label="Date" className="flex-1">
              <Input type="date" name="date" defaultValue={todayISO()} required />
            </Field>
            <Field label="Name (optional)" className="flex-1">
              <Input name="title" placeholder="Push day" />
            </Field>
            <div className="flex items-end">
              <SubmitButton pendingLabel="Creating…">Start</SubmitButton>
            </div>
          </form>
        </Card>

        {workouts.length === 0 ? (
          <Empty title="No workouts yet">
            Start a session above, or{" "}
            <Link href="/import" className="text-accent">
              import your existing notes
            </Link>
            .
          </Empty>
        ) : (
          <ul className="space-y-2">
            {workouts.map((w) => {
              const sets = (w.workout_exercises ?? []).reduce(
                (n, b) => n + (b.workout_sets?.length ?? 0),
                0,
              );
              return (
                <li key={w.id}>
                  <Link
                    href={`/lifts/${w.id}`}
                    className="block rounded-2xl border border-line bg-surface px-4 py-3"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">{w.title ?? "Session"}</span>
                      <span className="text-xs text-muted">{formatDate(w.date)}</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted">
                      {(w.workout_exercises ?? [])
                        .map((b) => b.exercises?.name)
                        .filter(Boolean)
                        .join(" · ") || "No exercises yet"}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {w.workout_exercises?.length ?? 0} exercises · {sets} sets
                      {w.gym ? ` · ${w.gym}` : ""}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
