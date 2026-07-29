import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

/** Next 16's replacement for the deprecated `middleware.ts` convention. */
export default async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /**
     * Everything except static assets and images.
     *
     * `/api/google/webhook` is excluded deliberately: Google's push
     * notifications carry no user session, and running them through the auth
     * gate would bounce every ping to /login.
     *
     * So is the manifest. Safari fetches it while deciding whether a site can
     * be installed — from the login page, and without credentials — so gating
     * it hands back an HTML redirect where a manifest should be, and the home
     * screen gets a bookmark that opens in a browser instead of an app.
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|api/google/webhook|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
