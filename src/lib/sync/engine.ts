import "server-only";

import { and, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { calendarConnections, eventLinks, events } from "@/db/schema";
import { getAccessToken } from "@/lib/google/auth";
import {
  fullSyncParams,
  getCalendar,
  GoogleApiError,
  incrementalParams,
  listEvents,
  syncWindow,
  type GoogleEvent,
  type SyncWindow,
} from "@/lib/google/client";
import { mapGoogleEvent, type MappedEvent } from "./map";

/**
 * A stop, not a budget. 250 events a page, so this is 25 000 events — far past
 * any real calendar, and the point at which something has clearly gone wrong.
 */
const MAX_PAGES = 100;

export type SyncMode = "full" | "incremental";

export type SyncOutcome = {
  mode: SyncMode;
  imported: number;
  cancelled: number;
  skipped: number;
  /** Rows the window no longer covers. See `pruneOutsideWindow`. */
  pruned: number;
  syncToken: string | null;
};

type Connection = typeof calendarConnections.$inferSelect;

/**
 * Brings a calendar up to date. Read-only: this never calls Google with
 * anything but GET.
 *
 * Incremental whenever a sync token survives, which is the normal case and
 * costs one near-empty request every five minutes instead of a full window.
 * The full path is the fallback, not the default.
 */
export async function syncConnection(connectionId: string): Promise<SyncOutcome> {
  const [connection] = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.id, connectionId))
    .limit(1);

  if (!connection) throw new Error(`Unknown connection ${connectionId}`);

  if (!connection.syncToken) return runSync(connection, "full");

  try {
    return await runSync(connection, "incremental");
  } catch (cause) {
    if (!(cause instanceof GoogleApiError) || !cause.isSyncTokenExpired) throw cause;

    // A 410 means the token is too old to describe the gap, so the only way
    // forward is to re-read the window. It emphatically does *not* mean the
    // local rows are wrong: every one of them is matched back through
    // `event_links` by id, so bodies, `body_rev` and everything else we own
    // survive being rewritten — verified against a real calendar, not assumed.
    // The one thing the resync does remove is covered in `pruneOutsideWindow`,
    // and it will not touch a row with a body.
    console.warn(`Sync token expired for connection ${connectionId}; falling back to full sync`);
    return runSync(connection, "full");
  }
}

/**
 * One page loop, two ways in.
 *
 * The paging, mapping and writing are identical either way — the modes differ
 * only in the query that opens them, so they share everything after it. Keeping
 * them as one function is what guarantees a full resync reconciles by exactly
 * the same rules as a routine one.
 */
async function runSync(connection: Connection, mode: SyncMode): Promise<SyncOutcome> {
  const accessToken = await getAccessToken(connection.googleAccountId);
  const calendar = await getCalendar(accessToken, connection.gcalCalendarId);
  const calendarTz = calendar.timeZone ?? "UTC";

  const window = syncWindow();
  const params =
    mode === "full" ? fullSyncParams(window) : incrementalParams(connection.syncToken as string);

  const outcome: SyncOutcome = {
    mode,
    imported: 0,
    cancelled: 0,
    skipped: 0,
    pruned: 0,
    syncToken: null,
  };

  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await listEvents(accessToken, connection.gcalCalendarId, params, pageToken);

    // Keyed by event id, not a list: a page may legitimately carry the same
    // id twice, and Postgres aborts a multi-row upsert that would "affect row
    // a second time". Last write wins, matching Google's own ordering.
    const batch = new Map<string, MappedEvent>();
    for (const item of result.items ?? []) {
      const mapped = mapGoogleEvent(item, calendarTz);
      if (!mapped || isOurOwnEvent(item)) {
        // Unusable, or written by us and echoed straight back. Phase 7
        // reconciles ours; importing one now would fork it into a second row.
        outcome.skipped++;
        continue;
      }
      batch.set(mapped.gcalEventId, mapped);
    }

    const applied = await applyPage(connection, [...batch.values()]);
    outcome.imported += applied.imported;
    outcome.cancelled += applied.cancelled;

    // The token only arrives on the final page; earlier pages carry a pageToken.
    if (result.nextSyncToken) outcome.syncToken = result.nextSyncToken;
    pageToken = result.nextPageToken;
    if (!pageToken) break;
  }

  const now = new Date();

  if (mode === "full") outcome.pruned = await pruneOutsideWindow(connection, window, now);

  await db
    .update(calendarConnections)
    .set({
      // Google mints a fresh token every run and retires the one it replaces,
      // so this always moves forward. Keeping the old one on a run that
      // somehow returned none would guarantee a 410 on the next.
      syncToken: outcome.syncToken,
      // Only a full sync re-established the window, so only it moves this.
      ...(mode === "full" ? { lastFullSyncAt: now } : {}),
      // Distinct from the above: this is the staleness alarm's clock, and it
      // has to tick on a run that found nothing at all — which is what a
      // healthy incremental sync looks like almost every time.
      lastInboundOkAt: now,
    })
    .where(eq(calendarConnections.id, connection.id));

  return outcome;
}

/** Events we pushed to Google carry our id, and must never be re-imported. */
function isOurOwnEvent(event: GoogleEvent): boolean {
  return Boolean(event.extendedProperties?.private?.tb_event_id);
}

/**
 * Tombstones imported rows the window has moved off.
 *
 * Narrowing the window left 111 birthday instances stranded out to 2055: no
 * sync asks about them again, so nothing ever updates or removes them, and the
 * month view happily paged to 2050 and showed them. Debris, and it accumulates
 * every time the policy changes.
 *
 * Two guards keep this well clear of the trap that a 410 must never wipe local
 * work. It fires on the window, never on absence — an event Google simply
 * failed to mention is left exactly alone. And it refuses any row carrying a
 * body, because a stranded row with notes in it is the one thing worth more
 * than a tidy table.
 *
 * The `event_links` row is deliberately left live. It is the only thing that
 * can match this event again, so if the window ever widens the upsert finds it
 * and clears `deleted_at` — the tombstone is reversible by construction.
 */
async function pruneOutsideWindow(
  connection: Connection,
  window: SyncWindow,
  now: Date,
): Promise<number> {
  const pruned = await db
    .update(events)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        // Scoped by user rather than by connection: the window is the same for
        // every calendar, so a join through `event_links` would narrow the set
        // without changing the verdict on any row in it.
        eq(events.userId, connection.userId),
        eq(events.origin, "google"),
        isNull(events.deletedAt),
        eq(events.bodyRev, 0),
        or(lt(events.startsAt, window.timeMin), gt(events.startsAt, window.timeMax)),
      ),
    )
    .returning({ id: events.id });

  return pruned.length;
}

/**
 * Writes one page of mapped events.
 *
 * Per page, not per event, and that is the whole design. Supabase sits ~270ms
 * away, so the obvious row-at-a-time loop cost three round trips each and took
 * two and a half minutes on a 322-event calendar. This is four round trips for
 * the entire page regardless of its size.
 *
 * `event_links` is the only thing consulted to decide create-vs-update — never
 * a title or time match. That link is also what protects block bodies: the
 * upsert below lists the columns Google owns and no others, so `body`,
 * `body_text` and `body_rev` survive every resync untouched.
 */
async function applyPage(
  connection: Connection,
  mapped: MappedEvent[],
): Promise<{ imported: number; cancelled: number }> {
  if (mapped.length === 0) return { imported: 0, cancelled: 0 };

  const links = await db
    .select({ gcalEventId: eventLinks.gcalEventId, localEventId: eventLinks.localEventId })
    .from(eventLinks)
    .where(
      and(
        eq(eventLinks.gcalCalendarId, connection.gcalCalendarId),
        inArray(
          eventLinks.gcalEventId,
          mapped.map((m) => m.gcalEventId),
        ),
      ),
    );
  const known = new Map(links.map((l) => [l.gcalEventId, l.localEventId]));

  const now = new Date();
  const live = mapped.filter((m) => !m.cancelled);
  // A cancellation for something we never imported is not a deletion, it is
  // noise — Google reports them for the whole window on a full sync.
  const dead = mapped.filter((m) => m.cancelled && known.has(m.gcalEventId));

  // One transaction per page. An event row without its link is invisible to
  // every future sync — nothing can ever match it again, so the next run
  // imports a second copy. Two interrupted connects left exactly that behind
  // while these were separate statements.
  await db.transaction(async (tx) => {
    if (live.length > 0) {
      // Ids are minted here rather than read back from `RETURNING`, which is
      // what lets the events and their links go out as two statements instead
      // of one per row.
      const rows = live.map((m) => ({
        id: known.get(m.gcalEventId) ?? crypto.randomUUID(),
        userId: connection.userId,
        origin: "google" as const,
        title: m.title,
        startsAt: m.startsAt,
        endsAt: m.endsAt,
        allDay: m.allDay,
        tz: m.tz,
        recurringEventId: m.recurringEventId,
        originalStartTime: m.originalStartTime,
        deletedAt: null,
        updatedAt: now,
      }));

      await tx
        .insert(events)
        .values(rows)
        .onConflictDoUpdate({
          target: events.id,
          set: {
            title: sql`excluded.title`,
            startsAt: sql`excluded.starts_at`,
            endsAt: sql`excluded.ends_at`,
            allDay: sql`excluded.all_day`,
            tz: sql`excluded.tz`,
            recurringEventId: sql`excluded.recurring_event_id`,
            originalStartTime: sql`excluded.original_start_time`,
            // Google resurrecting an event un-deletes it here too.
            deletedAt: sql`null`,
            updatedAt: sql`excluded.updated_at`,
          },
        });

      await tx
        .insert(eventLinks)
        .values(
          live.map((m, i) => ({
            gcalCalendarId: connection.gcalCalendarId,
            gcalEventId: m.gcalEventId,
            localEventId: rows[i].id,
            gcalEtag: m.etag,
            gcalUpdated: m.updated,
            lastPulledAt: now,
            deletedAt: null,
          })),
        )
        .onConflictDoUpdate({
          target: [eventLinks.gcalCalendarId, eventLinks.gcalEventId],
          set: {
            localEventId: sql`excluded.local_event_id`,
            gcalEtag: sql`excluded.gcal_etag`,
            gcalUpdated: sql`excluded.gcal_updated`,
            lastPulledAt: sql`excluded.last_pulled_at`,
            deletedAt: sql`null`,
          },
        });
    }

    if (dead.length > 0) {
      await tx
        .update(events)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          inArray(
            events.id,
            dead.map((m) => known.get(m.gcalEventId)!),
          ),
        );
      await tx
        .update(eventLinks)
        .set({ deletedAt: now, lastPulledAt: now })
        .where(
          and(
            eq(eventLinks.gcalCalendarId, connection.gcalCalendarId),
            inArray(
              eventLinks.gcalEventId,
              dead.map((m) => m.gcalEventId),
            ),
          ),
        );
    }
  });

  return { imported: live.length, cancelled: dead.length };
}
