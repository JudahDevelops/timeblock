import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { publicEnv } from "@/env";

/** Paths reachable while signed out. Everything else redirects to /login. */
const PUBLIC_PREFIXES = ["/login", "/auth"];

/**
 * Routes that authenticate themselves, so the gate below must let them past.
 *
 * `/api/sync` is a scheduler target: it arrives with a bearer token and no
 * session at all, so gating it would 401 every scheduled run. Its GET checks
 * the cron secret; its POST still calls `requireUserId()`.
 */
const SELF_AUTHENTICATED_PREFIXES = ["/api/sync"];

function isPublic(pathname: string): boolean {
  return [...PUBLIC_PREFIXES, ...SELF_AUTHENTICATED_PREFIXES].some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/**
 * Refreshes the Supabase session cookie and gates private routes.
 *
 * The response object is rebuilt after `setAll` rather than mutated, because
 * refreshed auth cookies must land on the response that is actually returned —
 * dropping them signs the user out on the next navigation.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getClaims(), not getSession(): it verifies the JWT signature against the
  // project's published keys, so a forged cookie is rejected. Unlike getUser()
  // that check is local — auth-js caches the JWKS process-wide — which matters
  // when the auth server is a continent away and this runs on every request.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  const { pathname } = request.nextUrl;

  if (!signedIn && !isPublic(pathname)) {
    // An autosave has nowhere to put a login page. It needs a status it can
    // branch on, not 302 followed by a body of HTML that fails to parse.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    // Preserve where they were headed so callback can return them there.
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (signedIn && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
