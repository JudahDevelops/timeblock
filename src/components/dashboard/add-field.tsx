"use client";

import { useEffect, useRef, useState } from "react";

import { FIELD_KIND_LABELS, FIELD_KINDS, type FieldKind } from "@/lib/dashboard/field";
import { cn } from "@/lib/utils";

/** Roughly the six options at full height. Also the flip threshold. */
const MENU_MAX_HEIGHT = 288;

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
  /** Which way the menu opens. Measured on open, never assumed. */
  const [drop, setDrop] = useState<"up" | "down">("down");
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

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

  /**
   * Opens downward unless the viewport below is too short, and only flips up if
   * there is genuinely more room there. The button sits under the field list, so
   * a hardcoded direction clipped the options against whichever edge it faced.
   */
  const openMenu = () => {
    const box = trigger.current?.getBoundingClientRect();
    if (box) {
      const below = window.innerHeight - box.bottom;
      setDrop(below < MENU_MAX_HEIGHT && box.top > below ? "up" : "down");
    }
    setOpen((current) => !current);
  };

  return (
    <div ref={container} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={openMenu}
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
          style={{ maxHeight: MENU_MAX_HEIGHT }}
          className={cn(
            "border-line bg-surface absolute left-0 z-30 w-full min-w-[240px] overflow-y-auto rounded-lg border py-1 shadow-lg",
            drop === "up" ? "bottom-full mb-1" : "top-full mt-1",
          )}
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
