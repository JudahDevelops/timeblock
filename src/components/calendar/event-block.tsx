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
  /** Handles are only worth showing once a block is the active target. */
  const showHandles = isCoarse && (isSelected || isDraft) && height >= 32;

  return (
    <div
      className={cn(
        "absolute overflow-visible rounded-md bg-zinc-900 px-2 py-1 text-zinc-50 shadow-sm transition-shadow select-none dark:bg-zinc-100 dark:text-zinc-900",
        // The ring, not the background, marks selection — it stays legible at
        // 15-minute heights and reads the same under a finger as under a cursor.
        isSelected || isDraft
          ? "z-10 ring-2 ring-blue-500 ring-offset-1 ring-offset-white dark:ring-offset-zinc-950"
          : "border border-white/20",
      )}
      style={{
        top: minutesToY(startMinutes),
        height,
        left: `calc(${(column * 100) / columns}% + 2px)`,
        width: `calc(${100 / columns}% - 4px)`,
        // On touch a block only claims the gesture once it is selected, so an
        // unselected block still lets the grid scroll under the finger.
        touchAction: !isCoarse || isSelected ? "none" : "auto",
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
      <div className="absolute inset-x-0 top-0 cursor-ns-resize" style={{ height: grabZone }} />
      <div className="absolute inset-x-0 bottom-0 cursor-ns-resize" style={{ height: grabZone }} />

      {showHandles ? (
        <>
          <Grabber edge="start" />
          <Grabber edge="end" />
        </>
      ) : null}

      {isEditing ? (
        <input
          ref={inputRef}
          autoFocus
          defaultValue={title}
          placeholder="Name this block"
          className="w-full bg-transparent text-xs font-medium outline-none placeholder:text-current/50"
          onPointerDown={(event) => event.stopPropagation()}
          onBlur={(event) => onSaveTitle(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSaveTitle(event.currentTarget.value);
            } else if (event.key === "Escape") {
              event.preventDefault();
              // An empty string discards a draft; an existing block keeps its name.
              onSaveTitle(isDraft ? "" : title);
            }
            event.stopPropagation();
          }}
        />
      ) : (
        <div className="truncate text-xs leading-tight font-medium">{title || "Untitled"}</div>
      )}

      {height > 34 ? (
        <div className="text-[10px] tabular-nums opacity-70">
          {formatRange(startMinutes, endMinutes)}
        </div>
      ) : null}
    </div>
  );
}

/** The visible "you can drag this" dot. Purely decorative; the parent's edge
 *  zone is what actually receives the gesture. */
function Grabber({ edge }: { edge: "start" | "end" }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute left-1/2 h-1.5 w-8 -translate-x-1/2 rounded-full bg-blue-500 ring-2 ring-white dark:ring-zinc-950",
        edge === "start" ? "-top-0.5" : "-bottom-0.5",
      )}
    />
  );
}
