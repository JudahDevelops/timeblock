import { after, NextResponse } from "next/server";

import { readPing } from "@/lib/google/channel";
import { connectionForPing } from "@/lib/sync/channels";
import { enqueueSync, runPendingJobs } from "@/lib/sync/jobs";

export const runtime = "nodejs";

/**
 * Google's push notification for a watched calendar.
 *
 * The payload is an empty body carrying a handful of headers and no signature
 * of any kind, so `channel_token` is the whole of the authentication. `proxy.ts`
 * excludes this path from the session gate — a notification has no user, and
 * the auth middleware would bounce every one of them to /login.
 *
 * Recording the job and answering are the only work done before the response.
 * The sync itself runs in `after()`, which is what turns a Google-side edit
 * into an on-screen change in seconds instead of waiting out the poll — and if
 * that work never happens, the row is still queued for the cron.
 */
export async function POST(request: Request) {
  const ping = readPing(request.headers);
  if (!ping) return new NextResponse(null, { status: 400 });

  // The handshake Google sends the instant a channel opens. Nothing has
  // changed yet, and syncing on it would fire a pointless full pass on every
  // renewal.
  if (ping.state === "sync") return new NextResponse(null, { status: 200 });

  const connection = await connectionForPing(ping);
  if (!connection) {
    // A stale channel from a disconnected account, or someone who guessed the
    // URL. 404 tells Google this channel is dead so it stops delivering; there
    // is nothing to distinguish for a caller who should not be here.
    return new NextResponse(null, { status: 404 });
  }

  await enqueueSync(connection.id);

  after(async () => {
    try {
      await runPendingJobs();
    } catch (cause) {
      // Already durable. The cron will find it.
      console.error("Post-response sync failed", cause);
    }
  });

  return new NextResponse(null, { status: 200 });
}
