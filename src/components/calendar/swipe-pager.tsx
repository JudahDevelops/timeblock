"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
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

const SLIDE_MS = 240;
const SLIDE_EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";
/** If `transitionend` never arrives — a backgrounded tab, a cancelled
 *  animation — the navigation still has to happen. */
const SLIDE_FALLBACK_MS = SLIDE_MS + 120;
/** How long a navigation may take before the strip gives up and comes back. */
const RECOVER_MS = 4000;

/** Anything that owns its own horizontal gesture, or its own text selection. */
const EXEMPT = "input, textarea, select, [contenteditable], .bn-root";

/**
 * The calendar as a strip: the period before and the period after are rendered
 * either side of the current one, so a swipe reveals the week you are moving
 * into rather than replacing the one you are looking at.
 *
 * The strip is offset by a negative margin, not a transform. A transform would
 * make this element the containing block for every `position: fixed`
 * descendant — the drawer and the actions sheet both — and pin them inside the
 * pane instead of the viewport. Transform is therefore applied only while a
 * finger is actually moving, and a gesture is refused while either is open.
 */
export function SwipePager({
  /** Changes exactly when the calendar has navigated; resets the strip. */
  anchorKey,
  prev,
  next,
  previous,
  current,
  following,
}: {
  anchorKey: string;
  prev: string;
  next: string;
  previous: React.ReactNode;
  current: React.ReactNode;
  following: React.ReactNode;
}) {
  const router = useRouter();
  const frameRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  /** Set once a page turn is committed, cleared when the new period lands. */
  const navigatingRef = useRef(false);

  // Before paint, so the strip is already centred on the period that just
  // arrived. The pane it slid to and the pane it lands on hold the same
  // content, so nothing visibly moves — which is the whole trick.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    navigatingRef.current = false;
    track.style.transition = "";
    track.style.transform = "";
    track.style.willChange = "";
  }, [anchorKey]);

  useEffect(() => {
    const frame = frameRef.current;
    const track = trackRef.current;
    if (!frame || !track) return;

    let start: { x: number; y: number; at: number } | null = null;
    /** Which way this gesture went once it committed to one. */
    let axis: "undecided" | "x" | "y" = "undecided";
    let dx = 0;
    let fallback: number | null = null;

    /** Rest, or the neighbour the strip has been slid to. */
    function glideTo(offset: number) {
      if (!track) return;
      track.style.transition = `transform ${SLIDE_MS}ms ${SLIDE_EASE}`;
      track.style.transform = offset === 0 ? "" : `translate3d(${offset}px, 0, 0)`;
    }

    function onTouchStart(event: TouchEvent) {
      start = null;
      axis = "undecided";
      dx = 0;

      // Two fingers is a pinch or a system gesture; neither is ours. And a turn
      // already under way owns the strip until its new period arrives.
      if (event.touches.length !== 1 || navigatingRef.current) return;

      // The drawer and the actions sheet are both `position: fixed`; sliding
      // the strip beneath one would drag it along by its containing block.
      if (document.querySelector('[role="dialog"]')) return;

      const target = event.target as Element | null;
      // A selected block claims its own drags — `aria-pressed` is how it says
      // so — and pulling one sideways moves it to another day.
      if (target?.closest(`${EXEMPT}, [aria-pressed="true"]`)) return;

      const touch = event.touches[0];
      start = { x: touch.clientX, y: touch.clientY, at: Date.now() };
    }

    function onTouchMove(event: TouchEvent) {
      if (!start || !track || event.touches.length !== 1) return;
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
        levelScroll();
        track.style.willChange = "transform";
        track.style.transition = "";
      }

      dx = moveX;
      // The listener is non-passive for exactly this: once the gesture is
      // horizontal the grid must stop scrolling under it, or the day slides
      // sideways and upwards at once.
      if (event.cancelable) event.preventDefault();
      track.style.transform = `translate3d(${dx}px, 0, 0)`;
    }

    function onTouchEnd() {
      const from = start;
      start = null;
      if (!from || axis !== "x" || !track || !frame) {
        axis = "undecided";
        return;
      }
      axis = "undecided";

      const width = frame.clientWidth || 1;
      const far = Math.abs(dx) > Math.max(COMMIT_MIN_PX, width * COMMIT_FRACTION);
      const flicked = Date.now() - from.at < FLICK_MS && Math.abs(dx) > FLICK_PX;

      if (!far && !flicked) {
        glideTo(0);
        return;
      }

      navigatingRef.current = true;
      glideTo(dx < 0 ? -width : width);
      // Navigation waits for the slide to land. There is nothing to wait for
      // visually — the destination is already the pane on screen — and pushing
      // early would let the new render reset the strip mid-flight, throwing the
      // page back to centre as though the swipe had been refused.
      fallback = window.setTimeout(arrive, SLIDE_FALLBACK_MS);
    }

    function arrive() {
      if (!navigatingRef.current) return;
      if (fallback !== null) {
        window.clearTimeout(fallback);
        fallback = null;
      }
      router.push(dx < 0 ? next : prev);

      // Normally the new period lands and the layout effect above recentres the
      // strip. If it never does — a failed navigation — the calendar would sit
      // off to one side with no way back, so it walks itself home.
      fallback = window.setTimeout(() => {
        if (!navigatingRef.current || !track) return;
        navigatingRef.current = false;
        glideTo(0);
      }, RECOVER_MS);
    }

    function onTransitionEnd(event: TransitionEvent) {
      if (event.target !== track || event.propertyName !== "transform") return;
      if (navigatingRef.current) arrive();
      else if (track) {
        track.style.transition = "";
        track.style.willChange = "";
      }
    }

    /**
     * The three panes scroll independently. Levelling them the moment a swipe
     * is claimed means the period sliding in shows the same hours as the one
     * sliding out, instead of jumping back to its own opening position.
     */
    function levelScroll() {
      const panes = track?.querySelectorAll<HTMLElement>("[data-grid-scroll]");
      if (!panes || panes.length < 2) return;
      const top = panes[1].scrollTop;
      for (const pane of panes) pane.scrollTop = top;
    }

    function onTouchCancel() {
      start = null;
      axis = "undecided";
      if (!navigatingRef.current) glideTo(0);
    }

    frame.addEventListener("touchstart", onTouchStart, { passive: true });
    frame.addEventListener("touchmove", onTouchMove, { passive: false });
    frame.addEventListener("touchend", onTouchEnd, { passive: true });
    frame.addEventListener("touchcancel", onTouchCancel, { passive: true });
    track.addEventListener("transitionend", onTransitionEnd);

    return () => {
      if (fallback !== null) window.clearTimeout(fallback);
      frame.removeEventListener("touchstart", onTouchStart);
      frame.removeEventListener("touchmove", onTouchMove);
      frame.removeEventListener("touchend", onTouchEnd);
      frame.removeEventListener("touchcancel", onTouchCancel);
      track.removeEventListener("transitionend", onTransitionEnd);
    };
  }, [router, prev, next]);

  return (
    <div ref={frameRef} className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div ref={trackRef} className="-ml-[100%] flex h-full w-[300%] shrink-0">
        <Pane inert>{previous}</Pane>
        <Pane>{current}</Pane>
        <Pane inert>{following}</Pane>
      </div>
    </div>
  );
}

/**
 * One period's worth of calendar. The two either side are `inert`: they are
 * scenery until a swipe makes one of them the page, and a stray tap landing on
 * next week's grid would otherwise create a block there.
 */
function Pane({ inert = false, children }: { inert?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex h-full w-1/3 min-w-0 shrink-0 flex-col" inert={inert}>
      {children}
    </div>
  );
}
