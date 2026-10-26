"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { safeNext } from "@/lib/auth/safe-next";
import { createClient } from "@/lib/supabase/server";

/** Supabase's own floor is 6; this is the one the form advertises. */
const MIN_PASSWORD_LENGTH = 8;

export type AuthFormState = { error?: string; notice?: string; email?: string };

function readCredentials(formData: FormData) {
  return {
    email: String(formData.get("email") ?? "")
      .trim()
      .toLowerCase(),
    password: String(formData.get("password") ?? ""),
    next: safeNext(formData.get("next") as string | null),
  };
}

export async function signInWithPassword(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const { email, password, next } = readCredentials(formData);
  if (!email || !password) return { error: "Enter your email and password.", email };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Supabase answers a wrong password and an unknown email identically, on
    // purpose, so the message here cannot be any more specific than its own.
    return { error: error.message, email };
  }

  redirect(next);
}

export async function signUpWithPassword(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const { email, password, next } = readCredentials(formData);
  if (!email || !password) return { error: "Enter an email and a password.", email };
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`, email };
  }

  // The origin we are actually being viewed on, so a sign-up on localhost gets
  // a confirmation link back to localhost rather than to the deployed app.
  const origin = (await headers()).get("origin") ?? "";
  const callback = new URL("/auth/callback", origin || "http://localhost:3000");
  callback.searchParams.set("next", next);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: callback.toString() },
  });
  if (error) return { error: error.message, email };

  // With "Confirm email" off in Supabase, sign-up returns a live session and
  // there is nothing left to do. With it on, the session waits on the link.
  if (data.session) redirect(next);

  return {
    notice: `We sent a confirmation link to ${email}. Open it to finish creating your account.`,
    email,
  };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
