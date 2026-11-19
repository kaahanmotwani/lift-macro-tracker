"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { parseNextChunk, type ChunkProgress } from "@/app/actions/import";
import { Button } from "@/components/ui";

/** Two pieces in flight at once: roughly halves the wait without tripping rate limits. */
const WORKERS = 2;

/**
 * Drives a chunked import from the browser: each call to `parseNextChunk` is
 * its own server request that reads one piece of the paste, so no single
 * request runs long. Progress is saved per piece on the server — leaving this
 * page pauses the import, and coming back resumes it.
 */
export function ImportProgress({
  importId,
  initialCompleted,
  total,
}: {
  importId: string;
  initialCompleted: number;
  total: number;
}) {
  const router = useRouter();
  const [completed, setCompleted] = useState(initialCompleted);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  const started = useRef(-1);

  useEffect(() => {
    // Strict mode runs effects twice in development; start each run once.
    if (started.current === run) return;
    started.current = run;
    let cancelled = false;

    async function worker(): Promise<ChunkProgress | null> {
      while (!cancelled) {
        let p: ChunkProgress;
        try {
          p = await parseNextChunk(importId);
        } catch {
          setError("Lost connection to the server. Your progress is saved.");
          return null;
        }
        setCompleted((c) => Math.max(c, p.completed));
        if (!p.ok) {
          setError(p.error ?? "Something went wrong.");
          return p;
        }
        if (p.finished || !p.claimed) return p;
      }
      return null;
    }

    setError(null);
    Promise.all(Array.from({ length: WORKERS }, worker)).then((results) => {
      if (cancelled) return;
      if (results.some((r) => r?.finished)) router.refresh();
      // Otherwise another request is still finishing its piece; the page will
      // pick it up on refresh, or a stale claim is retried automatically.
      else if (results.every((r) => r?.ok)) setTimeout(() => router.refresh(), 4000);
    });

    return () => {
      cancelled = true;
    };
  }, [importId, router, run]);

  const pct = total ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="font-medium">Reading your notes…</p>
      <p className="mt-1 text-sm text-muted">
        Part {Math.min(completed + 1, total)} of {total}. A long history is read in pieces so
        nothing gets cut off. Keep this page open — if you leave, it picks up where it stopped
        when you come back.
      </p>
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={completed}
      >
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="tabular mt-1 text-right text-xs text-muted">
        {completed} / {total} parts
      </p>

      {error && (
        <div className="mt-3 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          <p>{error}</p>
          <div className="mt-2 flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setRun((r) => r + 1)}>
              Try again
            </Button>
            {/key|Settings/i.test(error) && (
              <Link href="/settings">
                <Button type="button" variant="ghost">
                  Open Settings
                </Button>
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
