"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui";
import type { ActionResult } from "@/lib/types";

/** A submit button that disables and relabels itself while the action is in flight. */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  className,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} className={className}>
      {pending ? (pendingLabel ?? "Working…") : children}
    </Button>
  );
}

/** Small inline icon-ish button for row actions (delete a set, remove a segment). */
export function MiniSubmit({
  children,
  title,
  className = "",
  form,
}: {
  children: React.ReactNode;
  title: string;
  className?: string;
  /** Submits a form declared elsewhere in the document — HTML forms can't nest. */
  form?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      form={form}
      title={title}
      aria-label={title}
      // useFormStatus only reports on the enclosing form, so a button pointed at
      // another form must not be disabled by it.
      disabled={form ? undefined : pending}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-muted transition hover:text-fg disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * Wraps a server action that returns ActionResult and renders its success or
 * error message inline. Errors from AI calls in particular need to be *shown*,
 * not swallowed — "your API key was rejected" is actionable; a spinner that
 * stops is not.
 */
export function ActionForm<T>({
  action,
  children,
  className = "",
  successHint,
}: {
  /**
   * Server actions used here take (previousState, formData) — that's the
   * signature useActionState calls them with.
   */
  action: (prev: ActionResult<T> | null, fd: FormData) => Promise<ActionResult<T>>;
  children: React.ReactNode;
  className?: string;
  successHint?: string;
}) {
  const [state, formAction] = useActionState<ActionResult<T> | null, FormData>(action, null);

  return (
    <form action={formAction} className={className}>
      {children}
      {state && !state.ok && (
        <p role="alert" className="mt-2 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {state.error}
        </p>
      )}
      {state?.ok && (state.message || successHint) && (
        <p className="mt-2 rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-300">
          {state.message ?? successHint}
        </p>
      )}
    </form>
  );
}

/** A details/summary disclosure that keeps long forms off the first screen. */
export function Disclosure({
  label,
  children,
  defaultOpen = false,
}: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-line">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-between px-3 text-sm text-fg"
      >
        {label}
        <span className="text-muted">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="border-t border-line p-3">{children}</div>}
    </div>
  );
}
