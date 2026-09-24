import "server-only";

import { and, eq, exists, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { eventLinks, events } from "@/db/schema";

/**
 * A block of ours that the push sweep may write to Google. Recurring instances
 * are never pushable (see `pushEvent`), and Google-origin rows are excluded
 * because `pruneOutsideWindow` tombstones them while leaving their links live,
 * a shape identical to an unconfirmed local deletion. Widening this would
 * delete real events from the user's Google Calendar.
 */
export const ownedByUs = sql`(${events.origin} = 'local' and ${events.recurringEventId} is null)`;

const hasLiveLink = exists(
  db
    .select({ one: sql`1` })
    .from(eventLinks)
    .where(and(eq(eventLinks.localEventId, events.id), isNull(eventLinks.deletedAt))),
);

/**
 * One of our deletions that Google has not confirmed: the link stays live until
 * the withdrawal succeeds. The sweep retries these; the purge must keep them,
 * since purging cascades the link away and the next full resync would bring
 * the event back.
 */
export const pendingWithdrawal = sql`(${ownedByUs} and ${events.deletedAt} is not null and ${hasLiveLink})`;
