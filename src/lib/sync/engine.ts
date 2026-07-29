import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { calendarConnections, eventLinks, events } from "@/db/schema";
import { getAccessToken } from "@/lib/google/auth";
import { fullSyncParams, getCalendar, listEvents, type GoogleEvent } from "@/lib/google/client";
import { mapGoogleEvent, type MappedEvent } from "./map";

/**
 * A stop, not a budget. 250 events a page, so this is 25 000 events — far past
 * any real calendar, and the point at which something has clearly gone wrong.
 */
const MAX_PAGES = 100;

export type SyncOutcome = {
  imported: number;
  cancelled: number;
  skipped: number;
  syncToken: string | null;
};

/**
 * Pulls a calendar into local rows. Read-only: this never calls Google with
 * anything but GET.
 *
 * Google events land in the same `events` table as local ones, marked
 * `origin: "google"`. A separate table would need every read path duplicated,
 * and from Phase 7 the two kinds converge anyway.
 */
export async function fullSync(connectionId: string): Promise<SyncOutcome> {
  const [connection] = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.id, connectionId))
    .limit(1);

  if (!connection) throw new Error(`Unknown connection ${connectionId}`);

  const accessToken = await getAccessToken(connection.googleAccountId);
  const calendar = await getCalendar(accessToken, connection.gcalCalendarId);
  const calendarTz = calendar.timeZone ?? "UTC";

  const params = fullSyncParams();
  const outcome: SyncOutcome = { imported: 0, cancelled: 0, skipped: 0, syncToken: null };

  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await listEvents(accessToken, connection.gcalCalendarId, params, pageToken);

    for (const item of result.items ?? []) {
      const mapped = mapGoogleEvent(item, calendarTz);
      if (!mapped) {
        outcome.skipped++;
        continue;
      }
      if (isOurOwnEvent(item)) {
        // Written by us and echoed straight back. Phase 7 reconciles these;
        // importing one now would fork the event into a second local row.
        outcome.skipped++;
        continue;
      }

      if (mapped.cancelled) {
        if (await tombstone(connection, mapped)) outcome.cancelled++;
      } else {
        await upsert(connection, mapped);
        outcome.imported++;
      }
    }

    // The token only arrives on the final page; earlier pages carry a pageToken.
    if (result.nextSyncToken) outcome.syncToken = result.nextSyncToken;
    pageToken = result.nextPageToken;
    if (!pageToken) break;
  }

  await db
    .update(calendarConnections)
    .set({
      syncToken: outcome.syncToken,
      lastFullSyncAt: new Date(),
      lastInboundOkAt: new Date(),
    })
    .where(eq(calendarConnections.id, connectionId));

  return outcome;
}

/** Events we pushed to Google carry our id, and must never be re-imported. */
function isOurOwnEvent(event: GoogleEvent): boolean {
  return Boolean(event.extendedProperties?.private?.tb_event_id);
}

type Connection = typeof calendarConnections.$inferSelect;

/**
 * Creates or updates the local row for a Google event.
 *
 * `event_links` is the only thing consulted to decide which — never a title or
 * time match. That link is also what protects block bodies: a resynced event
 * finds its existing local row and updates the fields Google owns, leaving
 * `body` untouched.
 */
async function upsert(connection: Connection, mapped: MappedEvent): Promise<void> {
  const [link] = await db
    .select({ localEventId: eventLinks.localEventId })
    .from(eventLinks)
    .where(
      and(
        eq(eventLinks.gcalCalendarId, connection.gcalCalendarId),
        eq(eventLinks.gcalEventId, mapped.gcalEventId),
      ),
    )
    .limit(1);

  const fields = {
    title: mapped.title,
    startsAt: mapped.startsAt,
    endsAt: mapped.endsAt,
    allDay: mapped.allDay,
    tz: mapped.tz,
    recurringEventId: mapped.recurringEventId,
    originalStartTime: mapped.originalStartTime,
    updatedAt: new Date(),
  };

  let localEventId = link?.localEventId;

  if (localEventId) {
    await db
      .update(events)
      .set({
        ...fields,
        // Google resurrecting an event un-deletes it here too.
        deletedAt: null,
      })
      .where(eq(events.id, localEventId));
  } else {
    const [row] = await db
      .insert(events)
      .values({ ...fields, userId: connection.userId, origin: "google" })
      .returning({ id: events.id });
    localEventId = row.id;
  }

  await db
    .insert(eventLinks)
    .values({
      gcalCalendarId: connection.gcalCalendarId,
      gcalEventId: mapped.gcalEventId,
      localEventId,
      gcalEtag: mapped.etag,
      gcalUpdated: mapped.updated,
      lastPulledAt: new Date(),
      deletedAt: null,
    })
    .onConflictDoUpdate({
      target: [eventLinks.gcalCalendarId, eventLinks.gcalEventId],
      set: {
        localEventId,
        gcalEtag: mapped.etag,
        gcalUpdated: mapped.updated,
        lastPulledAt: new Date(),
        deletedAt: null,
      },
    });
}

/** Soft-deletes the local row for a cancelled Google event. Returns false if it was never here. */
async function tombstone(connection: Connection, mapped: MappedEvent): Promise<boolean> {
  const [link] = await db
    .select({ localEventId: eventLinks.localEventId })
    .from(eventLinks)
    .where(
      and(
        eq(eventLinks.gcalCalendarId, connection.gcalCalendarId),
        eq(eventLinks.gcalEventId, mapped.gcalEventId),
      ),
    )
    .limit(1);

  if (!link) return false;

  const now = new Date();
  await db
    .update(events)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(events.id, link.localEventId));
  await db
    .update(eventLinks)
    .set({ deletedAt: now, lastPulledAt: now })
    .where(
      and(
        eq(eventLinks.gcalCalendarId, connection.gcalCalendarId),
        eq(eventLinks.gcalEventId, mapped.gcalEventId),
      ),
    );

  return true;
}
