import { redirect } from "next/navigation";

import { Providers } from "@/app/providers";
import { AppShell } from "@/components/shell/app-shell";
import { ToastProvider } from "@/components/shell/toast";
import { toDateParam } from "@/lib/date";
import { requireUser, type SessionUser } from "@/server/auth";
import { getPages } from "@/server/queries/pages";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The proxy already gates this, but a Server Component must not assume it —
  // this is the boundary that actually guarantees a user below.
  let user: SessionUser;
  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }

  const pages = await getPages(user.id);

  return (
    <Providers>
      <ToastProvider>
        <AppShell
          email={user.email}
          todayParam={toDateParam(new Date())}
          pages={pages.map((p) => ({ id: p.id, title: p.title, emoji: p.emoji }))}
        >
          {children}
        </AppShell>
      </ToastProvider>
    </Providers>
  );
}
