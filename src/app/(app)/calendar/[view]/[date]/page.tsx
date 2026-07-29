import { Suspense } from "react";
import { format, isToday } from "date-fns";
import { notFound } from "next/navigation";

import { CalendarToolbar } from "@/components/calendar/calendar-toolbar";
import { GridSkeleton } from "@/components/calendar/grid-skeleton";
import { MonthGrid } from "@/components/calendar/month-grid";
import { SwipePager } from "@/components/calendar/swipe-pager";
import { TimeGrid } from "@/components/calendar/time-grid";
import {
  calendarPath,
  fromDateParam,
  isCalendarView,
  isTimeGridView,
  shiftAnchor,
  visibleDays,
} from "@/lib/date";
import { getEventsInRange, type CalendarEvent } from "@/server/queries/events";
import { requireUserId } from "@/server/auth";
import { cn } from "@/lib/utils";

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ view: string; date: string }>;
  searchParams: Promise<{ open?: string }>;
}) {
  const { view, date } = await params;
  // Set by the search palette: which block to land inside on arrival.
  const { open } = await searchParams;

  if (!isCalendarView(view)) notFound();
  const anchor = fromDateParam(date);
  if (!anchor) notFound();

  const previousAnchor = shiftAnchor(anchor, view, -1);
  const followingAnchor = shiftAnchor(anchor, view, 1);
  const prev = calendarPath(view, previousAnchor);
  const next = calendarPath(view, followingAnchor);

  // Three periods, not one: the pager keeps the neighbours mounted either side
  // so a swipe reveals where it is going. They cost a wider date range on a
  // query that was already running, and no extra round trip.
  const days = visibleDays(anchor, view);
  const previousDays = visibleDays(previousAnchor, view);
  const followingDays = visibleDays(followingAnchor, view);

  const rangeStart = new Date(previousDays[0]);
  rangeStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(followingDays[followingDays.length - 1]);
  rangeEnd.setHours(24, 0, 0, 0);

  // Deliberately not awaited: the toolbar and day headers below render while
  // the query is still in flight, so changing week paints immediately.
  const eventsPromise = requireUserId().then((userId) =>
    getEventsInRange(userId, rangeStart, rangeEnd),
  );

  if (!isTimeGridView(view)) {
    // No skeleton: a month grid is mostly chrome, and its 42 cells draw the
    // same whether the events have landed or not.
    const month = (monthDays: Date[], monthAnchor: Date, openEventId: string | null) => (
      <Suspense fallback={<div className="flex-1" />}>
        <Month
          days={monthDays}
          anchor={monthAnchor}
          eventsPromise={eventsPromise}
          openEventId={openEventId}
        />
      </Suspense>
    );

    return (
      <>
        <CalendarToolbar view={view} anchor={anchor} />
        <SwipePager
          anchorKey={`${view}/${date}`}
          prev={prev}
          next={next}
          previous={month(previousDays, previousAnchor, null)}
          current={month(days, anchor, open ?? null)}
          following={month(followingDays, followingAnchor, null)}
        />
      </>
    );
  }

  const grid = (gridDays: Date[], openEventId: string | null) => (
    <>
      <DayHeaders days={gridDays} />
      <Suspense fallback={<GridSkeleton columns={gridDays.length} />}>
        <Grid days={gridDays} eventsPromise={eventsPromise} openEventId={openEventId} />
      </Suspense>
    </>
  );

  return (
    <>
      <CalendarToolbar view={view} anchor={anchor} />
      <SwipePager
        anchorKey={`${view}/${date}`}
        prev={prev}
        next={next}
        previous={grid(previousDays, null)}
        current={grid(days, open ?? null)}
        following={grid(followingDays, null)}
      />
    </>
  );
}

/** Rides inside the pane rather than above it, so it travels with its own grid. */
function DayHeaders({ days }: { days: Date[] }) {
  return (
    <div className="border-line flex shrink-0 border-b">
      <div className="w-14 shrink-0" />
      <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${days.length}, 1fr)` }}>
        {days.map((day) => (
          <div key={day.toISOString()} className="px-2 py-2">
            <div className="text-ink-faint text-[11px] tracking-wide uppercase">
              {format(day, "EEE")}
            </div>
            <div
              className={cn(
                "mt-0.5 flex h-7 w-7 items-center justify-center text-sm font-medium",
                isToday(day) && "bg-ink text-surface rounded-full",
              )}
            >
              {format(day, "d")}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

async function Month({
  days,
  anchor,
  eventsPromise,
  openEventId,
}: {
  days: Date[];
  anchor: Date;
  eventsPromise: Promise<CalendarEvent[]>;
  openEventId: string | null;
}) {
  return (
    <MonthGrid
      key={openEventId ?? "month"}
      days={days}
      anchor={anchor}
      events={await eventsPromise}
      openEventId={openEventId}
    />
  );
}

async function Grid({
  days,
  eventsPromise,
  openEventId,
}: {
  days: Date[];
  eventsPromise: Promise<CalendarEvent[]>;
  openEventId: string | null;
}) {
  return (
    // Keyed on the target so arriving from search rebuilds the grid: the drawer
    // is grid state, and a second search would otherwise land on a component
    // that has already consumed its initial value.
    <TimeGrid
      key={openEventId ?? "grid"}
      days={days}
      events={await eventsPromise}
      openEventId={openEventId}
    />
  );
}
