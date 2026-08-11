import "server-only";

import { and, asc, eq, gt, isNull, lt } from "drizzle-orm";

import { db } from "@/db";
import { events } from "@/db/schema";
import { isBlockDocument } from "@/lib/editor/document";
import type { StatusEvent } from "@/lib/status/resolve";

/**
 * Today's blocks, bodies included.
 *
 * Deliberately separate from `getEventsInRange`, which omits `body` because it
 * feeds the grid: widening that query would pull every block's document into
 * every calendar page load. This one is scoped to a single day, so carrying the
 * bodies is cheap, and the bodies are the whole point — the checklist inside
 * them is what the status window reads.
 */
export async function getStatusEvents(
  userId: string,
  from: Date,
  to: Date,
): Promise<StatusEvent[]> {
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      allDay: events.allDay,
      body: events.body,
    })
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        isNull(events.deletedAt),
        lt(events.startsAt, to),
        // Strictly greater, matching getEventsInRange's boundary rule: a block
        // ending exactly at `from` belongs to the previous window.
        gt(events.endsAt, from),
      ),
    )
    .orderBy(asc(events.startsAt));

  return rows.map((row) => ({
    ...row,
    // Same trust boundary as the body route: jsonb hands back whatever was
    // stored, and an empty document beats throwing on the status window.
    body: isBlockDocument(row.body) ? row.body : [],
  }));
}
