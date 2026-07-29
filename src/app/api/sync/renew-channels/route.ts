import { NextResponse } from "next/server";

import { renewChannels } from "@/lib/sync/channels";
import { isCronRequest } from "@/server/auth";

export const runtime = "nodejs";

/**
 * Keeps push notifications alive. Hourly, from Vercel Cron.
 *
 * A calendar channel lasts at most seven days and cannot be extended, so
 * something has to keep opening new ones. Hourly against a one-day renewal
 * margin is deliberately generous: a lapsed channel does not fail, it goes
 * quiet, and a calendar that has silently stopped updating is far worse than a
 * few redundant runs.
 */
export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await renewChannels());
}
