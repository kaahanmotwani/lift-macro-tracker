import Link from "next/link";
import { getProfile, requireUser } from "@/lib/supabase/server";
import { resolveTargets } from "@/lib/data";
import { saveApiKey, saveProfile } from "@/app/actions/settings";
import { saveTargets } from "@/app/actions/diet";
import { Button, Card, Field, Input, Select, Stat } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/form";
import { TopBar } from "@/components/nav";
import { todayISO } from "@/lib/units";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const [profile, targets] = await Promise.all([getProfile(), resolveTargets()]);
  const unit = profile?.weight_unit ?? "lb";

  return (
    <main>
      <TopBar title="Settings" />

      <div className="space-y-4">
        <Card title="You">
          <ActionForm action={saveProfile} className="space-y-3">
            <Field label="Name">
              <Input name="display_name" defaultValue={profile?.display_name ?? ""} />
            </Field>
            <Field label="Weight unit" hint="Everything is stored in pounds; this only changes what you see and type.">
              <Select name="weight_unit" defaultValue={unit}>
                <option value="lb">Pounds (lb)</option>
                <option value="kg">Kilograms (kg)</option>
              </Select>
            </Field>
            <Field label="Claude model" hint="Opus 5 is the most capable. Haiku is cheaper and faster but noticeably worse at messy notes.">
              <Select name="model" defaultValue={profile?.model ?? "claude-opus-5"}>
                <option value="claude-opus-5">Claude Opus 5 (recommended)</option>
                <option value="claude-sonnet-5">Claude Sonnet 5</option>
                <option value="claude-haiku-4-5">Claude Haiku 4.5 (cheapest)</option>
              </Select>
            </Field>
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
          <p className="mt-3 text-xs text-muted">Signed in as {user.email}</p>
        </Card>

        <Card title="Anthropic API key">
          <p className="mb-3 text-sm text-muted">
            AI features — importing notes, estimating meals from photos, insights — run on your
            own Anthropic account, so nobody else pays for or sees your requests. Typical cost is
            a few cents per import.
          </p>
          <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>
              Go to{" "}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noreferrer"
                className="text-accent underline"
              >
                console.anthropic.com
              </a>{" "}
              and create an account.
            </li>
            <li>Add a little credit (a few dollars goes a long way).</li>
            <li>Create an API key and paste it below.</li>
          </ol>

          {profile?.anthropic_key_hint ? (
            <p className="mb-3 rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-300">
              Key saved and working — ends in …{profile.anthropic_key_hint}
            </p>
          ) : null}

          <ActionForm action={saveApiKey} className="space-y-3">
            <Field label={profile?.anthropic_key_hint ? "Replace key" : "API key"}>
              <Input
                name="api_key"
                type="password"
                autoComplete="off"
                placeholder="sk-ant-api03-…"
                className="font-mono text-xs"
              />
            </Field>
            <SubmitButton pendingLabel="Verifying…">Verify &amp; save</SubmitButton>
          </ActionForm>

          <p className="mt-3 text-xs text-muted">
            Stored encrypted (AES-256-GCM). It&rsquo;s decrypted only in memory, only for your own
            requests, and never sent anywhere except Anthropic.
          </p>
        </Card>

        <Card title="Daily targets">
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Stat
              label="Protein target"
              value={targets.proteinTarget ?? "—"}
              sub="g per day"
              tone="accent"
            />
            <Stat
              label="Latest bodyweight"
              value={targets.bodyweightLbs ? Math.round(targets.bodyweightLbs) : "—"}
              sub="lb"
            />
          </div>

          <ActionForm action={saveTargets} className="space-y-3">
            <input type="hidden" name="effective_from" value={todayISO()} />
            <Field
              label="Protein"
              hint="Bodyweight mode recalculates from your latest weigh-in, so the target follows you instead of going stale."
            >
              <Select name="protein_mode" defaultValue={targets.target?.protein_mode ?? "bodyweight"}>
                <option value="bodyweight">Multiple of bodyweight</option>
                <option value="manual">Fixed number of grams</option>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="× bodyweight (lb)">
                <Input
                  name="protein_multiplier"
                  type="number"
                  step="0.05"
                  defaultValue={targets.target?.protein_multiplier ?? 0.8}
                />
              </Field>
              <Field label="…or fixed grams">
                <Input name="protein_g" type="number" defaultValue={targets.target?.protein_g ?? ""} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Calories">
                <Input name="kcal" type="number" defaultValue={targets.target?.kcal ?? ""} />
              </Field>
              <Field label="Carbs (g)">
                <Input name="carbs_g" type="number" defaultValue={targets.target?.carbs_g ?? ""} />
              </Field>
              <Field label="Fat (g)">
                <Input name="fat_g" type="number" defaultValue={targets.target?.fat_g ?? ""} />
              </Field>
              <Field label="Fiber (g)">
                <Input name="fiber_g" type="number" defaultValue={targets.target?.fiber_g ?? ""} />
              </Field>
            </div>
            <SubmitButton>Save targets</SubmitButton>
          </ActionForm>
        </Card>

        <Card title="Install on your phone">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>Open this site in Safari on your iPhone.</li>
            <li>
              Tap the Share button, then <strong className="text-fg">Add to Home Screen</strong>.
            </li>
            <li>It opens full-screen with its own icon, like any other app.</li>
          </ol>
          <p className="mt-2 text-xs text-muted">
            Android: Chrome menu → Install app. Same result.
          </p>
        </Card>

        <Card title="Your data">
          <p className="mb-3 text-sm text-muted">
            Everything you&rsquo;ve logged, as JSON. Your data, your copy.
          </p>
          <Link href="/api/export" className="inline-block">
            <Button variant="secondary" type="button">
              Download export
            </Button>
          </Link>
        </Card>

        <form action="/auth/signout" method="post">
          <Button variant="danger" type="submit" className="w-full">
            Sign out
          </Button>
        </form>
      </div>
    </main>
  );
}
