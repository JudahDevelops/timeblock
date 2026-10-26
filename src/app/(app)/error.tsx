"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Recoverable failures inside the app shell — a query that threw mid-render.
 *
 * Scoped to the group rather than the route so the sidebar and session survive:
 * `reset()` re-renders this segment alone, which is usually enough for a
 * transient database blip and costs the user nothing.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is the only handle on the server-side stack — React strips the
    // message in production, so logging it here is what makes the two ends of a
    // report joinable.
    console.error("App segment error", error.digest, error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-sm space-y-4 text-center">
        <h1 className="text-lg font-semibold tracking-tight">Something broke</h1>
        <p className="text-ink-muted text-sm">
          This part of the app failed to load. Your blocks are safe — nothing here writes on render.
        </p>
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="bg-ink text-surface rounded-md px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-90"
          >
            Try again
          </button>
          <Link
            href="/"
            className="text-ink-muted hover:text-ink rounded-md px-3 py-1.5 text-sm transition-colors"
          >
            Back to today
          </Link>
        </div>
        {error.digest ? (
          <p className="text-ink-faint font-mono text-[11px]">{error.digest}</p>
        ) : null}
      </div>
    </div>
  );
}
