"use client";

import { useEffect } from "react";

/**
 * Quick actions for a block, raised by right-clicking it. A sheet rather than a
 * floating popover: it needs no space calculation against the grid.
 *
 * Touch does not reach here. A held block is one being picked up and carried,
 * and a tapped one opens its page — where rename and delete already live.
 */
export function BlockActions({
  title,
  readOnly = false,
  onOpen,
  onRename,
  onDelete,
  onClose,
}: {
  title: string;
  /** A Google block. Its notes are ours to write; its name and slot are not. */
  readOnly?: boolean;
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
    // Height in `dvh` rather than `inset-0`. A fixed element's bottom edge is
    // the *layout* viewport, which on a phone sits behind the browser's own
    // bottom bar — so the sheet was being drawn partly underneath it.
    <div
      className="fixed inset-x-0 top-0 z-50 flex h-[100dvh] flex-col justify-end"
      role="dialog"
      aria-modal="true"
    >
      <button
        aria-label="Dismiss"
        className="absolute inset-0 bg-black/40"
        onPointerDown={(event) => {
          event.preventDefault();
          onClose();
        }}
      />

      <div className="bg-surface-raised border-line relative m-2 overflow-hidden rounded-2xl border shadow-xl">
        <div className="text-ink-muted truncate px-4 py-3 text-xs font-medium">
          {title || "Untitled"}
        </div>
        <Action label="Open" onSelect={onOpen} />
        {readOnly ? null : (
          <>
            <Action label="Rename" onSelect={onRename} />
            <Action label="Delete" destructive onSelect={onDelete} />
          </>
        )}
      </div>

      <button
        // Sits clear of the very bottom edge: a phone's home indicator and the
        // browser's gesture strip both live there, and a target flush against
        // them is one a thumb keeps missing.
        className="bg-surface-raised border-line relative mx-2 mt-2 mb-5 rounded-2xl border py-3.5 text-sm font-medium shadow-xl"
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
      className={`border-line w-full border-t px-4 py-3.5 text-left text-sm ${
        destructive ? "text-danger" : ""
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
