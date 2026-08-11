/**
 * Duration and clock formatting for the status window.
 *
 * Pure and separate from the components so the wording is testable — these
 * strings are the entire text content of a surface whose job is to be read in
 * about two seconds, so they get the same care as the layout.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * A duration as the shortest thing that still reads as English.
 *
 * Rounds up below a minute so a block never claims "0m left" while it is still
 * running — the number hitting zero should coincide with the block ending.
 */
export function formatDuration(ms: number): string {
  if (ms <= 0) return "0m";

  const hours = Math.floor(ms / HOUR_MS);
  const minutes = Math.ceil((ms % HOUR_MS) / MINUTE_MS);

  // Rounding minutes up can carry into a whole hour ("1h 60m").
  if (minutes === 60) return `${hours + 1}h`;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/** Wall-clock time, e.g. "9:00". Minutes always padded so a column stays aligned. */
export function formatClock(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** A block's span, e.g. "9:00–11:00". En dash, not a hyphen. */
export function formatSpan(startsAt: Date, endsAt: Date): string {
  return `${formatClock(startsAt)}–${formatClock(endsAt)}`;
}
