import Link from "next/link";
import { getSupabase, getProfile } from "@/lib/supabase/server";
import { parseImport, parsePhoto } from "@/app/actions/import";
import { Badge, Card, Empty, Field, Input, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/form";
import { TopBar } from "@/components/nav";
import { formatDate, todayISO } from "@/lib/units";

export const metadata = { title: "Import" };

const EXAMPLE = `Mon — push day at Equinox
incline db press 3x8 @ 60s, last set was rough
cable fly, wide: 12,12,10 @ 30 (stack starts at 10)
dips: bodyweight 3x12
finished with a drop set on tricep pushdown: 8 reps @ 50 then 5 @ 30

food: overnight oats + scoop whey for breakfast, chipotle bowl for lunch
(forgot to log dinner)

weighed 178.4 this morning`;

export default async function ImportPage() {
  const supabase = await getSupabase();
  const profile = await getProfile();

  const { data: recent } = await supabase
    .from("imports")
    .select("id, kind, status, created_at, raw_text, error")
    .order("created_at", { ascending: false })
    .limit(10);

  const hasKey = Boolean(profile?.anthropic_key_ciphertext);

  return (
    <main>
      <TopBar title="Import" />

      <div className="space-y-4">
        {!hasKey && (
          <div className="rounded-2xl border border-amber-900/60 bg-amber-950/30 p-4 text-sm text-amber-200">
            <p className="font-medium">Add your Anthropic API key first</p>
            <p className="mt-1">
              Importing uses Claude, billed to your own Anthropic account.{" "}
              <Link href="/settings" className="underline">
                Add your key in Settings
              </Link>
              . It takes a minute and costs a few cents per import.
            </p>
          </div>
        )}

        <Card title="Paste your notes">
          <p className="mb-3 text-sm text-muted">
            Copy anything out of your Notes app — shorthand, typos, mixed lifts and food and
            weigh-ins in one blob. Nothing is written until you review it on the next screen.
          </p>
          <ActionForm action={parseImport} className="space-y-3">
            <input type="hidden" name="today" value={todayISO()} />
            <Textarea
              name="text"
              rows={12}
              required
              placeholder={EXAMPLE}
              className="font-mono text-[13px]"
            />
            <SubmitButton pendingLabel="Reading your notes…">Parse with Claude</SubmitButton>
          </ActionForm>
        </Card>

        <Card title="Or estimate a meal from a photo">
          <ActionForm action={parsePhoto} className="space-y-3">
            <Field label="Photo">
              <input
                type="file"
                name="photo"
                accept="image/*"
                capture="environment"
                required
                className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-black"
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Date">
                <Input type="date" name="date" defaultValue={todayISO()} />
              </Field>
              <Field label="Anything to add?" hint="Quantities you state beat the visual guess.">
                <Input name="note" placeholder="8oz chicken, 1 cup rice" />
              </Field>
            </div>
            <SubmitButton pendingLabel="Looking at your plate…">Estimate macros</SubmitButton>
          </ActionForm>
        </Card>

        <Card title="Recent imports">
          {!recent?.length ? (
            <Empty title="Nothing imported yet" />
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((r) => (
                <li key={r.id} className="py-2.5">
                  <Link href={`/import/${r.id}`} className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm">
                        {r.raw_text?.split("\n")[0] ?? "Photo import"}
                      </span>
                      <span className="text-xs text-muted">
                        {formatDate(String(r.created_at).slice(0, 10))} · {r.kind}
                      </span>
                    </span>
                    <Badge
                      tone={
                        r.status === "applied" ? "good" : r.status === "failed" ? "warn" : "default"
                      }
                    >
                      {r.status}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <p className="text-xs leading-relaxed text-muted">
          Claude never fills in a number your notes didn&rsquo;t support — an unstated weight
          stays blank rather than being guessed. Everything it does extract is shown for review
          before it touches your log, and the original text is kept so a bad parse can be redone.
        </p>
      </div>
    </main>
  );
}
