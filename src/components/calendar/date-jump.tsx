"use client";

import {
  addDays,
  addMonths,
  addYears,
  format,
  isSameDay,
  isSameMonth,
  setMonth,
  setYear,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  calendarPath,
  shortRangeLabel,
  rangeLabel,
  WEEK_STARTS_ON,
  type CalendarView,
} from "@/lib/date";
import { cn } from "@/lib/utils";

/** Years shown at once. Three rows of four pages a decade at a glance. */
const YEARS_PER_PAGE = 12;

/**
 * The range label, doubling as the way to jump anywhere.
 *
 * Paging by arrows is fine for next week and useless for 2019, so this drills
 * up — days to months to years — and each level pages by its own unit. That is
 * the shape every calendar app converged on, and the only one that reaches a
 * date years away in a bounded number of taps.
 */
export function DateJump({ view, anchor }: { view: CalendarView; anchor: Date }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
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
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-sm font-medium transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-900"
      >
        <h1 className="truncate">
          {/* The long label is the honest one; below `sm` there is no room for
              it, and a truncated "Wednes…" reads worse than "29 Jul 2026". */}
          <span className="hidden sm:inline">{rangeLabel(anchor, view)}</span>
          <span className="sm:hidden">{shortRangeLabel(anchor, view)}</span>
        </h1>
        <span aria-hidden className="shrink-0 text-[10px] text-zinc-400">
          ▾
        </span>
      </button>

      {/* Unmounted while closed so it always reopens on the current anchor
          rather than wherever you last browsed to and abandoned. */}
      {open ? <Panel view={view} anchor={anchor} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function Panel({
  view,
  anchor,
  onClose,
}: {
  view: CalendarView;
  anchor: Date;
  onClose: () => void;
}) {
  const router = useRouter();
  const [level, setLevel] = useState<"days" | "months" | "years">("days");
  const [cursor, setCursor] = useState(anchor);

  function go(date: Date) {
    onClose();
    router.push(calendarPath(view, date));
  }

  /** Each level pages by its own unit: a month, a year, a page of years. */
  function page(direction: 1 | -1) {
    setCursor((current) =>
      level === "days"
        ? addMonths(current, direction)
        : addYears(current, (level === "months" ? 1 : YEARS_PER_PAGE) * direction),
    );
  }

  const heading =
    level === "days"
      ? format(cursor, "MMMM yyyy")
      : level === "months"
        ? format(cursor, "yyyy")
        : `${yearPageStart(cursor)} – ${yearPageStart(cursor) + YEARS_PER_PAGE - 1}`;

  return (
    <div className="absolute top-full left-0 z-50 mt-1 w-64 rounded-xl border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-1 pb-1">
        <button type="button" aria-label="Previous" onClick={() => page(-1)} className={stepClass}>
          ‹
        </button>
        <button
          type="button"
          // Each press climbs a level; at the top there is nowhere further up.
          onClick={() => setLevel(level === "days" ? "months" : "years")}
          disabled={level === "years"}
          className="flex-1 rounded-md py-1 text-xs font-medium transition-colors hover:bg-zinc-100 disabled:hover:bg-transparent dark:hover:bg-zinc-900"
        >
          {heading}
        </button>
        <button type="button" aria-label="Next" onClick={() => page(1)} className={stepClass}>
          ›
        </button>
      </div>

      {level === "days" ? (
        <DayPicker cursor={cursor} anchor={anchor} onPick={go} />
      ) : level === "months" ? (
        <Cells
          items={Array.from({ length: 12 }, (_, m) => ({
            key: m,
            label: format(setMonth(cursor, m), "MMM"),
            active: m === anchor.getMonth() && cursor.getFullYear() === anchor.getFullYear(),
            onPick: () => {
              setCursor(startOfMonth(setMonth(cursor, m)));
              setLevel("days");
            },
          }))}
        />
      ) : (
        <Cells
          items={Array.from({ length: YEARS_PER_PAGE }, (_, i) => {
            const year = yearPageStart(cursor) + i;
            return {
              key: year,
              label: String(year),
              active: year === anchor.getFullYear(),
              onPick: () => {
                setCursor(setYear(cursor, year));
                setLevel("months");
              },
            };
          })}
        />
      )}
    </div>
  );
}

/** The 12-year block a date falls in, so paging lands on stable boundaries. */
function yearPageStart(date: Date): number {
  const year = date.getFullYear();
  return year - (year % YEARS_PER_PAGE);
}

function DayPicker({
  cursor,
  anchor,
  onPick,
}: {
  cursor: Date;
  anchor: Date;
  onPick: (date: Date) => void;
}) {
  const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: WEEK_STARTS_ON });
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const today = new Date();

  return (
    <div className="grid grid-cols-7 gap-0.5">
      {days.slice(0, 7).map((day) => (
        <div key={`h${day.toISOString()}`} className="pb-1 text-center text-[10px] text-zinc-400">
          {format(day, "EEEEE")}
        </div>
      ))}

      {days.map((day) => (
        <button
          key={day.toISOString()}
          type="button"
          onClick={() => onPick(day)}
          className={cn(
            "flex h-7 items-center justify-center rounded-md text-xs tabular-nums transition-colors",
            !isSameMonth(day, cursor) && "text-zinc-300 dark:text-zinc-600",
            isSameDay(day, anchor)
              ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
              : "hover:bg-zinc-100 dark:hover:bg-zinc-900",
            isSameDay(day, today) && !isSameDay(day, anchor) && "font-semibold text-blue-600",
          )}
        >
          {format(day, "d")}
        </button>
      ))}
    </div>
  );
}

function Cells({
  items,
}: {
  items: { key: number; label: string; active: boolean; onPick: () => void }[];
}) {
  return (
    <div className="grid grid-cols-4 gap-1">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={item.onPick}
          className={cn(
            "rounded-md py-2 text-xs font-medium tabular-nums transition-colors",
            item.active
              ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
              : "hover:bg-zinc-100 dark:hover:bg-zinc-900",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

const stepClass =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-900";
