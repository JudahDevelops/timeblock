import { createHash } from "node:crypto";

import type { Event } from "@/db/schema";
import { publicEnv } from "@/env";
import type { EventWrite } from "@/lib/google/client";

/**
 * The outbound half of `map.ts`: local row to Google payload, and nothing else.
 *
 * Kept free of the database and of `server-only` so the arithmetic that is easy
 * to get quietly wrong — exclusive all-day ends, stub truncation — can be
 * tested directly.
 */

/**
 * Our id, carried on every event we write.
 *
 * This is what stops an event we just created from being re-imported as a
 * second, unlinked copy on the next inbound sync, and it survives a user
 * dragging the event between calendars in Google.
 */
export const TB_EVENT_ID = "tb_event_id";

/**
 * How much of the body rides along in Google's description.
 *
 * A taste, not a copy. Google's description is limited HTML that would
 * obliterate nesting, and the body is local-canonical — this exists so the
 * event is recognisable in a phone's calendar widget, not so it is readable
 * there. The link below it is the actual answer.
 */
const STUB_CHARS = 500;

/** Events we own and may write. Google's own imports are never pushed back. */
export function isPushable(event: Pick<Event, "origin" | "recurringEventId">): boolean {
  // Recurring writes are deferred: patching a single expanded instance creates
  // an override, and a botched one leaves duplicate ghosts that are miserable
  // to clean up.
  //
  // Guarded on `recurringEventId` rather than on an RRULE, because `singleEvents`
  // means Google never sends us the series master — an instance is the only
  // form a repeating event takes here, and it is the only one we can get wrong.
  return event.origin === "local" && event.recurringEventId === null;
}

export function permalink(eventId: string): string {
  return `${publicEnv.appUrl}/e/${eventId}`;
}

/**
 * The description we write, and the only thing in Google we claim ownership of.
 *
 * Hashed rather than compared verbatim so a human's edit in Google is
 * detectable without storing a second copy of our own text.
 */
export function descriptionStub(event: Pick<Event, "id" | "bodyText">): string {
  const body = (event.bodyText ?? "").trim();
  const excerpt = body.length > STUB_CHARS ? `${body.slice(0, STUB_CHARS).trimEnd()}…` : body;
  const link = `Open in Timeblock: ${permalink(event.id)}`;
  return excerpt ? `${excerpt}\n\n${link}` : link;
}

export function hashDescription(description: string): string {
  return createHash("sha256").update(description).digest("hex").slice(0, 32);
}

/**
 * Local event to Google payload.
 *
 * The all-day end date is exclusive: a block on the 5th ends `2026-08-06`, and
 * sending the 5th would silently shorten it to nothing.
 */
export function toEventWrite(event: Event): EventWrite {
  const description = descriptionStub(event);

  return {
    summary: event.title || "Untitled block",
    description,
    start: event.allDay
      ? { date: isoDate(event.startsAt, event.tz) }
      : { dateTime: event.startsAt.toISOString(), timeZone: event.tz },
    end: event.allDay
      ? { date: isoDate(event.endsAt, event.tz) }
      : { dateTime: event.endsAt.toISOString(), timeZone: event.tz },
    extendedProperties: { private: { [TB_EVENT_ID]: event.id } },
  };
}

function isoDate(date: Date, tz: string): string {
  // `en-CA` renders as `yyyy-mm-dd`, which is the shape Google wants, and the
  // zone has to be the event's own or a block near midnight lands a day out.
  return date.toLocaleDateString("en-CA", { timeZone: tz });
}
