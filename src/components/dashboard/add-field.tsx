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
  kinds = FIELD_KINDS,
  compact,
  label = "Add field",
}: {
  onPick: (kind: FieldKind) => void;
  pending?: boolean;
  /** Which kinds to offer. A group's menu leaves out `group`. */
  kinds?: readonly FieldKind[];
  /** Smaller, for the inside of a group where the card supplies the frame. */
  compact?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  /** Which way the menu opens. Measured on open, never assumed. */
  const [drop, setDrop] = useState<"up" | "down">("down");
  /**
   * Viewport coordinates for a menu that has to escape a clipping ancestor.
   *
   * Only set in `compact` mode — inside a group, where the card is
   * `overflow-hidden`. Null elsewhere, so the dashboard's own menu keeps its
   * simpler absolute positioning and stays glued to the button on scroll.
   */
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number } | null>(null);
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
      const up = below < MENU_MAX_HEIGHT && box.top > below;
      setDrop(up ? "up" : "down");

      // Measured against the viewport because the menu is `fixed` in this mode.
      // Width follows the trigger but never drops under the menu's own minimum,
      // which a narrow group card would otherwise force.
      const width = Math.max(box.width, 240);
      setAnchor(
        compact
          ? {
              top: up ? Math.max(8, box.top - MENU_MAX_HEIGHT - 4) : box.bottom + 4,
              // Pulled back inside the viewport: a group card near the right
              // edge is narrower than the menu's minimum width, so anchoring
              // naively would run the options off-screen.
              left: Math.max(8, Math.min(box.left, window.innerWidth - width - 8)),
              width,
            }
          : null,
      );
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
        className={cn(
          "border-line text-ink-muted hover:text-ink hover:border-ink-faint flex w-full items-center justify-center gap-2 rounded-lg border border-dashed transition-colors disabled:opacity-50",
          compact ? "px-2 py-1 text-xs" : "px-3 py-2.5 text-sm",
        )}
      >
        <svg
          viewBox="0 0 16 16"
          className={compact ? "size-3" : "size-3.5"}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M8 3v10M3 8h10" />
        </svg>
        {label}
      </button>

      {open ? (
        <div
          role="menu"
          style={
            // Inside a group the menu has to escape the card, which is
            // `overflow-hidden` and only a few rows tall — an absolutely
            // positioned menu is simply clipped away there. `fixed` takes it out
            // of that box; the anchor is measured on open, since a fixed element
            // no longer inherits the trigger's position.
            anchor
              ? {
                  maxHeight: MENU_MAX_HEIGHT,
                  top: anchor.top,
                  left: anchor.left,
                  width: anchor.width,
                }
              : { maxHeight: MENU_MAX_HEIGHT }
          }
          className={cn(
            "border-line bg-surface z-50 min-w-[240px] overflow-y-auto rounded-lg border py-1 shadow-lg",
            anchor
              ? "fixed"
              : cn("absolute left-0 w-full", drop === "up" ? "bottom-full mb-1" : "top-full mt-1"),
          )}
        >
          {kinds.map((kind) => (
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
