"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { BlockDocument } from "@/lib/editor/document";
import type { EventDocument } from "@/app/api/events/[id]/body/route";

/** Quiet period after the last keystroke before a save goes out. */
const DEBOUNCE_MS = 800;
/** A steady typist never stops typing, so saves are forced at this interval. */
const MAX_WAIT_MS = 5_000;
/** Bytes. The browser caps a keepalive request body at 64 KiB, shared across
 *  every in-flight keepalive request on the page. Stay comfortably under that. */
const KEEPALIVE_LIMIT = 60_000;

export type SaveState = "idle" | "pending" | "saving" | "saved" | "conflict" | "error";

/**
 * Debounced persistence for one event's body.
 *
 * The editor is never a controlled component — BlockNote owns its own document
 * and mirroring it into React state is the classic performance trap. This hook
 * only receives change notifications and decides when to POST.
 */
export function useBodyAutosave({
  eventId,
  initialRev,
  onConflict,
  basePath = "/api/events",
}: {
  eventId: string;
  initialRev: number;
  onConflict: (winning: EventDocument) => void;
  /** Override to `/api/pages` for standalone pages. */
  basePath?: string;
}) {
  const [state, setState] = useState<SaveState>("idle");
  const queryClient = useQueryClient();

  const revRef = useRef(initialRev);
  const pendingRef = useRef<BlockDocument | null>(null);
  const debounceRef = useRef<number | null>(null);
  const maxWaitRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const keepaliveRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    if (maxWaitRef.current !== null) window.clearTimeout(maxWaitRef.current);
    debounceRef.current = null;
    maxWaitRef.current = null;
  }, []);

  const flush = useCallback(
    async (options?: { keepalive?: boolean }) => {
      // OR'd in before the in-flight check, so a keepalive request made while a
      // plain save is already running still upgrades the loop's later passes —
      // the tab could hide mid-save, and that save's response is what the next
      // iteration needs to keep `revRef` moving forward.
      keepaliveRef.current ||= options?.keepalive ?? false;

      // A save is already running. It drains `pendingRef` in a loop, so whatever
      // arrived meanwhile goes out on its next pass rather than racing this one.
      if (inFlightRef.current) return;
      clearTimers();
      if (pendingRef.current === null) return;

      inFlightRef.current = true;
      try {
        while (pendingRef.current !== null) {
          const body = pendingRef.current;
          pendingRef.current = null;
          setState("saving");

          const payload = JSON.stringify({ body, baseRev: revRef.current });
          const response = await fetch(`${basePath}/${eventId}/body`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: payload,
            // Survives the page going away, as a beacon would, but still answers
            // while the page lives — which is what lets `revRef` follow the server.
            // `&&` short-circuits, so the encode only happens on the keepalive path —
            // `.length` is UTF-16 code units, not the bytes the browser caps against.
            keepalive:
              keepaliveRef.current &&
              new TextEncoder().encode(payload).byteLength < KEEPALIVE_LIMIT,
          });

          if (response.status === 409) {
            const { current } = (await response.json()) as { current: EventDocument };
            setState("conflict");
            onConflict(current);
            return;
          }

          if (!response.ok) {
            // Put the work back so the next change — or the next flush — retries
            // it instead of silently dropping the edit.
            pendingRef.current = body;
            setState("error");
            return;
          }

          const { bodyRev } = (await response.json()) as { bodyRev: number };
          revRef.current = bodyRev;
        }
        setState("saved");

        // The status window reads its checklist out of this body, so a saved body
        // is a stale status by definition. Without this the overlay keeps serving
        // the cached view until the next minute boundary — ticking a sub-task and
        // watching nothing move for the better part of a minute.
        //
        // Prefixed, because the key carries the minute it was fetched for.
        void queryClient.invalidateQueries({ queryKey: ["status"] });
      } catch {
        setState("error");
      } finally {
        inFlightRef.current = false;
        keepaliveRef.current = false;
      }
    },
    [basePath, clearTimers, eventId, onConflict, queryClient],
  );

  const scheduleSave = useCallback(
    (body: BlockDocument) => {
      pendingRef.current = body;
      setState("pending");

      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null;
        void flush();
      }, DEBOUNCE_MS);

      // Set once and left alone until a save runs, so the ceiling is measured
      // from the first unsaved keystroke rather than the most recent one.
      maxWaitRef.current ??= window.setTimeout(() => {
        maxWaitRef.current = null;
        void flush();
      }, MAX_WAIT_MS);
    },
    [flush],
  );

  useEffect(() => {
    function onHidden() {
      // Backgrounding a tab on mobile is often the last event before the OS
      // kills it, so this is the only reliable place to persist. A beacon would
      // survive that too, but its response is unreadable, so the revision it
      // advanced on the server was never learned client-side — the next save
      // then sent the stale revision and 409'd against itself. `keepalive`
      // survives the same unload while still resolving if the page lives on.
      if (document.visibilityState === "hidden") void flush({ keepalive: true });
    }
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [flush]);

  useEffect(() => {
    return () => {
      clearTimers();
      void flush({ keepalive: true });
    };
  }, [clearTimers, flush]);

  return { state, scheduleSave, flush };
}
