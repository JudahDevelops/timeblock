import { NextResponse } from "next/server";

import { resolveStatus } from "@/lib/status/resolve";
import { requireUserId } from "@/server/auth";
import { getStatusEvents } from "@/server/queries/status";

/** Shares the Postgres pool with the rest of the server; not edge-compatible. */
export const runtime = "nodejs";

/**
 * The resolved status view for a moment in the viewer's day.
 *
 * `now` arrives from the client rather than being read here, for the same reason
 * the now-indicator resolves it client-side: the server has no idea which
 * timezone the viewer is sitting in, and "which block am I in" is a question
 * about their local clock. The day window is derived from that same instant, so
 * a viewer six hours ahead gets their day and not the server's.
 */
export async function GET(request: Request) {
  const userId = await requireUserId();

  const nowParam = new URL(request.url).searchParams.get("now");
  const now = nowParam ? new Date(nowParam) : new Date();
  if (Number.isNaN(now.getTime())) {
    return NextResponse.json({ error: "invalid_now" }, { status: 400 });
  }

  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);

  const events = await getStatusEvents(userId, from, to);

  // Never cached: this is a question about the current minute, and a stale
  // answer is worse than no answer.
  return NextResponse.json(resolveStatus(events, now), {
    headers: { "cache-control": "no-store" },
  });
}
