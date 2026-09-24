import { TZDate } from "@date-fns/tz";

import type { GoogleDateTime, GoogleEvent } from "@/lib/google/client";
import { TB_EVENT_ID } from "@/lib/sync/payload";

export type MappedEvent = {
  gcalEventId: string;
  /**
   * Our own event id, if this is a block we pushed. Survives being dragged
   * between calendars in Google, so it is the one identifier that can match an
   * event back to its body when `event_links` cannot.
   */
  tbEventId: string | null;
  /** Google reports a deletion as a `cancelled` row, not an absent one. */
  cancelled: boolean;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  tz: string;
  recurringEventId: string | null;
  originalStartTime: Date | null;
  etag: string | null;
  updated: Date | null;
};

/**
 * Turns a Google event into the row shape this app stores.
 *
 * Returns null for anything unusable — a row with no id, or a live event with
 * no start. Sync must survive one malformed event rather than abandoning the
 * page it arrived in.
 */
export function mapGoogleEvent(event: GoogleEvent, calendarTz: string): MappedEvent | null {
  if (!event.id) return null;

  const cancelled = event.status === "cancelled";
  const tz = event.start?.timeZone ?? calendarTz;
  const tbEventId = event.extendedProperties?.private?.[TB_EVENT_ID] ?? null;

  const start = toInstant(event.start, tz);
  const end = toInstant(event.end, tz);

  // A cancellation often carries nothing but an id and a status; it still has
  // to be reported so the local row can be tombstoned.
  if (!start || !end) {
    if (!cancelled) return null;
    return {
      gcalEventId: event.id,
      tbEventId,
      cancelled: true,
      title: event.summary ?? "",
      startsAt: new Date(0),
      endsAt: new Date(0),
      allDay: false,
      tz,
      recurringEventId: event.recurringEventId ?? null,
      originalStartTime: toInstant(event.originalStartTime, tz),
      etag: event.etag ?? null,
      updated: event.updated ? new Date(event.updated) : null,
    };
  }

  return {
    gcalEventId: event.id,
    tbEventId,
    cancelled,
    title: event.summary ?? "",
    startsAt: start,
    endsAt: end,
    allDay: Boolean(event.start?.date),
    tz,
    recurringEventId: event.recurringEventId ?? null,
    originalStartTime: toInstant(event.originalStartTime, tz),
    etag: event.etag ?? null,
    updated: event.updated ? new Date(event.updated) : null,
  };
}

/**
 * Resolves either shape of Google's date field to an instant.
 *
 * An all-day event carries a bare `date`, which names a calendar day rather
 * than a moment. Reading it as UTC would slide the block onto the wrong day for
 * anyone not on UTC, so it is anchored to midnight in the event's own zone.
 * TZDate's string constructor parses in the machine's local zone, not `tz`,
 * so the date is split into numeric parts and passed to the numeric
 * constructor, which does interpret its components in `tz`.
 */
function toInstant(value: GoogleDateTime | undefined, tz: string): Date | null {
  if (!value) return null;
  if (value.dateTime) {
    const parsed = new Date(value.dateTime);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (value.date) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.date);
    if (!match) return null;
    const [, year, month, day] = match;
    const parsed = new TZDate(Number(year), Number(month) - 1, Number(day), tz);
    return Number.isNaN(parsed.getTime()) ? null : new Date(parsed.getTime());
  }
  return null;
}
