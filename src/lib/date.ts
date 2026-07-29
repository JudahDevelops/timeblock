import {
  addDays,
  addMonths,
  format,
  isSameMonth,
  isSameYear,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";

export const CALENDAR_VIEWS = ["day", "3day", "week", "month"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

/** Monday. Fixed rather than a preference, so every view agrees on it. */
export const WEEK_STARTS_ON = 1 as const;

const DAYS_PER_WEEK = 7;
/** Always six rows, so paging months never changes the grid's height. */
export const MONTH_ROWS = 6;

export function isCalendarView(value: string): value is CalendarView {
  return (CALENDAR_VIEWS as readonly string[]).includes(value);
}

/** Month is a grid of whole days; everything else is a row of hourly columns. */
export function isTimeGridView(view: CalendarView): boolean {
  return view !== "month";
}

/** Days a view covers. */
export function viewDayCount(view: CalendarView): number {
  if (view === "day") return 1;
  if (view === "3day") return 3;
  if (view === "week") return DAYS_PER_WEEK;
  return MONTH_ROWS * DAYS_PER_WEEK;
}

export const DATE_PARAM = "yyyy-MM-dd";

export function toDateParam(date: Date): string {
  return format(date, DATE_PARAM);
}

/** Parses a `yyyy-MM-dd` route param, or null if malformed. */
export function fromDateParam(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * The days a view shows. Week snaps to its Monday and month to the Monday on
 * or before the 1st — so a month grid opens with whole weeks and usually
 * spills a few days of its neighbours. Day and 3-day start on the anchor
 * itself, so "next" paging feels direct.
 */
export function visibleDays(anchor: Date, view: CalendarView): Date[] {
  const start =
    view === "week"
      ? startOfWeek(anchor, { weekStartsOn: WEEK_STARTS_ON })
      : view === "month"
        ? startOfWeek(startOfMonth(anchor), { weekStartsOn: WEEK_STARTS_ON })
        : anchor;
  return Array.from({ length: viewDayCount(view) }, (_, i) => addDays(start, i));
}

/** Pages the anchor forward or back by exactly one screenful. */
export function shiftAnchor(anchor: Date, view: CalendarView, direction: 1 | -1): Date {
  // A month steps by calendar month, not by 42 days, or paging twice would
  // skip one entirely.
  if (view === "month") return addMonths(startOfMonth(anchor), direction);
  return addDays(anchor, viewDayCount(view) * direction);
}

/** Human label for the visible range, e.g. "29 Jul – 4 Aug 2026". */
export function rangeLabel(anchor: Date, view: CalendarView): string {
  if (view === "day") return format(anchor, "EEEE d MMMM yyyy");
  // The grid shows fringes of the neighbouring months, but the month it is
  // *of* is the anchor's — labelling it by its first cell would read wrong.
  if (view === "month") return format(anchor, "MMMM yyyy");

  const days = visibleDays(anchor, view);
  const first = days[0];
  const last = days[days.length - 1];

  const sameMonth = isSameMonth(first, last);
  const sameYear = isSameYear(first, last);

  const left = format(first, sameMonth ? "d" : sameYear ? "d MMM" : "d MMM yyyy");
  return `${left} – ${format(last, "d MMM yyyy")}`;
}

/** Short label for the same range, for screens with no room for the long one. */
export function shortRangeLabel(anchor: Date, view: CalendarView): string {
  if (view === "day") return format(anchor, "d MMM yyyy");
  if (view === "month") return format(anchor, "MMM yyyy");

  const days = visibleDays(anchor, view);
  const last = days[days.length - 1];
  return isSameMonth(days[0], last)
    ? format(last, "MMM yyyy")
    : `${format(days[0], "MMM")} – ${format(last, "MMM yyyy")}`;
}

export function calendarPath(view: CalendarView, date: Date): string {
  return `/calendar/${view}/${toDateParam(date)}`;
}

/** Weekday initials in display order, e.g. M T W T F S S. */
export function weekdayInitials(): string[] {
  const start = startOfWeek(new Date(), { weekStartsOn: WEEK_STARTS_ON });
  return Array.from({ length: DAYS_PER_WEEK }, (_, i) => format(addDays(start, i), "EEEEE"));
}
