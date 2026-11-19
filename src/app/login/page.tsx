import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · Lift & Macro Tracker" };

export default async function LoginPage() {
  if (await getUser()) redirect("/");

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 py-10">
      <div>
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-black">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M4 9v6M8 7v10M16 7v10M20 9v6M8 12h8" />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold">Lift &amp; Macro Tracker</h1>
        <p className="mt-2 text-sm text-muted">
          Your own private log. Paste your gym notes, snap a photo of dinner, and find out
          whether you&rsquo;re actually getting stronger.
        </p>
      </div>

      <LoginForm />

      <p className="text-xs leading-relaxed text-muted">
        Your training and food data is visible only to you — it&rsquo;s isolated at the
        database level, not just in the app. AI features use an Anthropic API key you add
        yourself after signing in, so nobody else pays for or sees your requests.
      </p>
    </main>
  );
}
