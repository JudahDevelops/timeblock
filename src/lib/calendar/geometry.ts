/**
 * Pure time <-> pixel maths for the hourly grid.
 *
 * Kept free of React and DOM so the arithmetic can be tested directly; every
 * drag interaction in the grid ultimately routes through these functions.
 */

/** Height of one hour, in CSS pixels. */
export const HOUR_HEIGHT = 56;

export const MINUTES_PER_DAY = 24 * 60;

/** Drag operations snap to this many minutes. */
export const SNAP_MINUTES = 15;

/** Shortest event the UI will produce, so a stray click can't make a 0-length block. */
export const MIN_EVENT_MINUTES = 15;

export const DAY_HEIGHT = (MINUTES_PER_DAY / 60) * HOUR_HEIGHT;

/** Width of the hour-label rail down the left edge, in CSS pixels. */
export const GUTTER_WIDTH = 56;

/**
 * Breathing room around a block, in CSS pixels.
 *
 * Taken off the bottom and the right only. A block's top and left edges have to
 * keep meeting the hour rule and the day divider — that alignment is the whole
 * reason a grid is readable at a glance — but the far edges are free to pull
 * back, so five back-to-back meetings read as five blocks and not one long bar.
 */
export const BLOCK_GAP = 2;
export const BLOCK_INSET = 2;
export const BLOCK_TRAIL = 6;

/** A floor for the painted height, so a one-minute sliver is still a rectangle. */
export const BLOCK_MIN_HEIGHT = 10;

export const HOURS: readonly number[] = Array.from({ length: 24 }, (_, i) => i);

export function minutesToY(minutes: number): number {
  return (minutes / 60) * HOUR_HEIGHT;
}

export function yToMinutes(y: number): number {
  return (y / HOUR_HEIGHT) * 60;
}

export function snapToStep(minutes: number, step: number = SNAP_MINUTES): number {
  return Math.round(minutes / step) * step;
}

export function clampToDay(minutes: number): number {
  return Math.min(MINUTES_PER_DAY, Math.max(0, minutes));
}

/** Minutes since midnight, in the viewer's local timezone. */
export function minutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** Applies a minutes-since-midnight offset to a day, returning a new Date. */
export function dayAtMinutes(day: Date, minutes: number): Date {
  const result = new Date(day);
  result.setHours(0, 0, 0, 0);
  // Rely on setMinutes rather than ms arithmetic so DST transitions resolve
  // the way the local calendar expects.
  result.setMinutes(minutes);
  return result;
}

export type Span = { startMinutes: number; endMinutes: number };

/**
 * The portion of an event visible on a given day, or null if it doesn't
 * intersect. Multi-day events are clipped to the day's bounds so each column
 * renders only its own slice.
 */
export function spanForDay(start: Date, end: Date, day: Date): Span | null {
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  if (end <= dayStart || start >= dayEnd) return null;

  const startMinutes = start <= dayStart ? 0 : minutesSinceMidnight(start);
  const endMinutes = end >= dayEnd ? MINUTES_PER_DAY : minutesSinceMidnight(end);

  return { startMinutes, endMinutes };
}
