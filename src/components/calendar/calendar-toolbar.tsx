"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import {
  CALENDAR_VIEWS,
  calendarPath,
  rangeLabel,
  shiftAnchor,
  type CalendarView,
} from "@/lib/date";
import { cn } from "@/lib/utils";

const VIEW_LABELS: Record<CalendarView, string> = {
  day: "Day",
  "3day": "3 day",
  week: "Week",
};

/** Number keys map to views the way the day-count reads: 1, 3, 7. */
const VIEW_KEYS: Record<string, CalendarView> = { "1": "day", "3": "3day", "7": "week" };

export function CalendarToolbar({ view, anchor }: { view: CalendarView; anchor: Date }) {
  const router = useRouter();

  const prev = calendarPath(view, shiftAnchor(anchor, view, -1));
  const next = calendarPath(view, shiftAnchor(anchor, view, 1));
  const today = calendarPath(view, new Date());

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      // Never hijack keys while typing — the whole product is a text editor.
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if (event.key === "j") router.push(prev);
      else if (event.key === "k") router.push(next);
      else if (event.key === "t") router.push(today);
      else if (VIEW_KEYS[event.key]) router.push(calendarPath(VIEW_KEYS[event.key], anchor));
      else return;

      event.preventDefault();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, prev, next, today, anchor]);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-zinc-200 px-4 dark:border-zinc-800">
      <Link
        href={today}
        className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
      >
        Today
      </Link>

      <div className="flex items-center">
        <Link href={prev} aria-label="Previous" className={arrowClass}>
          ‹
        </Link>
        <Link href={next} aria-label="Next" className={arrowClass}>
          ›
        </Link>
      </div>

      <h1 className="truncate text-sm font-medium">{rangeLabel(anchor, view)}</h1>

      <div className="ml-auto flex items-center gap-1">
        {CALENDAR_VIEWS.map((v) => (
          <Link
            key={v}
            href={calendarPath(v, anchor)}
            aria-current={v === view ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              v === view
                ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900",
            )}
          >
            {VIEW_LABELS[v]}
          </Link>
        ))}
      </div>
    </header>
  );
}

const arrowClass =
  "flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-900";
