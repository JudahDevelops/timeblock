import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in user's id, or throws.
 *
 * Every query and mutation scopes on this rather than trusting a client-sent
 * id. RLS is the backstop, not the primary control.
 */
export async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");
  return user.id;
}
