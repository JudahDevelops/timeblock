"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Horizontal travel that counts as a swipe rather than a stray finger. */
const DISTANCE_PX = 60;
/**
 * How much more horizontal than vertical the gesture has to be. The grid
 * scrolls vertically, so anything close to diagonal belongs to the scroll.
 */
const DIRECTION_RATIO = 1.5;
/** Past this the finger was resting, not flicking. */
const DURATION_MS = 700;

/**
 * Anything that owns its own horizontal gesture, or that a swipe across would
 * be a surprising way to page the calendar.
 */
const EXEMPT = 'input, textarea, select, [contenteditable], [role="dialog"], aside, .bn-root';

/**
 * Swipe left/right to page the calendar, by whatever period the current view
 * shows — the touch equivalent of `j` and `k`.
 *
 * Listens on the window rather than wrapping the grid: the calendar page
 * renders two different trees (month vs time grid) and a shared wrapper would
 * mean restructuring both.
 */
export function useSwipeNav(prev: string, next: string) {
  const router = useRouter();

  useEffect(() => {
    let start: { x: number; y: number; at: number } | null = null;

    function onTouchStart(event: TouchEvent) {
      // Two fingers is a pinch or a system gesture; neither is ours.
      if (event.touches.length !== 1) {
        start = null;
        return;
      }

      const target = event.target as Element | null;
      // A selected block claims its own drags — `aria-pressed` is how it says
      // so — and swiping one sideways is a move, not a page turn.
      if (target?.closest(`${EXEMPT}, [aria-pressed="true"]`)) {
        start = null;
        return;
      }

      const touch = event.touches[0];
      start = { x: touch.clientX, y: touch.clientY, at: Date.now() };
    }

    function onTouchEnd(event: TouchEvent) {
      const from = start;
      start = null;
      if (!from || event.changedTouches.length !== 1) return;

      const touch = event.changedTouches[0];
      const dx = touch.clientX - from.x;
      const dy = touch.clientY - from.y;

      if (Date.now() - from.at > DURATION_MS) return;
      if (Math.abs(dx) < DISTANCE_PX) return;
      if (Math.abs(dx) < Math.abs(dy) * DIRECTION_RATIO) return;

      // Dragging left pulls the following days into view, the way a paper
      // calendar moves under the hand.
      router.push(dx < 0 ? next : prev);
    }

    // A system gesture or an incoming call can end the sequence without a
    // touchend; without this the stale start would fire on the next release.
    function onTouchCancel() {
      start = null;
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [router, prev, next]);
}
