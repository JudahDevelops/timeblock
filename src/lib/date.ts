import { addDays, format, parseISO, startOfWeek } from "date-fns";

export const CALENDAR_VIEWS = ["day", "3day", "week"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export function isCalendarView(value: string): value is CalendarView {
  return (CALENDAR_VIEWS as readonly string[]).includes(value);
}

/** Days rendered as columns for a given view. */
export function viewDayCount(view: CalendarView): number {
  return view === "day" ? 1 : view === "3day" ? 3 : 7;
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
 * The columns a view shows. Week snaps to its Monday; day and 3-day start on
 * the anchor date itself so "next" paging feels direct.
 */
export function visibleDays(anchor: Date, view: CalendarView): Date[] {
  const start = view === "week" ? startOfWeek(anchor, { weekStartsOn: 1 }) : anchor;
  return Array.from({ length: viewDayCount(view) }, (_, i) => addDays(start, i));
}
