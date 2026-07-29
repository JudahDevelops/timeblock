"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { calendarConnections, googleAccounts } from "@/db/schema";
import { requireUserId } from "@/server/auth";

/**
 * Drops a Google grant and everything that syncs through it.
 *
 * Deliberately leaves the imported `events` rows alone. Their bodies are the
 * documents the user wrote, which Google never held a copy of — deleting them
 * to tidy the grid would destroy the only place they exist. `event_links`
 * survives too, so reconnecting reconciles onto the same local rows rather
 * than importing a second copy of every meeting.
 */
export async function disconnectGoogle(connectionId: string) {
  const userId = await requireUserId();

  const [connection] = await db
    .select({ googleAccountId: calendarConnections.googleAccountId })
    .from(calendarConnections)
    .where(and(eq(calendarConnections.id, connectionId), eq(calendarConnections.userId, userId)))
    .limit(1);

  if (!connection) throw new Error("Connection not found");

  // The connection row cascades from the account, and the account is what
  // holds the refresh token — so this is the delete that actually revokes our
  // access rather than just hiding it.
  await db
    .delete(googleAccounts)
    .where(
      and(eq(googleAccounts.id, connection.googleAccountId), eq(googleAccounts.userId, userId)),
    );

  revalidatePath("/settings/calendars");
  revalidatePath("/calendar", "page");
}
