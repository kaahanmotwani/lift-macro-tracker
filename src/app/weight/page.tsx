import { getProfile } from "@/lib/supabase/server";
import { listBodyweight, resolveTargets } from "@/lib/data";
import { deleteBodyweight, logBodyweight, updateBodyweight } from "@/app/actions/weight";
import { Card, Empty, Field, Input, Select, Stat } from "@/components/ui";
import { MiniSubmit, SubmitButton, Disclosure } from "@/components/form";
import { LineChart, SERIES } from "@/components/charts";
import { TopBar } from "@/components/nav";
import { formatDate, fromLbs, round, todayISO } from "@/lib/units";

export const metadata = { title: "Weight" };

export default async function WeightPage() {
  const [profile, logs, targets] = await Promise.all([
    getProfile(),
    listBodyweight(200),
    resolveTargets(),
  ]);

  const unit = profile?.weight_unit ?? "lb";
  const latest = logs[0];
  const oldest = logs[logs.length - 1];
  const change = latest && oldest ? latest.weight_lbs - oldest.weight_lbs : 0;

  // Ascending for the chart; the list below reads newest-first.
  const chronological = [...logs].reverse();

  return (
    <main>
      <TopBar title="Weight" />

      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <Stat
            label="Latest"
            value={latest ? round(fromLbs(latest.weight_lbs, unit), 1) : "—"}
            sub={latest ? formatDate(latest.date, { weekday: undefined }) : unit}
            tone="accent"
          />
          <Stat
            label="Change"
            value={`${change >= 0 ? "+" : ""}${round(fromLbs(change, unit), 1)}`}
            sub={`${unit} over ${logs.length} entries`}
          />
          <Stat
            label="Protein target"
            value={targets.proteinTarget ?? "—"}
            sub={
              targets.target?.protein_mode === "bodyweight"
                ? `${targets.target.protein_multiplier}× bodyweight`
                : "manual"
            }
          />
        </div>

        <Card title="Log a weigh-in">
          <form action={logBodyweight} className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <Field label="Weight" className="col-span-2">
                <Input
                  name="weight"
                  type="number"
                  step="0.1"
                  inputMode="decimal"
                  required
                  autoFocus
                  placeholder={latest ? String(round(fromLbs(latest.weight_lbs, unit), 1)) : "175"}
                />
              </Field>
              <Field label="Unit">
                <Select name="unit" defaultValue={unit}>
                  <option value="lb">lb</option>
                  <option value="kg">kg</option>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Date">
                <Input type="date" name="date" defaultValue={todayISO()} />
              </Field>
              <Field label="Time (optional)">
                <Input type="time" name="time" />
              </Field>
            </div>
            <Field label="Note">
              <Input name="note" placeholder="Morning, before food" />
            </Field>
            <SubmitButton pendingLabel="Saving…">Log weight</SubmitButton>
          </form>
        </Card>

        {chronological.length >= 2 && (
          <LineChart
            title={`Bodyweight (${unit})`}
            unit={unit}
            yFromZero={false}
            color={SERIES.s1}
            points={chronological.map((l) => ({
              date: l.date,
              value: round(fromLbs(l.weight_lbs, unit), 1),
            }))}
          />
        )}

        <Card title="History">
          {logs.length === 0 ? (
            <Empty title="No weigh-ins yet">Log one above to start the trend.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {logs.map((l) => (
                <li key={l.id} className="py-2">
                  <div className="flex items-center justify-between">
                    <span>
                      <span className="tabular font-medium">
                        {round(fromLbs(l.weight_lbs, unit), 1)} {unit}
                      </span>
                      <span className="ml-2 text-xs text-muted">
                        {formatDate(l.date)}
                        {l.logged_at
                          ? ` · ${new Date(l.logged_at).toLocaleTimeString(undefined, {
                              hour: "numeric",
                              minute: "2-digit",
                            })}`
                          : ""}
                      </span>
                      {l.note && (
                        <span className="block text-xs text-muted">{l.note}</span>
                      )}
                    </span>
                    <form action={deleteBodyweight}>
                      <input type="hidden" name="id" value={l.id} />
                      <MiniSubmit title="Delete">×</MiniSubmit>
                    </form>
                  </div>

                  <Disclosure label="Edit">
                    <form action={updateBodyweight} className="space-y-3">
                      <input type="hidden" name="id" value={l.id} />
                      <div className="grid grid-cols-3 gap-2">
                        <Field label="Weight" className="col-span-2">
                          <Input
                            name="weight"
                            type="number"
                            step="0.1"
                            defaultValue={round(fromLbs(l.weight_lbs, unit), 1)}
                          />
                        </Field>
                        <Field label="Unit">
                          <Select name="unit" defaultValue={unit}>
                            <option value="lb">lb</option>
                            <option value="kg">kg</option>
                          </Select>
                        </Field>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="Date">
                          <Input type="date" name="date" defaultValue={l.date} />
                        </Field>
                        <Field label="Time">
                          <Input
                            type="time"
                            name="time"
                            defaultValue={
                              l.logged_at
                                ? new Date(l.logged_at).toTimeString().slice(0, 5)
                                : ""
                            }
                          />
                        </Field>
                      </div>
                      <Field label="Note">
                        <Input name="note" defaultValue={l.note ?? ""} />
                      </Field>
                      <SubmitButton variant="secondary">Save changes</SubmitButton>
                    </form>
                  </Disclosure>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </main>
  );
}
