"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, Input } from "@/components/ui";

/**
 * Two ways in: Google, or a one-time email link. Both are passwordless on
 * purpose — there is no password to store, leak, or reset, and no "create an
 * account" step for someone who just wants to try the app.
 */
export function LoginForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const redirectTo =
    typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : undefined;

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo },
    });
    if (error) {
      setError(error.message);
      setStatus("idle");
    } else {
      setStatus("sent");
    }
  }

  async function signInWithGoogle() {
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) setError(error.message);
  }

  if (status === "sent") {
    return (
      <div className="rounded-2xl border border-line bg-surface p-4">
        <p className="font-medium">Check your email</p>
        <p className="mt-1 text-sm text-muted">
          We sent a sign-in link to <span className="text-fg">{email}</span>. Open it
          on this device.
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="mt-3 text-sm text-accent"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Button variant="secondary" className="w-full" onClick={signInWithGoogle}>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
          <path
            fill="#4285F4"
            d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7C21.7 18.9 23 15.9 23 12.3z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3C3.7 21.5 7.6 24 12 24z"
          />
          <path fill="#FBBC05" d="M5.6 14.7a7.2 7.2 0 0 1 0-4.6v-3H1.8a12 12 0 0 0 0 10.6z" />
          <path
            fill="#EA4335"
            d="M12 4.8c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.7 1.2 15.1 0 12 0 7.6 0 3.7 2.5 1.8 6.1l3.8 3a7.1 7.1 0 0 1 6.4-4.3z"
          />
        </svg>
        Continue with Google
      </Button>

      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={sendLink} className="space-y-2">
        <Input
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button type="submit" className="w-full" disabled={status === "sending"}>
          {status === "sending" ? "Sending…" : "Email me a sign-in link"}
        </Button>
      </form>

      {error && (
        <p role="alert" className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
