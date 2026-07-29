"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { CommandPalette } from "@/components/search/command-palette";
import { SidebarTrigger } from "@/components/shell/app-shell";
import { CALENDAR_VIEWS, calendarPath, shiftAnchor, type CalendarView } from "@/lib/date";
import { cn } from "@/lib/utils";
import { DateJump } from "./date-jump";

const VIEW_LABELS: Record<CalendarView, string> = {
  day: "Day",
  "3day": "3 day",
  week: "Week",
  month: "Month",
};

/** Four words do not fit a phone; their initials do, and stay recognisable. */
const VIEW_INITIALS: Record<CalendarView, string> = {
  day: "D",
  "3day": "3",
  week: "W",
  month: "M",
};

/** Number keys map to views the way the day-count reads: 1, 3, 7 — then M. */
const VIEW_KEYS: Record<string, CalendarView> = {
  "1": "day",
  "3": "3day",
  "7": "week",
  m: "month",
};

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
    <header className="border-line flex h-14 shrink-0 items-center gap-1.5 border-b px-2 sm:gap-3 sm:px-4">
      <SidebarTrigger />

      <Link
        href={today}
        className="border-line hover:bg-surface-sunken shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors"
      >
        Today
      </Link>

      <div className="flex shrink-0 items-center">
        <Link href={prev} aria-label="Previous" className={arrowClass}>
          ‹
        </Link>
        <Link href={next} aria-label="Next" className={arrowClass}>
          ›
        </Link>
      </div>

      <DateJump view={view} anchor={anchor} />

      <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
        <CommandPalette view={view} />

        {CALENDAR_VIEWS.map((v) => (
          <Link
            key={v}
            href={calendarPath(v, anchor)}
            aria-current={v === view ? "page" : undefined}
            aria-label={VIEW_LABELS[v]}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors sm:px-2.5",
              v === view ? "bg-ink text-surface" : "text-ink-muted hover:bg-surface-raised",
            )}
          >
            <span className="hidden sm:inline">{VIEW_LABELS[v]}</span>
            <span className="sm:hidden">{VIEW_INITIALS[v]}</span>
          </Link>
        ))}
      </div>
    </header>
  );
}

const arrowClass =
  "flex h-7 w-6 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-raised sm:w-7";
