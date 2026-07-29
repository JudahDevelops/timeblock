import { notFound } from "next/navigation";

import { CalendarToolbar } from "@/components/calendar/calendar-toolbar";
import { fromDateParam, isCalendarView, visibleDays } from "@/lib/date";
import { format, isToday } from "date-fns";

export default async function CalendarPage({
  params,
}: {
  params: Promise<{ view: string; date: string }>;
}) {
  const { view, date } = await params;

  if (!isCalendarView(view)) notFound();
  const anchor = fromDateParam(date);
  if (!anchor) notFound();

  const days = visibleDays(anchor, view);

  return (
    <>
      <CalendarToolbar view={view} anchor={anchor} />

      {/* Phase 2 replaces this header strip with the scrolling hourly grid. */}
      <div className="flex flex-1 overflow-hidden">
        <div className="w-14 shrink-0 border-r border-zinc-200 dark:border-zinc-800" />
        <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${days.length}, 1fr)` }}>
          {days.map((day) => (
            <div
              key={day.toISOString()}
              className="border-r border-zinc-200 px-2 py-3 last:border-r-0 dark:border-zinc-800"
            >
              <div className="text-[11px] tracking-wide text-zinc-400 uppercase">
                {format(day, "EEE")}
              </div>
              <div
                className={
                  isToday(day)
                    ? "mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-sm font-medium text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                    : "mt-0.5 flex h-7 w-7 items-center justify-center text-sm font-medium"
                }
              >
                {format(day, "d")}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
