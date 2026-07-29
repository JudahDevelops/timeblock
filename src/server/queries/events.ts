import "server-only";

import { and, asc, gt, isNull, lt, eq } from "drizzle-orm";

import { db } from "@/db";
import { events } from "@/db/schema";

export type CalendarEvent = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  origin: "local" | "google";
};

/**
 * Events overlapping [from, to).
 *
 * The predicate is `startsAt < to AND endsAt > from` rather than a simple
 * BETWEEN, so an event that begins before the window but runs into it still
 * appears — otherwise long blocks vanish when you page the calendar.
 */
export async function getEventsInRange(
  userId: string,
  from: Date,
  to: Date,
): Promise<CalendarEvent[]> {
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      allDay: events.allDay,
      origin: events.origin,
    })
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        isNull(events.deletedAt),
        lt(events.startsAt, to),
        // Strictly greater: an event ending exactly at `from` belongs to the
        // previous window, matching spanForDay's boundary rule.
        gt(events.endsAt, from),
      ),
    )
    .orderBy(asc(events.startsAt));

  return rows;
}
