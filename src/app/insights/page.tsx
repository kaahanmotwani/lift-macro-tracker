import Link from "next/link";
import { getSupabase, getProfile } from "@/lib/supabase/server";
import { muscleVolume } from "@/lib/data";
import { generateInsights } from "@/app/actions/insights";
import { Card, Empty, Markdown } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/form";
import { HBarChart } from "@/components/charts";
import { TopBar } from "@/components/nav";
import { addDays, formatDate, todayISO } from "@/lib/units";

export const metadata = { title: "Insights" };

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const sp = await searchParams;
  const days = Number(sp.days) || 30;

  const supabase = await getSupabase();
  const [{ data: past }, profile, muscles] = await Promise.all([
    supabase
      .from("insights")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10),
    getProfile(),
    muscleVolume(addDays(todayISO(), -(days - 1))),
  ]);

  const hasKey = Boolean(profile?.anthropic_key_ciphertext);
  const latest = past?.[0];

  const muscleItems = Object.entries(muscles)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  return (
    <main>
      <TopBar title="Insights" />

      <div className="space-y-4">
        <HBarChart
          title={`Sets per body part — last ${days} days`}
          items={muscleItems}
          unit="sets"
        />
        {muscleItems.length > 0 && (
          <p className="-mt-2 text-xs text-muted">
            Secondary movers count as half a set — they get worked, but they aren&rsquo;t what the
            lift is for.
          </p>
        )}

        <Card
          title="AI analysis"
          action={
            <span className="flex gap-2 text-xs">
              {[14, 30, 90].map((d) => (
                <Link
                  key={d}
                  href={`/insights?days=${d}`}
                  className={d === days ? "text-accent" : "text-muted"}
                >
                  {d}d
                </Link>
              ))}
            </span>
          }
        >
          {!hasKey ? (
            <p className="text-sm text-muted">
              Add your Anthropic API key in{" "}
              <Link href="/settings" className="text-accent">
                Settings
              </Link>{" "}
              to generate insights. They&rsquo;re billed to your own account.
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted">
                Claude reads your actual numbers — every logged set, every fully-tracked day of
                food — and tells you whether the lines are going up. Partially-logged days are
                handed over labelled and excluded from averages.
              </p>
              <ActionForm action={generateInsights}>
                <input type="hidden" name="days" value={days} />
                <SubmitButton pendingLabel="Analyzing your log…">
                  Analyze the last {days} days
                </SubmitButton>
              </ActionForm>
            </>
          )}
        </Card>

        {latest ? (
          <Card
            title={`Latest analysis — ${formatDate(String(latest.created_at).slice(0, 10))}`}
          >
            <Markdown text={latest.body_md} />
            <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
              Generated from {latest.period_start} to {latest.period_end}. This is pattern
              description, not medical or nutritional advice.
            </p>
          </Card>
        ) : (
          <Empty title="No analysis yet">
            Log a couple of weeks of training and food, then run one.
          </Empty>
        )}

        {past && past.length > 1 && (
          <Card title="Earlier analyses">
            <ul className="space-y-3">
              {past.slice(1).map((p) => (
                <li key={p.id}>
                  <details>
                    <summary className="cursor-pointer text-sm text-muted">
                      {formatDate(String(p.created_at).slice(0, 10))} · {p.kind}
                    </summary>
                    <div className="mt-2 border-l-2 border-line pl-3">
                      <Markdown text={p.body_md} />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </main>
  );
}
