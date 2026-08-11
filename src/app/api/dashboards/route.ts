import { NextResponse } from "next/server";

import { requireUserId } from "@/server/auth";
import { getDashboardsWithFields } from "@/server/queries/dashboards";

/** Shares the Postgres pool with the rest of the server; not edge-compatible. */
export const runtime = "nodejs";

/**
 * Every dashboard with its fields, for the pause menu.
 *
 * Deliberately not folded into `/api/status`: that one refetches every minute
 * because it answers a question about the clock, and dashboards would ride along
 * on a cadence that has nothing to do with them.
 */
export async function GET() {
  const userId = await requireUserId();
  const dashboards = await getDashboardsWithFields(userId);

  return NextResponse.json({ dashboards }, { headers: { "cache-control": "no-store" } });
}
