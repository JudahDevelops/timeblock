import { notFound } from "next/navigation";

import { fromDateParam, isCalendarView, visibleDays } from "@/lib/date";

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

  // Phase 2 replaces this with the hourly time grid.
  return (
    <main className="flex flex-1 flex-col p-8">
      <h1 className="text-sm font-medium text-zinc-500">
        {view} · {date}
      </h1>
      <p className="mt-2 text-xs text-zinc-400">
        {days.length} column{days.length === 1 ? "" : "s"}
      </p>
    </main>
  );
}
