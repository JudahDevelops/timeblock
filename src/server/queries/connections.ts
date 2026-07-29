import "server-only";

import { and, count, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { calendarConnections, events, googleAccounts } from "@/db/schema";
import { isInboundStale, isWatchLive } from "@/lib/google/channel";

export type ConnectionStatus = {
  connectionId: string;
  email: string;
  calendarId: string;
  revoked: boolean;
  /**
   * The last run that reached Google at all, incremental or not — which is what
   * "synced 2 minutes ago" has to mean. `last_full_sync_at` only moves on a
   * full window, so once incremental syncing takes over it would freeze and
   * make a healthy connection look abandoned.
   */
  lastSyncedAt: Date | null;
  /** Absent means the next run re-reads the whole window. */
  hasSyncToken: boolean;
  /** A live push channel, so Google-side edits arrive in seconds not minutes. */
  live: boolean;
  /** Inbound sync has gone quiet for long enough that something is wrong. */
  stale: boolean;
  importedCount: number;
};

/** The signed-in user's Google calendar connections, with what each has pulled in. */
export async function getConnections(userId: string): Promise<ConnectionStatus[]> {
  const rows = await db
    .select({
      connectionId: calendarConnections.id,
      calendarId: calendarConnections.gcalCalendarId,
      lastInboundOkAt: calendarConnections.lastInboundOkAt,
      syncToken: calendarConnections.syncToken,
      channelExpiration: calendarConnections.channelExpiration,
      email: googleAccounts.email,
      revokedAt: googleAccounts.revokedAt,
    })
    .from(calendarConnections)
    .innerJoin(googleAccounts, eq(calendarConnections.googleAccountId, googleAccounts.id))
    .where(eq(calendarConnections.userId, userId));

  if (rows.length === 0) return [];

  const [{ imported }] = await db
    .select({ imported: count() })
    .from(events)
    .where(and(eq(events.userId, userId), eq(events.origin, "google"), isNull(events.deletedAt)));

  const now = new Date();

  return rows.map((row) => ({
    connectionId: row.connectionId,
    email: row.email,
    calendarId: row.calendarId,
    revoked: row.revokedAt !== null,
    lastSyncedAt: row.lastInboundOkAt,
    hasSyncToken: row.syncToken !== null,
    live: isWatchLive(row.channelExpiration, now),
    // A revoked grant already says why nothing is arriving, and two warnings
    // for one cause reads like two problems.
    stale: !row.revokedAt && isInboundStale(row.lastInboundOkAt, now),
    // Per user rather than per connection: only one calendar is syncable today,
    // and splitting the count would need a join through event_links for nothing.
    importedCount: imported,
  }));
}
