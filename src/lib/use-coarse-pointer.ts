"use client";

import { useCallback, useSyncExternalStore } from "react";

const QUERY = "(pointer: coarse)";

/**
 * True when the primary pointer is a finger rather than a mouse.
 *
 * Used for affordances that only make sense without hover — visible drag
 * handles, tap-to-create, long-press menus. Gesture *handlers* branch on
 * `event.pointerType` instead, since a hybrid device can have both.
 */
export function useCoarsePointer(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const query = window.matchMedia(QUERY);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    // The server cannot know the input device; assume a mouse so the markup
    // matches, then hydration corrects it before any interaction is possible.
    () => false,
  );
}
