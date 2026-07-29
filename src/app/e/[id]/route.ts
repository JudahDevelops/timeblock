import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { events } from "@/db/schema";
import { calendarPath } from "@/lib/date";

export const runtime = "nodejs";

/**
 * Permalink for a block, redirecting to whichever day currently holds it.
 *
 * This exists because it is the link we write into Google's description. A
 * direct `/calendar/day/<date>?open=<id>` would go stale the moment the block
 * moved, and correcting it would mean re-pushing a description on every drag —
 * which is exactly the churn that makes `gcal_description_hash` cry wolf about
 * human edits.
 *
 * Gated like everything else, which is what makes it work from a phone that is
 * signed out: the proxy bounces to `/login?next=/e/<id>` and the auth callback
 * returns here afterwards, so the block you tapped in Google is still the block
 * you land on.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [event] = await db
    .select({ startsAt: events.startsAt })
    .from(events)
    .where(and(eq(events.id, id), isNull(events.deletedAt)))
    .limit(1);

  const url = event ? `${calendarPath("day", event.startsAt)}?open=${id}` : "/";
  return NextResponse.redirect(new URL(url, request.url));
}
