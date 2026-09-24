import "server-only";

import { and, desc, eq, isNotNull, isNull, lt, notExists, or, sql } from "drizzle-orm";

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
export async function pushEvent(
  userId: string,
  eventId: string,
  target?: Writable | null,
): Promise<PushResult> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event || event.userId !== userId) return "skipped";

  // A withdrawal is not an edit. `isPushable` exists to stop us rewriting the
  // schedule of an event Google owns, but deleting is the one thing the user is
  // always entitled to do — and gating it here is what left every deleted
  // Google-origin block alive in Google and resurrecting locally on each sync.
  //
  // Recurring instances stay excluded, and the asymmetry is deliberate:
  // cancelling one instance means writing an exception back to the series, the
  // recurring write this codebase still defers. They are kept deleted locally by
  // the `withdraw` verdict in `reconcile` instead.
  const withdrawing = event.deletedAt !== null && event.recurringEventId === null;
  if (!withdrawing && !isPushable(event)) return "skipped";

  const resolved = target ?? (await writableConnection(userId));
  if (!resolved) return "skipped";

  const { connection, accessToken } = resolved;

  const links = await db
    .select()
    .from(eventLinks)
    .where(
      and(
        eq(eventLinks.localEventId, eventId),
        eq(eventLinks.gcalCalendarId, connection.gcalCalendarId),
      ),
    );

  const live = links.find((l) => l.deletedAt === null) ?? null;
  const retired = links.some((l) => l.deletedAt !== null);

  const now = new Date();

  if (withdrawing) {
    // Nothing was ever pushed, so there is nothing to withdraw.
    if (!live) return "skipped";

    try {
      await deleteRemoteEvent(accessToken, connection.gcalCalendarId, live.gcalEventId);
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
          eq(eventLinks.gcalEventId, live.gcalEventId),
        ),
      );
    return "deleted";
  }

  const payload = toEventWrite(event);
  const descriptionHash = hashDescription(payload.description);

  if (live) {
    let remote;
    try {
      remote = await patchEvent(accessToken, connection.gcalCalendarId, live.gcalEventId, payload);
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
            eq(eventLinks.gcalEventId, live.gcalEventId),
          ),
        );
      return "skipped";
    }

    await recordLink(connection.gcalCalendarId, live.gcalEventId, eventId, remote, {
      descriptionHash,
      now,
    });
    return "updated";
  }

  // A retired link means Google no longer holds this event on purpose — deleted
  // there, or withdrawn by us — so inserting a fresh one would undo that.
  if (retired) return "skipped";

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
 * the user an edit they already made — so something has to close the loop.
 * Three disjoint cases select a row, all restricted to `origin = 'local'` and
 * non-recurring (a recurring instance is never pushable — see `pushEvent`):
 *
 *   1. Never pushed: a live block of ours with no link of any kind.
 *   2. Changed since the last push, or a won conflict (`applyPage`'s `relink`
 *      path clears `last_pushed_at` when local wins).
 *   3. A deletion of ours that Google has not confirmed yet — the link is
 *      still live because the withdrawal never succeeded.
 *
 * What is deliberately *not* selected, so the sweep never spends its budget on
 * dead rows: a tombstone whose withdrawal already succeeded (no live link left
 * to match case 3), a retired link left by `pushEvent` finding the event gone
 * in Google (case 1 would otherwise recreate it — `pushEvent` also refuses this
 * directly, belt and braces), and any Google-origin tombstone. That last one
 * matters beyond tidiness: `pruneOutsideWindow` tombstones Google-origin rows
 * that fall outside the sync window and deliberately leaves their link live, a
 * shape indistinguishable in the database from a local deletion that never
 * reached Google. Widening case 3 to Google-origin rows would delete those
 * events from the user's Google Calendar on the next sweep.
 */
export async function pushPending(userId: string, limit = 50): Promise<Record<PushResult, number>> {
  const target = await writableConnection(userId);
  // Nothing can be pushed without a writable connection, and today every
  // selected row pays for discovering that on its own.
  if (!target) return { created: 0, updated: 0, deleted: 0, skipped: 0 };

  const pending = await db
    .select({ id: events.id })
    .from(events)
    .leftJoin(eventLinks, and(eq(eventLinks.localEventId, events.id), isNull(eventLinks.deletedAt)))
    .where(
      and(
        eq(events.userId, userId),
        or(
          // Never pushed: a live block of ours with no link of any kind.
          and(
            isNull(events.deletedAt),
            eq(events.origin, "local"),
            isNull(events.recurringEventId),
            notExists(
              db
                .select({ one: sql`1` })
                .from(eventLinks)
                .where(eq(eventLinks.localEventId, events.id)),
            ),
          ),
          // Changed since the last push, or a won conflict (`last_pushed_at` cleared).
          and(
            isNull(events.deletedAt),
            eq(events.origin, "local"),
            isNull(events.recurringEventId),
            isNotNull(eventLinks.gcalEventId),
            or(isNull(eventLinks.lastPushedAt), lt(eventLinks.lastPushedAt, events.updatedAt)),
          ),
          // A deletion of ours that Google has not confirmed yet. Restricted to
          // origin = 'local' on purpose: see the function comment above for why
          // widening this to Google-origin rows would delete real events from
          // the user's Google Calendar.
          and(
            isNotNull(events.deletedAt),
            eq(events.origin, "local"),
            isNull(events.recurringEventId),
            isNotNull(eventLinks.gcalEventId),
          ),
        ),
      ),
    )
    // Newest first. A row whose push fails on every sweep (an invalid `tz`,
    // say) keeps its old `updated_at`, so this lets such rows sink to the back
    // instead of permanently filling the budget. New work could only starve
    // old work if one user produced more than `limit` edits every five
    // minutes.
    .orderBy(desc(events.updatedAt))
    .limit(limit);

  const tally: Record<PushResult, number> = { created: 0, updated: 0, deleted: 0, skipped: 0 };

  for (const row of pending) {
    try {
      tally[await pushEvent(userId, row.id, target)]++;
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
