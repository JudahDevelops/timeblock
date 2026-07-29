"use client";

import { useEffect } from "react";

/**
 * Quick actions for a block, raised by a long press. A bottom sheet rather
 * than a floating popover: it needs no space calculation against the grid, and
 * the targets sit where a thumb already is.
 */
export function BlockActions({
  title,
  onOpen,
  onRename,
  onDelete,
  onClose,
}: {
  title: string;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
      <button
        aria-label="Dismiss"
        className="absolute inset-0 bg-black/40"
        onPointerDown={(event) => {
          event.preventDefault();
          onClose();
        }}
      />

      <div className="relative m-2 overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-zinc-900">
        <div className="truncate px-4 py-3 text-xs font-medium text-zinc-500">
          {title || "Untitled"}
        </div>
        <Action label="Open" onSelect={onOpen} />
        <Action label="Rename" onSelect={onRename} />
        <Action label="Delete" destructive onSelect={onDelete} />
      </div>

      <button
        className="relative m-2 rounded-2xl bg-white py-3.5 text-sm font-medium shadow-xl dark:bg-zinc-900"
        onPointerDown={(event) => {
          event.preventDefault();
          onClose();
        }}
      >
        Cancel
      </button>
    </div>
  );
}

function Action({
  label,
  destructive,
  onSelect,
}: {
  label: string;
  destructive?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`w-full border-t border-zinc-100 px-4 py-3.5 text-left text-sm dark:border-zinc-800 ${
        destructive ? "text-red-600 dark:text-red-400" : ""
      }`}
      // Pointer down, not click: the sheet is opened mid-gesture by a long
      // press, and waiting for a full click would swallow the first tap.
      onPointerDown={(event) => {
        event.preventDefault();
        onSelect();
      }}
    >
      {label}
    </button>
  );
}
