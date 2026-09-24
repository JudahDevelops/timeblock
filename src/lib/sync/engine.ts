import "server-only";

import { and, eq, gt, inArray, isNotNull, isNull, lt, not, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  calendarConnections,
  eventLinks,
  events,
  syncConflicts,
  type EventLink,
} from "@/db/schema";
import { getAccessToken } from "@/lib/google/auth";
import {
  fullSyncParams,
  getCalendar,
  GoogleApiError,
  incrementalParams,
  listEvents,
  syncWindow,
  type SyncWindow,
} from "@/lib/google/client";
import { claimLocalId, isUuid } from "@/lib/sync/identity";
import { pendingWithdrawal } from "@/lib/sync/predicates";
import { conflictFields, reconcile } from "@/lib/sync/reconcile";
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
  /** Rows Google described that were unusable — no id, or no start. */
  skipped: number;
  /** Our own writes arriving back unchanged. Recognised and ignored. */
  echoed: number;
  /** Remote changes a newer local edit outranked. Queued to push again. */
  kept: number;
  /** Live in Google, tombstoned here. Left deleted rather than re-imported. */
  withdrawn: number;
  /** Resolutions where both sides had moved. One row each in `sync_conflicts`. */
  conflicts: number;
  /** Cancellations that were a calendar move, not a deletion. */
  moved: number;
  /** events whose identity belongs to another user; left alone rather than written */
  foreign: number;
  /** Rows the window no longer covers. See `pruneOutsideWindow`. */
  pruned: number;
  syncToken: string | null;
};

type PageOutcome = Omit<SyncOutcome, "mode" | "skipped" | "pruned" | "syncToken">;

const NOTHING: PageOutcome = {
  imported: 0,
  cancelled: 0,
  echoed: 0,
  kept: 0,
  withdrawn: 0,
  conflicts: 0,
  moved: 0,
  foreign: 0,
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

  const outcome: SyncOutcome = { mode, ...NOTHING, skipped: 0, pruned: 0, syncToken: null };

  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await listEvents(accessToken, connection.gcalCalendarId, params, pageToken);

    // Keyed by event id, not a list: a page may legitimately carry the same
    // id twice, and Postgres aborts a multi-row upsert that would "affect row
    // a second time". Last write wins, matching Google's own ordering.
    const batch = new Map<string, MappedEvent>();
    for (const item of result.items ?? []) {
      const mapped = mapGoogleEvent(item, calendarTz);
      if (!mapped) {
        outcome.skipped++;
        continue;
      }
      batch.set(mapped.gcalEventId, mapped);
    }

    const applied = await applyPage(connection, [...batch.values()]);
    for (const key of Object.keys(NOTHING) as (keyof PageOutcome)[]) {
      outcome[key] += applied[key];
    }

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
 * How long a deleted block stays recoverable.
 *
 * Long enough that a full resync — the thing that would otherwise resurrect a
 * deletion Google has already forgotten — cannot possibly still be carrying
 * the old copy.
 */
const TOMBSTONE_DAYS = 30;

/**
 * Removes deletions that are old enough to be settled.
 *
 * The tombstone is the whole reason a deletion is safe: a 410 full resync sees
 * the row, matches it through `event_links`, and leaves it deleted instead of
 * importing it fresh. Once nothing can plausibly still be describing that
 * event, the row is only clutter — and `event_links` cascades away with it.
 *
 * It will not touch a row with a body. A block someone wrote in and then
 * deleted a month ago is still the only copy of that writing, and a tidy table
 * is not worth it.
 */
export async function purgeTombstones(userId: string, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - TOMBSTONE_DAYS * 86_400_000);

  const purged = await db
    .delete(events)
    .where(
      and(
        eq(events.userId, userId),
        eq(events.bodyRev, 0),
        isNotNull(events.deletedAt),
        lt(events.deletedAt, cutoff),
        not(pendingWithdrawal),
      ),
    )
    .returning({ id: events.id });

  return purged.length;
}

/**
 * Writes one page of mapped events.
 *
 * Per page, not per event, and that is the whole design. Supabase sits ~270ms
 * away, so the obvious row-at-a-time loop cost three round trips each and took
 * two and a half minutes on a 322-event calendar. This is four round trips for
 * the entire page regardless of its size.
 *
 * Identity is decided by `event_links` first, then by our own id riding in the
 * event's extended properties — never by a title or time match. The link is
 * also what protects block bodies: the upsert below lists the columns Google
 * owns and no others, so `body`, `body_text` and `body_rev` survive every
 * resync untouched.
 */
async function applyPage(connection: Connection, mapped: MappedEvent[]): Promise<PageOutcome> {
  if (mapped.length === 0) return { ...NOTHING };

  // Deliberately not filtered to this calendar. A link to the same Google id
  // under a *different* calendar is the signature of a move, which Google
  // reports as two unrelated facts — cancelled over here, created over there —
  // and never as a move.
  const links = await db
    .select()
    .from(eventLinks)
    .where(
      inArray(
        eventLinks.gcalEventId,
        mapped.map((m) => m.gcalEventId),
      ),
    );

  const here = new Map<string, EventLink>();
  const elsewhere = new Map<string, EventLink>();
  for (const link of links) {
    if (link.gcalCalendarId === connection.gcalCalendarId) {
      here.set(link.gcalEventId, link);
      continue;
    }
    // A live link outranks a retired one: if the event has bounced between
    // calendars, only the calendar still holding it settles the question.
    const held = elsewhere.get(link.gcalEventId);
    if (!held || (held.deletedAt && !link.deletedAt)) elsewhere.set(link.gcalEventId, link);
  }

  /**
   * The local row this Google event belongs to, if any.
   *
   * The last fallback matters more than it looks: a push that inserted into
   * Google and then died before writing the link leaves an event that only
   * `tb_event_id` can identify. Without it the next sync imports a second copy
   * of a block that already exists, with an empty body.
   */
  const localIdFor = (m: MappedEvent): string | null =>
    here.get(m.gcalEventId)?.localEventId ??
    elsewhere.get(m.gcalEventId)?.localEventId ??
    (m.tbEventId && isUuid(m.tbEventId) ? m.tbEventId : null);

  const candidates = [...new Set(mapped.map(localIdFor).filter((id): id is string => id !== null))];
  const localRows = candidates.length
    ? await db
        .select({
          id: events.id,
          userId: events.userId,
          origin: events.origin,
          title: events.title,
          startsAt: events.startsAt,
          endsAt: events.endsAt,
          updatedAt: events.updatedAt,
          deletedAt: events.deletedAt,
        })
        .from(events)
        // Deliberately unscoped by user: the only way to know a candidate id
        // is someone else's is to see who owns it, which `claimLocalId`
        // reads. The write further down is what stays scoped.
        .where(inArray(events.id, candidates))
    : [];
  const rows = new Map(localRows.map((row) => [row.id, row]));

  const now = new Date();
  const outcome: PageOutcome = { ...NOTHING };

  const write: Array<{ m: MappedEvent; id: string }> = [];
  const relink: Array<{ m: MappedEvent; id: string }> = [];
  const dead: Array<{ m: MappedEvent; id: string }> = [];
  const movedOut: MappedEvent[] = [];
  const conflicts: (typeof syncConflicts.$inferInsert)[] = [];

  for (const m of mapped) {
    const claim = claimLocalId(localIdFor(m), rows, connection.userId);
    if (claim.kind === "foreign") {
      outcome.foreign++;
      continue;
    }
    const local = claim.kind === "owned" ? claim.row : null;
    const id = local?.id ?? null;

    if (m.cancelled) {
      // A cancellation for something we never imported is not a deletion, it
      // is noise — Google reports them for the whole window on a full sync.
      //
      // Nor is one for a row already tombstoned. Re-stamping `deleted_at` on
      // every full sync would keep pushing the tombstone's own clock forward,
      // and it would never reach the age at which `purgeTombstones` clears it.
      if (!id || !local || local.deletedAt) continue;
      const other = elsewhere.get(m.gcalEventId);
      if (other && !other.deletedAt) {
        // Still live in another calendar we sync. The user moved it; the block
        // and its body belong to that calendar now, so only the link retires.
        movedOut.push(m);
        outcome.moved++;
        continue;
      }
      dead.push({ m, id });
      outcome.cancelled++;
      continue;
    }

    const remote = {
      etag: m.etag,
      updated: m.updated,
      title: m.title,
      startsAt: m.startsAt,
      endsAt: m.endsAt,
    };
    const { verdict, conflicted } = reconcile(here.get(m.gcalEventId) ?? null, local, remote);

    if (conflicted && local) {
      for (const field of conflictFields(local, remote)) {
        conflicts.push({
          userId: connection.userId,
          localEventId: local.id,
          resolvedAs: verdict === "apply" ? "remote" : "local",
          at: now,
          ...field,
        });
      }
    }

    if (verdict === "echo") {
      outcome.echoed++;
      continue;
    }
    if (verdict === "keep") {
      relink.push({ m, id: local!.id });
      outcome.kept++;
      continue;
    }
    // Deleted here and still live in Google. Deliberately not relinked either:
    // the row is left exactly as it stands so `pushPending` keeps seeing an
    // unsent withdrawal and retries it, which is what eventually removes the
    // event over there.
    if (verdict === "withdraw") {
      outcome.withdrawn++;
      continue;
    }

    write.push({ m, id: id ?? crypto.randomUUID() });
    outcome.imported++;
  }

  const live = write.map((w) => w.m);

  // One transaction per page. An event row without its link is invisible to
  // every future sync — nothing can ever match it again, so the next run
  // imports a second copy. Two interrupted connects left exactly that behind
  // while these were separate statements.
  await db.transaction(async (tx) => {
    if (live.length > 0) {
      // Ids are minted here rather than read back from `RETURNING`, which is
      // what lets the events and their links go out as two statements instead
      // of one per row.
      const rows = write.map(({ m, id }) => ({
        id,
        userId: connection.userId,
        // Only ever consulted on insert — the upsert below leaves `origin`
        // alone — but getting it wrong on a block whose link was lost would
        // mark it Google's and stop it ever being pushed again.
        origin: m.tbEventId ? ("local" as const) : ("google" as const),
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
          // Belt and braces: even if identity resolution above regressed,
          // Postgres itself refuses to let this upsert rewrite a row owned by
          // someone else.
          setWhere: sql`${events.userId} = excluded.user_id`,
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
            // This row now matches Google exactly. Leaving `last_pushed_at`
            // behind the `updated_at` just written would make the sweep PATCH
            // Google right back with what Google just sent.
            lastPushedAt: now,
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
            lastPushedAt: sql`excluded.last_pushed_at`,
            deletedAt: sql`null`,
          },
        });
    }

    if (relink.length > 0) {
      // Ours won, so the row itself is untouched — but the link has to record
      // what Google is currently holding, or the next run reads the same
      // change as new and re-decides it forever. Clearing `last_pushed_at` is
      // what actually resolves the disagreement: it is the flag `pushPending`
      // reads, and without it our version would sit here being right and never
      // reach Google.
      await tx
        .insert(eventLinks)
        .values(
          relink.map(({ m, id }) => ({
            gcalCalendarId: connection.gcalCalendarId,
            gcalEventId: m.gcalEventId,
            localEventId: id,
            gcalEtag: m.etag,
            gcalUpdated: m.updated,
            lastPulledAt: now,
            lastPushedAt: null,
            deletedAt: null,
          })),
        )
        .onConflictDoUpdate({
          target: [eventLinks.gcalCalendarId, eventLinks.gcalEventId],
          set: {
            gcalEtag: sql`excluded.gcal_etag`,
            gcalUpdated: sql`excluded.gcal_updated`,
            lastPulledAt: sql`excluded.last_pulled_at`,
            lastPushedAt: sql`null`,
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
            dead.map(({ id }) => id),
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
              dead.map(({ m }) => m.gcalEventId),
            ),
          ),
        );
    }

    if (movedOut.length > 0) {
      // The event row is pointedly left alone. This calendar has stopped
      // carrying it, which is not the same as the user having thrown it away.
      await tx
        .update(eventLinks)
        .set({ deletedAt: now, lastPulledAt: now })
        .where(
          and(
            eq(eventLinks.gcalCalendarId, connection.gcalCalendarId),
            inArray(
              eventLinks.gcalEventId,
              movedOut.map((m) => m.gcalEventId),
            ),
          ),
        );
    }

    // Last, and inside the transaction: a conflict record that outlived the
    // resolution it describes would be a lie about what this app did.
    if (conflicts.length > 0) await tx.insert(syncConflicts).values(conflicts);
  });

  outcome.conflicts = conflicts.length;
  return outcome;
}
