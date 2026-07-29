import { Suspense } from "react";
import { format, isToday } from "date-fns";
import { notFound } from "next/navigation";

import { CalendarToolbar } from "@/components/calendar/calendar-toolbar";
import { GridSkeleton } from "@/components/calendar/grid-skeleton";
import { TimeGrid } from "@/components/calendar/time-grid";
import { fromDateParam, isCalendarView, visibleDays } from "@/lib/date";
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

  const days = visibleDays(anchor, view);

  const rangeStart = new Date(days[0]);
  rangeStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(days[days.length - 1]);
  rangeEnd.setHours(24, 0, 0, 0);

  // Deliberately not awaited: the toolbar and day headers below render while
  // the query is still in flight, so changing week paints immediately.
  const eventsPromise = requireUserId().then((userId) =>
    getEventsInRange(userId, rangeStart, rangeEnd),
  );

  return (
    <>
      <CalendarToolbar view={view} anchor={anchor} />

      <div className="flex shrink-0 border-b border-zinc-200 dark:border-zinc-800">
        <div className="w-14 shrink-0" />
        <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${days.length}, 1fr)` }}>
          {days.map((day) => (
            <div key={day.toISOString()} className="px-2 py-2">
              <div className="text-[11px] tracking-wide text-zinc-400 uppercase">
                {format(day, "EEE")}
              </div>
              <div
                className={cn(
                  "mt-0.5 flex h-7 w-7 items-center justify-center text-sm font-medium",
                  isToday(day) &&
                    "rounded-full bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900",
                )}
              >
                {format(day, "d")}
              </div>
            </div>
          ))}
        </div>
      </div>

      <Suspense fallback={<GridSkeleton columns={days.length} />}>
        <Grid days={days} eventsPromise={eventsPromise} openEventId={open ?? null} />
      </Suspense>
    </>
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
