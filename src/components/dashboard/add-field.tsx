"use client";

import { useEffect, useRef, useState } from "react";

import { FIELD_KIND_LABELS, FIELD_KINDS, type FieldKind } from "@/lib/dashboard/field";

/**
 * The type picker.
 *
 * Explicit by design: the kind is chosen here, once, from a menu — never guessed
 * from whatever was typed into the value. Each entry carries a hint, because
 * "progress" and "number" are only distinguishable by what they do with a target.
 */
export function AddField({
  onPick,
  pending,
}: {
  onPick: (kind: FieldKind) => void;
  pending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={pending}
        aria-expanded={open}
        aria-haspopup="menu"
        className="border-line text-ink-muted hover:text-ink hover:border-ink-faint flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-sm transition-colors disabled:opacity-50"
      >
        <svg
          viewBox="0 0 16 16"
          className="size-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M8 3v10M3 8h10" />
        </svg>
        Add field
      </button>

      {open ? (
        <div
          role="menu"
          className="border-line bg-surface absolute bottom-full left-0 z-30 mb-1 w-full min-w-[240px] overflow-hidden rounded-lg border py-1 shadow-lg"
        >
          {FIELD_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onPick(kind);
              }}
              className="hover:bg-surface-sunken flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors"
            >
              <span className="text-ink text-sm font-medium">{FIELD_KIND_LABELS[kind].label}</span>
              <span className="text-ink-faint text-xs">{FIELD_KIND_LABELS[kind].hint}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
