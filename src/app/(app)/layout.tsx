import Link from "next/link";
import { redirect } from "next/navigation";

import { Providers } from "@/app/providers";
import { requireUser, type SessionUser } from "@/server/auth";
import { UserMenu } from "@/components/shell/user-menu";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The proxy already gates this, but a Server Component must not assume it —
  // this is the boundary that actually guarantees a user below.
  let user: SessionUser;
  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }

  return (
    <Providers>
      <div className="flex flex-1 overflow-hidden">
        <aside className="hidden w-56 shrink-0 flex-col justify-between border-r border-zinc-200 p-4 md:flex dark:border-zinc-800">
          <div>
            <span className="text-sm font-semibold tracking-tight">Timeblock</span>
            {/* Phase 1.1 fills this rail with the mini-month and search. */}
          </div>
          <div className="space-y-3">
            <Link
              href="/settings/calendars"
              className="block text-xs text-zinc-500 underline-offset-4 transition-colors hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
            >
              Calendars
            </Link>
            <UserMenu email={user.email} />
          </div>
        </aside>

        {/* `min-h-0` is load-bearing: without it a flex child refuses to shrink
            below its content height, so the grid's inner scroll never engages. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </Providers>
  );
}
