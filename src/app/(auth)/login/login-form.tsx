"use client";

import { useSearchParams } from "next/navigation";
import { useActionState, useState } from "react";

import { signInWithPassword, signUpWithPassword, type AuthFormState } from "@/server/actions/auth";

type Mode = "sign-in" | "sign-up";

const FIELD =
  "border-line bg-surface text-ink placeholder:text-ink-faint focus:border-accent h-11 w-full rounded-lg border px-3 text-sm outline-none transition-colors";

export function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";
  const [mode, setMode] = useState<Mode>("sign-in");

  // Seeded from the callback route, which redirects here when a confirmation
  // link has expired or was opened in a different browser.
  const initial: AuthFormState = { error: searchParams.get("error") ?? undefined };
  const [signInState, signIn, signingIn] = useActionState(signInWithPassword, initial);
  const [signUpState, signUp, signingUp] = useActionState(signUpWithPassword, {});

  const signingUpMode = mode === "sign-up";
  const state = signingUpMode ? signUpState : signInState;
  const pending = signingIn || signingUp;

  return (
    <>
      <form action={signingUpMode ? signUp : signIn} className="space-y-3">
        <input type="hidden" name="next" value={next} />
        <label className="block">
          <span className="text-ink-muted mb-1 block text-xs font-medium">Email</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={state.email}
            className={FIELD}
          />
        </label>
        <label className="block">
          <span className="text-ink-muted mb-1 block text-xs font-medium">Password</span>
          <input
            name="password"
            type="password"
            autoComplete={signingUpMode ? "new-password" : "current-password"}
            minLength={signingUpMode ? 8 : undefined}
            required
            className={FIELD}
          />
          {signingUpMode ? (
            <span className="text-ink-faint mt-1 block text-xs">At least 8 characters.</span>
          ) : null}
        </label>

        <button
          type="submit"
          disabled={pending}
          className="bg-accent text-accent-ink flex h-11 w-full items-center justify-center rounded-lg text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {signingUpMode
            ? signingUp
              ? "Creating account…"
              : "Create account"
            : signingIn
              ? "Signing in…"
              : "Sign in"}
        </button>
      </form>

      {state.error ? (
        <p role="alert" className="text-danger mt-3 text-sm">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p role="status" className="text-ok mt-3 text-sm">
          {state.notice}
        </p>
      ) : null}

      <p className="text-ink-muted mt-6 text-sm">
        {signingUpMode ? "Already have an account?" : "New to Timeblock?"}{" "}
        <button
          type="button"
          onClick={() => setMode(signingUpMode ? "sign-in" : "sign-up")}
          className="text-ink font-medium underline-offset-4 hover:underline"
        >
          {signingUpMode ? "Sign in" : "Create an account"}
        </button>
      </p>
    </>
  );
}
