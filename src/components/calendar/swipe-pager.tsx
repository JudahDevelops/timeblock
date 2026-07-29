"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** Travel before the gesture is claimed as a page turn rather than a scroll. */
const DECIDE_PX = 10;
/**
 * How much more horizontal than vertical the movement has to be at the moment
 * of that decision. The grid's whole job is to scroll up and down, so anything
 * near diagonal belongs to the scroll.
 */
const DIRECTION_RATIO = 1.2;

/** Fraction of the pane that must pass under the finger to turn the page. */
const COMMIT_FRACTION = 0.2;
const COMMIT_MIN_PX = 56;
/** A flick counts even when it barely travelled: short, fast, decisive. */
const FLICK_MS = 250;
const FLICK_PX = 28;

/**
 * The pane trails the finger rather than matching it. There is no neighbouring
 * week rendered behind this one — that would mean fetching and laying out three
 * grids to show one — so a 1:1 follow would drag a wide blank into view. At
 * roughly half speed the movement still reads as direct while the gap stays
 * narrow enough to pass for an edge.
 */
const FOLLOW = 0.5;

/** Long enough to read as deceleration, short enough not to feel held up. */
const SNAP_MS = 220;
const SNAP_EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";

/** Anything that owns its own horizontal gesture, or its own text selection. */
const EXEMPT = "input, textarea, select, [contenteditable], .bn-root";

/**
 * Swipe sideways to page the calendar by whatever period the current view
 * shows — the touch equivalent of `j` and `k`.
 *
 * The pane follows the finger instead of jumping on release, because a
 * calendar that changes with no movement gives you nothing to tell a page turn
 * apart from a mis-tap. Below the commit threshold it springs back, which is
 * the part that makes the gesture safe to try.
 */
export function SwipePager({
  prev,
  next,
  children,
}: {
  prev: string;
  next: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const paneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;

    let start: { x: number; y: number; at: number } | null = null;
    /** Which way this gesture went once it committed to one. */
    let axis: "undecided" | "x" | "y" = "undecided";
    let dx = 0;

    function settle() {
      if (!pane) return;
      pane.style.transition = `transform ${SNAP_MS}ms ${SNAP_EASE}`;
      pane.style.transform = "";
      // Cleared rather than left on: a lingering `will-change` keeps a layer
      // alive, and — like the transform itself — makes this element the
      // containing block for the drawer's `position: fixed`.
      window.setTimeout(() => {
        if (pane && !start) {
          pane.style.transition = "";
          pane.style.willChange = "";
        }
      }, SNAP_MS);
    }

    function onTouchStart(event: TouchEvent) {
      start = null;
      axis = "undecided";
      dx = 0;

      // Two fingers is a pinch or a system gesture; neither is ours.
      if (event.touches.length !== 1) return;

      // A sheet or the drawer is up. Both are `position: fixed`, and a
      // transform on this element would make *it* their containing block —
      // so the page must not slide while one is open, quite apart from the
      // fact that a swipe over a menu means nothing.
      if (document.querySelector('[role="dialog"]')) return;

      const target = event.target as Element | null;
      // A selected block claims its own drags — `aria-pressed` is how it says
      // so — and pulling one sideways moves it to another day.
      if (target?.closest(`${EXEMPT}, [aria-pressed="true"]`)) return;

      const touch = event.touches[0];
      start = { x: touch.clientX, y: touch.clientY, at: Date.now() };
    }

    function onTouchMove(event: TouchEvent) {
      if (!start || !pane || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const moveX = touch.clientX - start.x;
      const moveY = touch.clientY - start.y;

      if (axis === "undecided") {
        if (Math.max(Math.abs(moveX), Math.abs(moveY)) < DECIDE_PX) return;
        axis = Math.abs(moveX) > Math.abs(moveY) * DIRECTION_RATIO ? "x" : "y";
        if (axis === "y") {
          start = null;
          return;
        }
        pane.style.willChange = "transform";
        pane.style.transition = "";
      }

      dx = moveX;
      // The listener is registered non-passively for exactly this: once the
      // gesture is horizontal the grid must stop scrolling under it, or the
      // day slides sideways and up at the same time.
      if (event.cancelable) event.preventDefault();
      pane.style.transform = `translate3d(${dx * FOLLOW}px, 0, 0)`;
    }

    function onTouchEnd() {
      const from = start;
      start = null;
      if (!from || axis !== "x" || !pane) {
        axis = "undecided";
        return;
      }
      axis = "undecided";

      const width = pane.getBoundingClientRect().width || 1;
      const far = Math.abs(dx) > Math.max(COMMIT_MIN_PX, width * COMMIT_FRACTION);
      const flicked = Date.now() - from.at < FLICK_MS && Math.abs(dx) > FLICK_PX;

      // Pushed before the spring back rather than after it: both paths are
      // prefetched by the toolbar's arrows, so the new period lands while the
      // pane is still travelling home and the two read as one movement.
      if (far || flicked) router.push(dx < 0 ? next : prev);
      settle();
    }

    function onTouchCancel() {
      start = null;
      axis = "undecided";
      settle();
    }

    pane.addEventListener("touchstart", onTouchStart, { passive: true });
    pane.addEventListener("touchmove", onTouchMove, { passive: false });
    pane.addEventListener("touchend", onTouchEnd, { passive: true });
    pane.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      pane.removeEventListener("touchstart", onTouchStart);
      pane.removeEventListener("touchmove", onTouchMove);
      pane.removeEventListener("touchend", onTouchEnd);
      pane.removeEventListener("touchcancel", onTouchCancel);
    };
    // `prev` and `next` change only once the calendar has already moved, so
    // rebinding on them cannot interrupt a gesture in progress. The spring back
    // is inline style on a DOM node that outlives the rebind, so it plays on
    // through the navigation — which is the point: the two are one movement.
  }, [router, prev, next]);

  return (
    <div ref={paneRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
      {children}
    </div>
  );
}
