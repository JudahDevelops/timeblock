"use client";

import { useEffect, useRef } from "react";

import { minutesToY } from "@/lib/calendar/geometry";
import { cn } from "@/lib/utils";

/** Edge grab zone, in pixels. Big enough to hit, small enough not to block moving. */
const HANDLE = 6;

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
  isGhost,
  onStartEdit,
  onSaveTitle,
  onDelete,
  onGrab,
}: {
  title: string;
  startMinutes: number;
  endMinutes: number;
  column: number;
  columns: number;
  isEditing: boolean;
  isGhost: boolean;
  onStartEdit: () => void;
  onSaveTitle: (title: string) => void;
  onDelete: () => void;
  onGrab: (edge: "body" | "start" | "end", clientY: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) inputRef.current?.select();
  }, [isEditing]);

  const height = minutesToY(endMinutes - startMinutes);
  const width = `calc(${100 / columns}% - 4px)`;

  return (
    <div
      className={cn(
        "absolute overflow-hidden rounded-md border border-white/20 bg-zinc-900 px-2 py-1 text-zinc-50 shadow-sm select-none dark:bg-zinc-100 dark:text-zinc-900",
        isGhost && "opacity-60",
      )}
      style={{
        top: minutesToY(startMinutes),
        height,
        left: `calc(${(column * 100) / columns}% + 2px)`,
        width,
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || isEditing) return;
        // Keep the click off the column, which would start a create drag.
        event.stopPropagation();

        const rect = event.currentTarget.getBoundingClientRect();
        const offsetY = event.clientY - rect.top;
        const edge = offsetY <= HANDLE ? "start" : offsetY >= rect.height - HANDLE ? "end" : "body";
        onGrab(edge, event.clientY);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onStartEdit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Backspace" || event.key === "Delete") {
          event.preventDefault();
          onDelete();
        }
      }}
      tabIndex={0}
      role="button"
    >
      {/* Resize affordances. Cursor only — the parent handles the gesture. */}
      <div className="absolute inset-x-0 top-0 cursor-ns-resize" style={{ height: HANDLE }} />
      <div className="absolute inset-x-0 bottom-0 cursor-ns-resize" style={{ height: HANDLE }} />

      {isEditing ? (
        <input
          ref={inputRef}
          defaultValue={title}
          placeholder="Untitled"
          className="w-full bg-transparent text-xs font-medium outline-none placeholder:text-current/50"
          onPointerDown={(event) => event.stopPropagation()}
          onBlur={(event) => onSaveTitle(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSaveTitle(event.currentTarget.value);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onSaveTitle(title);
            }
            event.stopPropagation();
          }}
        />
      ) : (
        <div className="text-xs leading-tight font-medium">{title || "Untitled"}</div>
      )}

      {height > 34 ? (
        <div className="text-[10px] tabular-nums opacity-70">
          {formatRange(startMinutes, endMinutes)}
        </div>
      ) : null}
    </div>
  );
}
