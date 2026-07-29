import { Suspense } from "react";

import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · Timeblock" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Timeblock</h1>
        <p className="mt-2 text-sm text-zinc-500">
          A calendar where every block of time is a page you work inside.
        </p>

        <div className="mt-8">
          <Suspense fallback={<div className="h-11 rounded-lg bg-zinc-100 dark:bg-zinc-900" />}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
