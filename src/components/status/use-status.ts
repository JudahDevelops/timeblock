"use client";

import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import type { StatusView } from "@/lib/status/resolve";

/** How often the window re-reads the clock. Matches the now-indicator's cadence. */
const TICK_MS = 60_000;

/**
 * The wall clock, as an external store.
 *
 * `useSyncExternalStore` rather than `useState` + an effect, matching
 * `use-media-query.ts`: the clock is external state React has to read during
 * render, and mirroring it into state means a `setState` in an effect body,
 * which `react-hooks/set-state-in-effect` rejects.
 *
 * The snapshot is the minute rather than the instant, so it is stable between
 * ticks — `useSyncExternalStore` compares snapshots by identity and a fresh
 * `Date` every read would loop forever. `null` on the server because "now"
 * belongs to the viewer's timezone and would hydrate stale.
 */
export function useNow(): Date | null {
  const minute = useSyncExternalStore(subscribeToClock, currentMinute, () => null);
  return minute === null ? null : new Date(minute * TICK_MS);
}

let listeners: (() => void)[] = [];
let timer: ReturnType<typeof setInterval> | null = null;

/** One interval for every consumer — the grid runs one per visible day column. */
function subscribeToClock(onChange: () => void): () => void {
  listeners.push(onChange);
  timer ??= setInterval(() => {
    for (const listener of listeners) listener();
  }, TICK_MS);

  return () => {
    listeners = listeners.filter((listener) => listener !== onChange);
    if (listeners.length === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function currentMinute(): number {
  return Math.floor(Date.now() / TICK_MS);
}

/**
 * The resolved status view.
 *
 * Keyed on the minute rather than on the raw instant, so the query refetches
 * once a minute instead of on every render. The server does the resolving:
 * keeping the ladder on one side of the wire means the HUD and the overlay can
 * never disagree about which block is current.
 */
export function useStatus(now: Date | null) {
  const iso = now?.toISOString() ?? null;

  return useQuery<StatusView>({
    queryKey: ["status", iso],
    enabled: iso !== null,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/status?now=${encodeURIComponent(iso ?? "")}`, { signal });
      if (!response.ok) throw new Error("status_failed");
      return reviveDates(await response.json());
    },
    // A minute-old answer is still the same minute's answer, and keeping the
    // previous view mounted stops the HUD blanking on every tick.
    placeholderData: (previous) => previous,
    staleTime: TICK_MS,
  });
}

/** JSON has no Date, so the instants come back as strings and are rebuilt here. */
function reviveDates(value: unknown): StatusView {
  const view = value as Record<string, unknown>;

  if (view.block) {
    const block = view.block as Record<string, unknown>;
    block.startsAt = new Date(block.startsAt as string);
    block.endsAt = new Date(block.endsAt as string);
  }
  if (view.nextBlock) {
    const next = view.nextBlock as Record<string, unknown>;
    next.startsAt = new Date(next.startsAt as string);
  }
  if (view.later) {
    const later = view.later as Record<string, unknown>;
    if (later.dayEndsAt) later.dayEndsAt = new Date(later.dayEndsAt as string);
  }

  return view as unknown as StatusView;
}
