"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { publicEnv } from "@/env";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const searchParams = useSearchParams();
  const [pending, setPending] = useState(false);
  // Seeded from the callback route, which redirects here on provider failure.
  const [error, setError] = useState<string | null>(searchParams.get("error"));

  async function signIn() {
    setPending(true);
    setError(null);

    const next = searchParams.get("next") ?? "/";
    const callback = new URL("/auth/callback", publicEnv.appUrl);
    callback.searchParams.set("next", next);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      // Identity only. Calendar scopes are requested later by a separate
      // OAuth flow we control, because Supabase hands back the provider
      // refresh token once at sign-in and never persists it.
      options: { redirectTo: callback.toString() },
    });

    if (error) {
      setError(error.message);
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={signIn}
        disabled={pending}
        className="flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-zinc-200 bg-white text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-zinc-900"
      >
        <GoogleMark />
        {pending ? "Redirecting…" : "Continue with Google"}
      </button>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
