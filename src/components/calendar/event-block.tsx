"use client";

import { useEffect, useRef } from "react";

import { minutesToY } from "@/lib/calendar/geometry";
import { cn } from "@/lib/utils";

/** Edge grab zone. Fingers need a bigger target than a cursor. */
const HANDLE = 8;
const TOUCH_HANDLE = 22;

/** Hold this long without moving to raise the quick actions sheet. */
const LONG_PRESS_MS = 450;
/** Movement past this cancels the hold — it was a drag or a scroll. */
const LONG_PRESS_SLOP_PX = 8;

function formatRange(startMinutes: number, endMinutes: number): string {
  const fmt = (m: number) =>
    `${Math.floor(m / 60)
      .toString()
      .padStart(2, "0")}:${(m % 60).toString().padStart(2, "0")}`;
  return `${fmt(startMinutes)} – ${fmt(endMinutes)}`;
}

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
  onStartEdit,
  onSaveTitle,
  onGrab,
  onLongPress,
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
  onStartEdit: () => void;
  onSaveTitle: (title: string) => void;
  onGrab: (edge: "body" | "start" | "end", event: React.PointerEvent) => void;
  onLongPress: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const holdRef = useRef<{ timer: number; x: number; y: number } | null>(null);

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

  const height = minutesToY(endMinutes - startMinutes);
  const grabZone = isCoarse ? TOUCH_HANDLE : HANDLE;
  const range = formatRange(startMinutes, endMinutes);
  /** Below two lines' worth of height the time has to share the title's row. */
  const stacked = height > 34;
  /** Handles are only worth showing once a block is the active target. */
  const showHandles = !readOnly && isCoarse && (isSelected || isDraft) && height >= 32;

  return (
    <div
      className={cn(
        "absolute overflow-visible rounded-md border px-2 py-1 transition-colors select-none",
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
        left: `calc(${(column * 100) / columns}% + 2px)`,
        width: `calc(${100 / columns}% - 4px)`,
        // On touch a block only claims the gesture once it is selected, so an
        // unselected block still lets the grid scroll under the finger. A
        // read-only block never claims it at all — there is nothing to drag.
        touchAction: readOnly || (isCoarse && !isSelected) ? "auto" : "none",
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

        if (touch && !isEditing) {
          const { clientX: x, clientY: y } = event;
          holdRef.current = {
            x,
            y,
            timer: window.setTimeout(() => {
              holdRef.current = null;
              onLongPress();
            }, LONG_PRESS_MS),
          };
        }

        onSelect();

        // Nothing about a Google block is ours to move or resize.
        if (readOnly) return;

        // First tap selects and nothing more; the second gesture moves it.
        // Dragging straight away would fight the grid's scroll.
        if (touch && !isSelected) return;

        const rect = event.currentTarget.getBoundingClientRect();
        const offsetY = event.clientY - rect.top;
        const edge =
          offsetY <= grabZone ? "start" : offsetY >= rect.height - grabZone ? "end" : "body";
        onGrab(edge, event);
      }}
      onPointerMove={(event) => {
        const hold = holdRef.current;
        if (!hold) return;
        if (Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > LONG_PRESS_SLOP_PX) {
          cancelHold();
        }
      }}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onStartEdit();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onLongPress();
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

      <div className="flex min-w-0 items-baseline gap-1.5">
        {isEditing ? (
          <input
            ref={inputRef}
            autoFocus
            defaultValue={title}
            placeholder="Name this block"
            className="min-w-0 flex-1 bg-transparent text-xs font-medium outline-none placeholder:text-current/50"
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
          <div className="flex min-w-0 flex-1 items-center gap-1">
            {recurring ? <RepeatIcon /> : null}
            <span className="min-w-0 flex-1 truncate text-xs leading-tight font-medium">
              {title || "Untitled"}
            </span>
          </div>
        )}

        {/* Too short to stack the time under the title, so it rides alongside
            it instead of being clipped away entirely. */}
        {stacked ? null : (
          <span className="shrink-0 text-[10px] tabular-nums opacity-70">{range}</span>
        )}
      </div>

      {stacked ? <div className="text-[10px] tabular-nums opacity-70">{range}</div> : null}
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
