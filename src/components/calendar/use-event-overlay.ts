"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import type { CalendarEvent } from "@/server/queries/events";

/**
 * How long a local write outranks the server.
 *
 * Long enough that a write still travelling — the action, the revalidation, the
 * RSC payload — is never overtaken by the stale props it is racing. Short
 * enough that an entry the server will never agree with, because it quietly
 * stored something else, cannot shadow inbound Google edits to that block for
 * the rest of the session. That is what an overlay with no expiry does.
 */
const SETTLE_MS = 15_000;

/** Whether the server has caught up with what we drew locally. */
function agrees(server: CalendarEvent, local: CalendarEvent): boolean {
  return (
    server.title === local.title &&
    server.allDay === local.allDay &&
    server.startsAt.getTime() === local.startsAt.getTime() &&
    server.endsAt.getTime() === local.endsAt.getTime()
  );
}

function without<T>(map: Record<string, T>, id: string): Record<string, T> {
  if (!(id in map)) return map;
  const next = { ...map };
  delete next[id];
  return next;
}

export type EventOverlay = {
  /** Server rows with local writes drawn over them, and deletions taken out. */
  merged: CalendarEvent[];
  /** Draw a row as it will be once the server agrees. */
  apply: (event: CalendarEvent) => void;
  /** Take a row back down — the write failed. */
  revert: (id: string) => void;
  /** Take a row off the grid before the delete has landed. */
  hide: (id: string) => void;
  /** Put it back — the delete failed. */
  unhide: (id: string) => void;
};

/**
 * Draws local writes immediately and stops drawing them once they are redundant.
 *
 * Server Components hand the grid a fresh `events` array on every revalidation,
 * which is the correct source of truth and also several hundred milliseconds
 * behind the pointer. This keeps a small map of writes that have been made but
 * not yet confirmed and merges it over those props, so the grid answers at the
 * speed of the interaction rather than the speed of the round trip.
 *
 * An entry stops counting during the same render that first carries a server
 * row saying the same thing — which is what removes the flash, and is why
 * `useOptimistic` is not used here. That hook discards its state when the
 * transition ends, and the transition ends strictly before the new props
 * arrive; the gap is a frame showing the old value.
 */
export function useEventOverlay(events: CalendarEvent[]): EventOverlay {
  const [pending, setPending] = useState<Record<string, CalendarEvent>>({});
  const [removed, setRemoved] = useState<Record<string, true>>({});

  /**
   * Expiry runs on a timer rather than a timestamp compared during render,
   * because reading the clock while rendering is not something a component may
   * do — the result changes between two renders that should be identical.
   */
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const expire = useCallback((id: string, drop: () => void) => {
    clearTimeout(timers.current.get(id));
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        drop();
      }, SETTLE_MS),
    );
  }, []);

  const merged = useMemo(() => {
    const rows: CalendarEvent[] = [];

    for (const server of events) {
      if (server.id in removed) continue;
      const local = pending[server.id];
      // Once the server says the same thing, the entry is redundant rather
      // than wrong, so stepping back to the server row changes nothing on
      // screen. That is the whole trick.
      rows.push(local && !agrees(server, local) ? local : server);
    }

    // A block created a moment ago has no server row yet, so it is carried
    // entirely by the overlay until one turns up.
    for (const [id, local] of Object.entries(pending)) {
      if (id in removed || events.some((e) => e.id === id)) continue;
      rows.push(local);
    }

    return rows;
  }, [events, pending, removed]);

  const revert = useCallback((id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setPending((o) => without(o, id));
  }, []);

  const unhide = useCallback((id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setRemoved((o) => without(o, id));
  }, []);

  const apply = useCallback(
    (event: CalendarEvent) => {
      setPending((o) => ({ ...o, [event.id]: event }));
      expire(event.id, () => setPending((o) => without(o, event.id)));
    },
    [expire],
  );

  const hide = useCallback(
    (id: string) => {
      setRemoved((o) => ({ ...o, [id]: true }));
      // A delete that never landed puts the block back rather than leaving a
      // hole the user has no way to explain.
      expire(id, () => setRemoved((o) => without(o, id)));
    },
    [expire],
  );

  return { merged, apply, revert, hide, unhide };
}
