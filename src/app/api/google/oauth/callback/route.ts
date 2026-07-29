import { NextResponse } from "next/server";

import { db } from "@/db";
import { calendarConnections } from "@/db/schema";
import { secretsMatch } from "@/lib/crypto";
import { canWrite, exchangeCode, saveGrant } from "@/lib/google/auth";
import { ensureChannel } from "@/lib/sync/channels";
import { syncConnection } from "@/lib/sync/engine";
import { requireUserId } from "@/server/auth";

import { STATE_COOKIE } from "../start/route";

export const runtime = "nodejs";

/** The calendar every account has. Choosing among several is a later phase. */
const PRIMARY = "primary";

const SETTINGS = "/settings/calendars";

function back(request: Request, params: Record<string, string>) {
  const url = new URL(SETTINGS, request.url);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const userId = await requireUserId();
  const url = new URL(request.url);

  const error = url.searchParams.get("error");
  // The user pressed Cancel on Google's consent screen. Not a failure.
  if (error) return back(request, { error: error === "access_denied" ? "declined" : error });

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = request.headers
    .get("cookie")
    ?.split("; ")
    .find((c) => c.startsWith(`${STATE_COOKIE}=`))
    ?.slice(STATE_COOKIE.length + 1);

  if (!code || !state || !expected || !secretsMatch(state, expected)) {
    return back(request, { error: "state_mismatch" });
  }

  let connectionId: string;
  try {
    const tokens = await exchangeCode(code);
    const accountId = await saveGrant(userId, tokens);

    // Two gates, not one. The scope is what Google enforces; `direction` is
    // what this app enforces, and it is derived from the scope actually
    // granted rather than the one we asked for — a user can untick calendar
    // access on the consent screen and still complete the flow.
    const direction = canWrite(tokens.scopes) ? "both" : "read";

    // One row per calendar we follow. Reconnecting keeps the existing row so
    // its sync cursor survives; a second row would re-import everything.
    const [connection] = await db
      .insert(calendarConnections)
      .values({
        userId,
        googleAccountId: accountId,
        gcalCalendarId: PRIMARY,
        direction,
      })
      .onConflictDoUpdate({
        target: [calendarConnections.googleAccountId, calendarConnections.gcalCalendarId],
        // Re-consenting is how a read-only connection is upgraded to writing,
        // so this must move with the grant.
        set: { userId, direction },
      })
      .returning({ id: calendarConnections.id });

    connectionId = connection.id;
  } catch (cause) {
    console.error("Google OAuth callback failed", cause);
    return back(request, { error: "exchange_failed" });
  }

  const response = back(request, { connected: "1" });
  response.cookies.delete(STATE_COOKIE);

  // Synchronous on purpose: the settings page should already show the imported
  // count when it renders. A fresh connection has no token, so this is a full
  // sync — but reconnecting an existing one resumes incrementally, which is
  // what keeps the reconnect flow cheap.
  try {
    await syncConnection(connectionId);
  } catch (cause) {
    console.error("First sync failed", cause);
    return back(request, { error: "sync_failed" });
  }

  // Deliberately not guarded like the sync above. A channel is an optimisation
  // over the five-minute poll, so failing the whole connect because Google
  // would not accept a watch — which it never will from localhost — would be
  // out of all proportion. `ensureChannel` reports rather than throws.
  await ensureChannel(connectionId);

  return response;
}
