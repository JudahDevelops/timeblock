"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Anything smaller than this is the address bar collapsing, not a keyboard.
 */
const MIN_KEYBOARD_PX = 60;

function readInset(): number {
  const viewport = window.visualViewport;
  if (!viewport) return 0;
  const covered = window.innerHeight - viewport.height - viewport.offsetTop;
  return covered > MIN_KEYBOARD_PX ? Math.round(covered) : 0;
}

/**
 * How much of the screen the on-screen keyboard is covering, in CSS pixels.
 *
 * iOS shrinks the *visual* viewport when the keyboard opens but leaves the
 * layout viewport untouched, so anything anchored to the bottom of the screen
 * ends up hidden behind it. The gap between the two viewports is the only way
 * to measure that, and it is what lets the editor toolbar stay reachable.
 */
export function useKeyboardInset(): number {
  const subscribe = useCallback((onChange: () => void) => {
    const viewport = window.visualViewport;
    if (!viewport) return () => {};
    viewport.addEventListener("resize", onChange);
    // Scroll too: iOS pans the visual viewport to keep the caret visible, which
    // moves the bottom edge without ever firing a resize.
    viewport.addEventListener("scroll", onChange);
    return () => {
      viewport.removeEventListener("resize", onChange);
      viewport.removeEventListener("scroll", onChange);
    };
  }, []);

  return useSyncExternalStore(subscribe, readInset, () => 0);
}
