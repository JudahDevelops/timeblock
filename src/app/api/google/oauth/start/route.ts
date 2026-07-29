import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { authorizeUrl } from "@/lib/google/auth";
import { requireUserId } from "@/server/auth";

export const runtime = "nodejs";

export const STATE_COOKIE = "google_oauth_state";

export async function GET() {
  // Proves a session exists before sending anyone to Google, so the callback
  // never has to deal with a grant it cannot attribute.
  await requireUserId();

  const state = randomBytes(32).toString("base64url");

  const response = NextResponse.redirect(authorizeUrl(state));
  // The callback compares this against the `state` Google echoes back, which is
  // what stops an attacker from having their own calendar linked to this account.
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Google's callback is a top-level cross-site redirect, so Strict would
    // withhold the cookie exactly when it is needed.
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return response;
}
