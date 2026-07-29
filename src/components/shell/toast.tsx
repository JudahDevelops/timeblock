"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

/**
 * How long a message stays up. Long enough to read a sentence, short enough
 * that it is gone before it starts covering the block it is about.
 */
const DISMISS_MS = 5000;

const ToastContext = createContext<(message: string) => void>(() => {});

/**
 * Tells the user when an optimistic write was taken back.
 *
 * The grid draws local writes before the server has agreed to them, so a
 * failure has to undo something the user already saw happen. Reverting in
 * silence reads as the app losing their work at random; this is the one place
 * that says otherwise. Deliberately hand-rolled and singular — a toast library
 * is a lot of surface for the four messages this app can produce.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  /** Bumped per call so the same message twice still restarts the timer. */
  const [seq, setSeq] = useState(0);

  const show = useCallback((next: string) => {
    setMessage(next);
    setSeq((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), DISMISS_MS);
    return () => clearTimeout(timer);
  }, [message, seq]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {/* Always mounted, so a screen reader announces into a region that was
          already there rather than one that appeared with the text inside it. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
      >
        {message ? (
          <div className="pointer-events-auto flex items-center gap-3 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-zinc-50 shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
            <span>{message}</span>
            <button
              type="button"
              onClick={() => setMessage(null)}
              className="text-xs text-zinc-400 transition-colors hover:text-zinc-200 dark:text-zinc-500 dark:hover:text-zinc-700"
            >
              Dismiss
            </button>
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Shows a message. Stable across renders, so it is safe in a `useCallback`
 * dependency list; outside the provider it is a no-op rather than a throw,
 * because a missing toast must never be what breaks a save.
 */
export function useToast(): (message: string) => void {
  return useContext(ToastContext);
}
