import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

export type SessionUser = { id: string; email: string };

/**
 * The signed-in user, or throws.
 *
 * `getClaims()` verifies the JWT signature locally against the project's
 * published keys rather than calling the auth server, which is what makes this
 * cheap enough to call from every query and action. Claims stay trusted until
 * the token expires, so a mutation that must react instantly to a revoked
 * account should call `getUser()` directly instead.
 *
 * Wrapped in `cache()` so the layout, the page and any actions in one request
 * share a single verification.
 */
export const requireUser = cache(async (): Promise<SessionUser> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  const id = data?.claims?.sub;
  if (!id) throw new Error("Not authenticated");

  return { id, email: data.claims.email ?? "" };
});

/**
 * The signed-in user's id, or throws.
 *
 * Every query and mutation scopes on this rather than trusting a client-sent
 * id. RLS is the backstop, not the primary control.
 */
export async function requireUserId(): Promise<string> {
  return (await requireUser()).id;
}
