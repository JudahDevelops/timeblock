import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { events } from "@/db/schema";
import { calendarPath } from "@/lib/date";
import { requireUserId } from "@/server/auth";

export const runtime = "nodejs";

/**
 * Permalink for a block, redirecting to whichever day currently holds it.
 *
 * A direct `/calendar/day/<date>?open=<id>` would go stale the moment the
 * block moved; this one never does.
 *
 * Gated like everything else, which is what makes it work signed out: the proxy
 * bounces to `/login?next=/e/<id>` and sign-in returns here afterwards.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const [event] = await db
    .select({ startsAt: events.startsAt })
    .from(events)
    // Scoped to the owner, so a guessed id is indistinguishable from a deleted
    // one. Without this the redirect target itself discloses the day someone
    // else's block sits on.
    .where(and(eq(events.id, id), eq(events.userId, userId), isNull(events.deletedAt)))
    .limit(1);

  const url = event ? `${calendarPath("day", event.startsAt)}?open=${id}` : "/";
  return NextResponse.redirect(new URL(url, request.url));
}
