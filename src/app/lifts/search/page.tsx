import Link from "next/link";
import { searchLifts } from "@/lib/data";
import { getProfile } from "@/lib/supabase/server";
import { Badge, Button, Card, Empty, Input } from "@/components/ui";
import { TopBar } from "@/components/nav";
import { formatDate, fromLbs, round } from "@/lib/units";

export const metadata = { title: "Search lifts" };

/**
 * One search box over the lifting log: exercises (→ their progression page),
 * sessions, and notes like "shoulder pain" (→ the session they were left in).
 */
export default async function LiftSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const q = ((await searchParams).q ?? "").trim();
  const [results, profile] = await Promise.all([q ? searchLifts(q) : null, getProfile()]);
  const unit = profile?.weight_unit ?? "lb";

  return (
    <main>
      <TopBar
        title="Search lifts"
        right={
          <Link href="/lifts" className="text-sm text-muted">
            Back
          </Link>
        }
      />

      <div className="space-y-4">
        <form className="flex gap-2" role="search">
          <Input
            name="q"
            type="search"
            defaultValue={q}
            placeholder="lever row, chest, ltf, shoulder pain…"
            autoFocus
            aria-label="Search exercises, sessions and notes"
          />
          <Button type="submit" className="shrink-0">
            Search
          </Button>
        </form>

        {!results && (
          <p className="text-sm text-muted">
            Searches exercise names and details (grip, angle, machine, gym, muscles), session
            names and notes, and every note you left on an exercise or set.
          </p>
        )}

        {results &&
          results.exercises.length + results.workouts.length + results.notes.length === 0 && (
            <Empty title={`Nothing matches “${q}”`}>Try a shorter word.</Empty>
          )}

        {results && results.exercises.length > 0 && (
          <Card title="Exercises">
            <ul className="divide-y divide-line">
              {results.exercises.map((ex) => {
                const detail = [ex.grip, ex.angle, ex.equipment, ex.variant, ex.gym]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <li key={ex.id}>
                    <Link href={`/exercises/${ex.id}`} className="block py-2.5">
                      <p className="text-sm font-medium">
                        {ex.name}
                        {detail && (
                          <span className="ml-2 text-xs font-normal text-muted">{detail}</span>
                        )}
                        {ex.archived && (
                          <span className="ml-2">
                            <Badge tone="muted">archived</Badge>
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted">
                        {ex.sessions
                          ? `${ex.sessions} session${ex.sessions === 1 ? "" : "s"} · last ${formatDate(ex.lastDate!)}`
                          : "Not logged yet"}
                        {Number(ex.starting_resistance_lbs)
                          ? ` · starts at ${round(fromLbs(Number(ex.starting_resistance_lbs), unit), 1)} ${unit}`
                          : ""}
                      </p>
                      {ex.primary_muscles.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {ex.primary_muscles.map((m) => (
                            <Badge key={m} tone="good">
                              {m}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        {results && results.notes.length > 0 && (
          <Card title="Notes">
            <ul className="divide-y divide-line">
              {results.notes.map((n, i) => (
                <li key={i}>
                  <Link href={`/lifts/${n.workoutId}`} className="block py-2.5">
                    <p className="text-sm">{n.text}</p>
                    <p className="text-xs text-muted">
                      {formatDate(n.date)}
                      {n.exercise ? ` · ${n.exercise}` : ""}
                      {n.setIndex ? ` · set ${n.setIndex}` : ""}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {results && results.workouts.length > 0 && (
          <Card title="Sessions">
            <ul className="divide-y divide-line">
              {results.workouts.map((w) => (
                <li key={w.id}>
                  <Link href={`/lifts/${w.id}`} className="block py-2.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium">{w.title ?? "Session"}</span>
                      <span className="text-xs text-muted">{formatDate(w.date)}</span>
                    </div>
                    <p className="truncate text-xs text-muted">
                      {w.exerciseNames.join(" · ") || "No exercises"}
                      {w.gym ? ` · ${w.gym}` : ""}
                    </p>
                    {w.notes && <p className="mt-0.5 text-xs text-muted italic">{w.notes}</p>}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </main>
  );
}
