import "server-only";

import { and, count, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { calendarConnections, events, googleAccounts } from "@/db/schema";

export type ConnectionStatus = {
  connectionId: string;
  email: string;
  calendarId: string;
  revoked: boolean;
  lastFullSyncAt: Date | null;
  /** Null until the first incremental sync in Phase 6 mints one. */
  syncToken: string | null;
  importedCount: number;
};

/** The signed-in user's Google calendar connections, with what each has pulled in. */
export async function getConnections(userId: string): Promise<ConnectionStatus[]> {
  const rows = await db
    .select({
      connectionId: calendarConnections.id,
      calendarId: calendarConnections.gcalCalendarId,
      lastFullSyncAt: calendarConnections.lastFullSyncAt,
      syncToken: calendarConnections.syncToken,
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

  return rows.map((row) => ({
    connectionId: row.connectionId,
    email: row.email,
    calendarId: row.calendarId,
    revoked: row.revokedAt !== null,
    lastFullSyncAt: row.lastFullSyncAt,
    syncToken: row.syncToken,
    // Per user rather than per connection: only one calendar is syncable today,
    // and splitting the count would need a join through event_links for nothing.
    importedCount: imported,
  }));
}
