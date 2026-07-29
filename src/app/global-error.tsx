"use client";

import { useEffect } from "react";

// The root layout is what failed, so its stylesheet never loaded. This boundary
// replaces the whole document and has to bring its own.
import "./globals.css";

/**
 * The last resort: a crash in the root layout itself, which the segment
 * boundaries sit inside and therefore cannot catch.
 *
 * Deliberately plain. Anything clever here has its own way of failing, and this
 * is the screen that has to render when nothing else did.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Root layout error", error.digest, error);
  }, [error]);

  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex h-full items-center justify-center bg-white p-8 dark:bg-zinc-950">
        <div className="max-w-sm space-y-4 text-center">
          <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Timeblock failed to start
          </h1>
          <p className="text-sm text-zinc-500">
            Reloading usually clears it. Nothing has been lost — everything you have written is
            already saved.
          </p>
          <button
            type="button"
            onClick={reset}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-zinc-50 transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Reload
          </button>
          {error.digest ? (
            <p className="font-mono text-[11px] text-zinc-400">{error.digest}</p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
