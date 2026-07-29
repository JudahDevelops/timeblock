import "server-only";

import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { calendarConnections, eventLinks, events, googleAccounts } from "@/db/schema";
import { canWrite, getAccessToken, GoogleRevokedError } from "@/lib/google/auth";
import {
  deleteEvent as deleteRemoteEvent,
  GoogleApiError,
  insertEvent,
  patchEvent,
} from "@/lib/google/client";
import { hashDescription, isPushable, toEventWrite } from "@/lib/sync/payload";

export type PushResult = "created" | "updated" | "deleted" | "skipped";

/**
 * Pushes one local event to Google.
 *
 * Called inline from the server actions so a block appears in Google within
 * seconds, and again from the cron for anything that inline attempt missed.
 * Idempotent by way of `event_links`: the link decides create-versus-update,
 * never a title or time match.
 */
export async function pushEvent(userId: string, eventId: string): Promise<PushResult> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event || event.userId !== userId || !isPushable(event)) return "skipped";

  const target = await writableConnection(userId);
  if (!target) return "skipped";

  const { connection, accessToken } = target;

  const [link] = await db
    .select()
    .from(eventLinks)
    .where(
      and(
        eq(eventLinks.localEventId, eventId),
        eq(eventLinks.gcalCalendarId, connection.gcalCalendarId),
      ),
    )
    .limit(1);

  const now = new Date();

  if (event.deletedAt) {
    // Nothing was ever pushed, so there is nothing to withdraw.
    if (!link || link.deletedAt) return "skipped";

    try {
      await deleteRemoteEvent(accessToken, connection.gcalCalendarId, link.gcalEventId);
    } catch (cause) {
      // Already gone in Google is the outcome we wanted, not a failure.
      if (!(cause instanceof GoogleApiError) || !cause.isGone) throw cause;
    }

    await db
      .update(eventLinks)
      .set({ deletedAt: now, lastPushedAt: now })
      .where(
        and(
          eq(eventLinks.gcalCalendarId, connection.gcalCalendarId),
          eq(eventLinks.gcalEventId, link.gcalEventId),
        ),
      );
    return "deleted";
  }

  const payload = toEventWrite(event);
  const descriptionHash = hashDescription(payload.description);

  if (link && !link.deletedAt) {
    let remote;
    try {
      remote = await patchEvent(accessToken, connection.gcalCalendarId, link.gcalEventId, payload);
    } catch (cause) {
      if (!(cause instanceof GoogleApiError) || !cause.isGone) throw cause;
      // Deleted in Google while we still held the link. Recreating it would
      // fight the user's deletion, so the link is retired and the block stays
      // local — a decision the inbound sync will confirm on its next run.
      await db
        .update(eventLinks)
        .set({ deletedAt: now, lastPushedAt: now })
        .where(
          and(
            eq(eventLinks.gcalCalendarId, connection.gcalCalendarId),
            eq(eventLinks.gcalEventId, link.gcalEventId),
          ),
        );
      return "skipped";
    }

    await recordLink(connection.gcalCalendarId, link.gcalEventId, eventId, remote, {
      descriptionHash,
      now,
    });
    return "updated";
  }

  const remote = await insertEvent(accessToken, connection.gcalCalendarId, payload);
  await recordLink(connection.gcalCalendarId, remote.id, eventId, remote, {
    descriptionHash,
    now,
  });
  return "created";
}

async function recordLink(
  calendarId: string,
  gcalEventId: string,
  localEventId: string,
  remote: { etag?: string; updated?: string },
  meta: { descriptionHash: string; now: Date },
) {
  await db
    .insert(eventLinks)
    .values({
      gcalCalendarId: calendarId,
      gcalEventId,
      localEventId,
      gcalEtag: remote.etag ?? null,
      // Google's own `updated` for the write we just made. Phase 9 compares
      // this against the local `updated_at` to settle concurrent edits.
      gcalUpdated: remote.updated ? new Date(remote.updated) : meta.now,
      gcalDescriptionHash: meta.descriptionHash,
      lastPushedAt: meta.now,
      deletedAt: null,
    })
    .onConflictDoUpdate({
      target: [eventLinks.gcalCalendarId, eventLinks.gcalEventId],
      set: {
        localEventId: sql`excluded.local_event_id`,
        gcalEtag: sql`excluded.gcal_etag`,
        gcalUpdated: sql`excluded.gcal_updated`,
        gcalDescriptionHash: sql`excluded.gcal_description_hash`,
        lastPushedAt: sql`excluded.last_pushed_at`,
        deletedAt: sql`null`,
      },
    });
}

type Writable = { connection: typeof calendarConnections.$inferSelect; accessToken: string };

/**
 * The calendar this user's blocks are written to, or nothing.
 *
 * Returning null rather than throwing is the point: a user with no Google
 * account connected, or one who only ever granted read access, must still be
 * able to plan their day. Pushing is an enhancement to a local-first app, not
 * a precondition for using it.
 */
async function writableConnection(userId: string): Promise<Writable | null> {
  const [row] = await db
    .select({ connection: calendarConnections, scopes: googleAccounts.scopes })
    .from(calendarConnections)
    .innerJoin(googleAccounts, eq(calendarConnections.googleAccountId, googleAccounts.id))
    .where(and(eq(calendarConnections.userId, userId), isNull(googleAccounts.revokedAt)))
    .limit(1);

  if (!row || row.connection.direction === "read" || !canWrite(row.scopes)) return null;

  return {
    connection: row.connection,
    accessToken: await getAccessToken(row.connection.googleAccountId),
  };
}

/**
 * Retries whatever the inline push did not manage.
 *
 * The inline attempt is best-effort by design — a Google outage must never cost
 * the user an edit they already made — so something has to close the loop. A
 * row qualifies when it has no link at all, when it changed after the last time
 * we pushed it, or when the inbound sync cleared `last_pushed_at` to say our
 * version won a conflict and has to go out again.
 */
export async function pushPending(userId: string, limit = 50): Promise<Record<PushResult, number>> {
  const pending = await db
    .select({ id: events.id })
    .from(events)
    .leftJoin(eventLinks, and(eq(eventLinks.localEventId, events.id), isNull(eventLinks.deletedAt)))
    .where(
      and(
        eq(events.userId, userId),
        eq(events.origin, "local"),
        or(
          isNull(eventLinks.gcalEventId),
          isNull(eventLinks.lastPushedAt),
          lt(eventLinks.lastPushedAt, events.updatedAt),
          // A local deletion still has to reach Google, and its link is still
          // live until the delete succeeds.
          and(isNotNull(events.deletedAt), isNull(eventLinks.deletedAt)),
        ),
      ),
    )
    .limit(limit);

  const tally: Record<PushResult, number> = { created: 0, updated: 0, deleted: 0, skipped: 0 };

  for (const row of pending) {
    try {
      tally[await pushEvent(userId, row.id)]++;
    } catch (cause) {
      // One bad event must not strand the rest of the queue.
      if (cause instanceof GoogleRevokedError) throw cause;
      console.error(`Push failed for event ${row.id}`, cause);
      tally.skipped++;
    }
  }

  return tally;
}

/**
 * Fire-and-forget push for the interactive paths.
 *
 * The local write is already committed by the time this runs, so a failure here
 * is a delay rather than a loss — `pushPending` sweeps it up within five
 * minutes. Awaiting it and rethrowing would turn a Google hiccup into a failed
 * drag, which is the wrong trade in a local-first app.
 */
export async function pushEventBestEffort(userId: string, eventId: string): Promise<void> {
  try {
    await pushEvent(userId, eventId);
  } catch (cause) {
    console.error(`Inline push failed for event ${eventId}; leaving it to the sweep`, cause);
  }
}
