import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { calendarConnections } from "@/db/schema";
import { GoogleRevokedError } from "@/lib/google/auth";
import { syncConnection, type SyncOutcome } from "@/lib/sync/engine";
import { runPendingJobs } from "@/lib/sync/jobs";
import { pushPending, type PushResult } from "@/lib/sync/push";
import { isCronRequest, requireUserId } from "@/server/auth";

export const runtime = "nodejs";

type RunResult = SyncOutcome & { pushed: Record<PushResult, number> };

/**
 * Runs a sync for every connected calendar.
 *
 * Called by Vercel Cron every five minutes, which authenticates with a bearer
 * token and has no session — so this cannot use `requireUserId` and scopes by
 * connection row instead. Nearly every run is an empty incremental poll.
 */
export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Anything a webhook queued but could not finish. Drained first so a ping
  // that arrived seconds ago is not made to wait out this whole pass.
  const drained = await runPendingJobs();

  const connections = await db
    .select({ id: calendarConnections.id, userId: calendarConnections.userId })
    .from(calendarConnections);

  const results: Record<string, RunResult | { error: string }> = {};

  for (const connection of connections) {
    try {
      results[connection.id] = await runBoth(connection.id, connection.userId);
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

  return NextResponse.json({ ran: connections.length, drained, results });
}

/**
 * Push first, then pull.
 *
 * Order matters: a local edit that reached Google before the pull comes back
 * marked with our id and is skipped as an echo. The other way round, the pull
 * would report the pre-push state and briefly contradict what is on screen.
 */
async function runBoth(connectionId: string, userId: string): Promise<RunResult> {
  const pushed = await pushPending(userId);
  return { ...(await syncConnection(connectionId)), pushed };
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
    return NextResponse.json(await runBoth(connectionId, userId));
  } catch (cause) {
    if (cause instanceof GoogleRevokedError) {
      return NextResponse.json({ error: "revoked" }, { status: 409 });
    }
    console.error(`Manual sync failed for ${connectionId}`, cause);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
