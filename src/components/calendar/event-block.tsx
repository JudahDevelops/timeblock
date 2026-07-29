"use client";

import { useEffect, useRef } from "react";

import {
  BLOCK_GAP,
  BLOCK_INSET,
  BLOCK_MIN_HEIGHT,
  BLOCK_TRAIL,
  minutesToY,
} from "@/lib/calendar/geometry";
import { cn } from "@/lib/utils";

/** Edge grab zone. Fingers need a bigger target than a cursor. */
const HANDLE = 8;
const TOUCH_HANDLE = 22;

/** Hold this long without moving before the finger starts carrying the block. */
const LONG_PRESS_MS = 450;
/** Movement past this cancels the hold — it was a drag or a scroll. */
const LONG_PRESS_SLOP_PX = 8;

/** Breathing room above and below the label, at full size. */
const PAD = 4;
/** One line of `text-xs`. Anything shorter has to eat into the label. */
const LINE_HEIGHT = 16;

/** Where a grab began. The hold fires long after its `PointerEvent` is gone. */
export type GrabPoint = { clientX: number; clientY: number; touch: boolean };

export function EventBlock({
  title,
  startMinutes,
  endMinutes,
  column,
  columns,
  isEditing,
  isSelected,
  isDraft,
  isCoarse,
  readOnly = false,
  recurring = false,
  onSelect,
  onOpen,
  onSaveTitle,
  onGrab,
  onMenu,
}: {
  title: string;
  startMinutes: number;
  endMinutes: number;
  column: number;
  columns: number;
  isEditing: boolean;
  isSelected: boolean;
  isDraft: boolean;
  isCoarse: boolean;
  /** Owned by Google: opens like any block, but its time and title are theirs. */
  readOnly?: boolean;
  /** One occurrence of a series, marked so it is not mistaken for a one-off. */
  recurring?: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onSaveTitle: (title: string) => void;
  onGrab: (edge: "body" | "start" | "end", point: GrabPoint) => void;
  onMenu: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const holdRef = useRef<{ timer: number; x: number; y: number } | null>(null);
  /** `contextmenu` carries no pointer type, and a finger must not raise a menu. */
  const fromTouchRef = useRef(false);

  useEffect(() => {
    if (isEditing) inputRef.current?.select();
  }, [isEditing]);

  const cancelHold = () => {
    if (holdRef.current) {
      window.clearTimeout(holdRef.current.timer);
      holdRef.current = null;
    }
  };
  useEffect(() => cancelHold, []);

  // The slot is what the time occupies; the block is drawn a little short of it
  // so the next one down does not begin exactly where this one ends.
  const height = Math.max(minutesToY(endMinutes - startMinutes) - BLOCK_GAP, BLOCK_MIN_HEIGHT);
  const grabZone = isCoarse ? TOUCH_HANDLE : HANDLE;
  // The label sits centred and the padding is the first thing surrendered as
  // the block shrinks: at a quarter of an hour there is barely a line's worth
  // of room, and a name pushed out of its box is worse than one drawn tight
  // against the border. Past that it clips rather than spilling over the
  // neighbouring hour.
  const padding = Math.max(0, Math.min(PAD, (height - LINE_HEIGHT) / 2));
  // A finger only ever resizes the block it has just dropped, while the time is
  // still being chosen. Afterwards the drawer owns it — handles at every size
  // meant a block could not be picked up without one catching first.
  const showHandles = !readOnly && isCoarse && isDraft && height >= 32;

  const edgeAt = (event: React.PointerEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const offsetY = event.clientY - rect.top;
    return offsetY <= grabZone ? "start" : offsetY >= rect.height - grabZone ? "end" : "body";
  };

  return (
    <div
      className={cn(
        "absolute flex flex-col overflow-visible rounded-md border px-2 transition-colors select-none",
        // One fill for every block, imported or planned. Origin is not worth a
        // colour: what you actually need to see at a glance is the shape of the
        // day, and two palettes fighting each other obscured it.
        //
        // No drop shadow either. A dozen of them down a column read as cards
        // stacked above the page, and the hairline is enough to separate a block
        // from the hour rule behind it without lifting it off the grid.
        "border-line bg-surface-raised text-ink hover:border-ink-faint",
        // The ring, not the background, marks selection — it stays legible at
        // 15-minute heights and reads the same under a finger as under a cursor.
        isSelected || isDraft ? "ring-accent ring-offset-surface z-10 ring-2 ring-offset-1" : "",
      )}
      style={{
        top: minutesToY(startMinutes),
        height,
        paddingBlock: padding,
        left: `calc(${(column * 100) / columns}% + ${BLOCK_INSET}px)`,
        width: `calc(${100 / columns}% - ${BLOCK_INSET + BLOCK_TRAIL}px)`,
        // A block only claims the gesture where it has one to claim. On touch
        // that is a fresh draft and its handles; every other block lets the grid
        // scroll and the pager turn beneath the finger, and takes the gesture
        // back mid-hold instead (see the touch branch of the grid's drag loop).
        touchAction: readOnly || (isCoarse && !isDraft) ? "auto" : "none",
      }}
      onMouseDown={(event) => {
        // A browser replays every touch as mouse events a few hundred
        // milliseconds later. Those land on whatever is under the finger by
        // then — here, the block that tap just created — and this div is
        // focusable, so the phantom press would pull focus off the title
        // input, fire `onBlur` with an empty value and bin the new draft.
        if (isEditing && event.target !== inputRef.current) event.preventDefault();
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // Keep the press off the column, which would otherwise handle it.
        // Ahead of everything else: a press on a block mid-rename must not
        // fall through and be read as a tap on bare grid. Dragging stays live
        // while the title input is open, so a new block can be nudged into
        // place and named in one go; the input stops its own presses.
        event.stopPropagation();

        const touch = event.pointerType === "touch";
        fromTouchRef.current = touch;

        if (touch) {
          if (isEditing) return;

          // Handles are the one touch target that grabs on the way down — they
          // are small, deliberate, and only exist while the block is a draft.
          if (showHandles) {
            const edge = edgeAt(event);
            if (edge !== "body") {
              onSelect();
              onGrab(edge, { clientX: event.clientX, clientY: event.clientY, touch });
              return;
            }
          }

          // Otherwise the finger has committed to nothing yet: a hold picks the
          // block up wherever it landed, a lift opens it, and travelling in
          // between hands the gesture back to the grid.
          const { clientX: x, clientY: y } = event;
          holdRef.current = {
            x,
            y,
            timer: window.setTimeout(() => {
              holdRef.current = null;
              if (!readOnly) onGrab("body", { clientX: x, clientY: y, touch: true });
            }, LONG_PRESS_MS),
          };
          return;
        }

        // A cursor has no such ambiguity: a press is a press.
        onSelect();

        // Nothing about a Google block is ours to move or resize.
        if (readOnly) return;
        onGrab(edgeAt(event), { clientX: event.clientX, clientY: event.clientY, touch: false });
      }}
      onPointerMove={(event) => {
        const hold = holdRef.current;
        if (!hold) return;
        if (Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > LONG_PRESS_SLOP_PX) {
          cancelHold();
        }
      }}
      onPointerUp={() => {
        // A hold still pending is a press that neither travelled past the slop
        // nor lasted long enough to pick the block up — which is exactly a tap,
        // and a tap opens the page inside the block.
        const tapped = holdRef.current !== null;
        cancelHold();
        if (tapped) onOpen();
      }}
      onPointerCancel={cancelHold}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        // A finger reaching here is Android's own long-press menu arriving on
        // top of a block already being carried.
        if (fromTouchRef.current) return;
        onMenu();
      }}
      tabIndex={0}
      role="button"
      aria-pressed={isSelected}
    >
      {/* Resize affordances. Cursor only — the parent handles the gesture. */}
      {readOnly ? null : (
        <>
          <div className="absolute inset-x-0 top-0 cursor-ns-resize" style={{ height: grabZone }} />
          <div
            className="absolute inset-x-0 bottom-0 cursor-ns-resize"
            style={{ height: grabZone }}
          />
        </>
      )}

      {showHandles ? (
        <>
          <Grabber edge="start" />
          <Grabber edge="end" />
        </>
      ) : null}

      {/* Centred in whatever height is left, and clipped there. The block itself
          stays `overflow-visible` so the handles can sit proud of its edges, so
          without this a label taller or wider than its box paints across the
          hour below and the neighbouring day. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col justify-center overflow-hidden">
        {isEditing ? (
          <input
            ref={inputRef}
            autoFocus
            defaultValue={title}
            placeholder="Name this block"
            className="min-w-0 bg-transparent text-xs font-medium outline-none placeholder:text-current/50"
            onPointerDown={(event) => event.stopPropagation()}
            onBlur={(event) => onSaveTitle(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSaveTitle(event.currentTarget.value);
              } else if (event.key === "Escape") {
                event.preventDefault();
                // An empty string leaves a draft unnamed; an existing block
                // keeps the name it already had.
                onSaveTitle(isDraft ? "" : title);
              }
              event.stopPropagation();
            }}
          />
        ) : (
          <div className="flex min-w-0 items-center gap-1">
            {recurring ? <RepeatIcon /> : null}
            <span className="min-w-0 flex-1 truncate text-xs leading-tight font-medium">
              {title || "Untitled"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Marks one occurrence of a series.
 *
 * Carries the label rather than a tooltip: the glyph is 10px and shares a row
 * with a truncating title, so a screen reader is the only thing that reliably
 * gets to read it.
 */
function RepeatIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-2.5 shrink-0 opacity-60"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="Repeats"
    >
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11v-1a4 4 0 014-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v1a4 4 0 01-4 4H3" />
    </svg>
  );
}

/** The visible "you can drag this" dot. Purely decorative; the parent's edge
 *  zone is what actually receives the gesture. */
function Grabber({ edge }: { edge: "start" | "end" }) {
  return (
    <div
      className={cn(
        "bg-accent ring-surface pointer-events-none absolute left-1/2 h-1.5 w-8 -translate-x-1/2 rounded-full ring-2",
        edge === "start" ? "-top-0.5" : "-bottom-0.5",
      )}
    />
  );
}
