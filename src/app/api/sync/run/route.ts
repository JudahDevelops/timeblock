import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { calendarConnections } from "@/db/schema";
import { secretsMatch } from "@/lib/crypto";
import { serverEnv } from "@/env";
import { GoogleRevokedError } from "@/lib/google/auth";
import { fullSync, type SyncOutcome } from "@/lib/sync/engine";
import { requireUserId } from "@/server/auth";

export const runtime = "nodejs";

/**
 * Runs a sync for every connected calendar.
 *
 * Called by Vercel Cron, which authenticates with a bearer token and has no
 * session — so this cannot use `requireUserId` and scopes by connection row
 * instead. Phase 6 turns this into the incremental path.
 */
export async function GET(request: Request) {
  const provided = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secretsMatch(provided, serverEnv.cronSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const connections = await db.select({ id: calendarConnections.id }).from(calendarConnections);

  const results: Record<string, SyncOutcome | { error: string }> = {};

  for (const connection of connections) {
    try {
      results[connection.id] = await fullSync(connection.id);
    } catch (cause) {
      // One dead connection must not stop the others. A revoked grant is
      // expected and already recorded on the account; anything else is a bug.
      if (cause instanceof GoogleRevokedError) {
        results[connection.id] = { error: "revoked" };
      } else {
        console.error(`Sync failed for connection ${connection.id}`, cause);
        results[connection.id] = { error: "failed" };
      }
    }
  }

  return NextResponse.json({ ran: connections.length, results });
}

/** Manual "Sync now" from the settings page, scoped to the signed-in user. */
export async function POST(request: Request) {
  // The proxy waves this path through so cron can reach the GET above, which
  // means this is the only thing standing between a stranger and a sync.
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { connectionId } = (await request.json()) as { connectionId?: string };
  if (!connectionId) return NextResponse.json({ error: "missing_connection" }, { status: 400 });

  const [connection] = await db
    .select({ id: calendarConnections.id, userId: calendarConnections.userId })
    .from(calendarConnections)
    .where(eq(calendarConnections.id, connectionId))
    .limit(1);

  if (!connection || connection.userId !== userId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    return NextResponse.json(await fullSync(connectionId));
  } catch (cause) {
    if (cause instanceof GoogleRevokedError) {
      return NextResponse.json({ error: "revoked" }, { status: 409 });
    }
    console.error(`Manual sync failed for ${connectionId}`, cause);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
