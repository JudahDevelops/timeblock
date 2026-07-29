"use client";

import { useMediaQuery } from "./use-media-query";

/**
 * True when the primary pointer is a finger rather than a mouse.
 *
 * Used for affordances that only make sense without hover — visible drag
 * handles, tap-to-create, long-press menus. Gesture *handlers* branch on
 * `event.pointerType` instead, since a hybrid device can have both.
 *
 * The server cannot know the input device, so it assumes a mouse: hydration
 * corrects it well before any interaction is possible.
 */
export function useCoarsePointer(): boolean {
  return useMediaQuery("(pointer: coarse)", false);
}
