"use client";

import Link from "next/link";
import { Button } from "@/components/ui";

/**
 * Shown when a page throws. Most failures here are configuration (missing env
 * vars, schema not run) or a network hiccup talking to Supabase, so the copy
 * points at those rather than saying "something went wrong".
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4">
      <h1 className="text-xl font-semibold">That page didn&rsquo;t load</h1>
      <p className="text-sm text-[--color-muted]">
        {error.message || "An unexpected error occurred."}
      </p>
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Link href="/">
          <Button variant="secondary" type="button">
            Go home
          </Button>
        </Link>
      </div>
      {error.digest && (
        <p className="text-xs text-[--color-muted]">Reference: {error.digest}</p>
      )}
      <p className="text-xs leading-relaxed text-[--color-muted]">
        If this keeps happening right after setup, the usual causes are a missing environment
        variable or the database schema not having been run — see DEPLOY.md.
      </p>
    </main>
  );
}
