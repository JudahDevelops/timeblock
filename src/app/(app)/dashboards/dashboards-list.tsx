"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { SidebarTrigger } from "@/components/shell/app-shell";
import { useToast } from "@/components/shell/toast";
import { createDashboard } from "@/server/actions/dashboards";
import type { DashboardSummary } from "@/server/queries/dashboards";

export function DashboardsList({ dashboards }: { dashboards: DashboardSummary[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  const handleCreate = () => {
    startTransition(async () => {
      try {
        const row = await createDashboard({});
        router.push(`/dashboards/${row.id}`);
      } catch {
        toast("Could not create the dashboard.");
      }
    });
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="border-line flex shrink-0 items-center gap-3 border-b px-4 py-3 sm:px-6">
        <SidebarTrigger />
        <h1 className="text-lg font-semibold">Dashboards</h1>
        <button
          type="button"
          onClick={handleCreate}
          disabled={pending}
          className="bg-accent text-accent-ink ml-auto rounded-md px-3 py-1.5 text-sm font-medium transition-opacity disabled:opacity-50"
        >
          New dashboard
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {dashboards.length === 0 ? (
          <div className="text-ink-muted flex flex-col items-center justify-center gap-2 px-6 py-24 text-center">
            <svg
              viewBox="0 0 24 24"
              className="text-ink-faint size-10"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.25}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <rect x="3" y="3" width="7" height="9" rx="1" />
              <rect x="14" y="3" width="7" height="5" rx="1" />
              <rect x="14" y="12" width="7" height="9" rx="1" />
              <rect x="3" y="16" width="7" height="5" rx="1" />
            </svg>
            <p className="text-sm">No dashboards yet</p>
            <p className="text-ink-faint max-w-sm text-xs">
              A dashboard tracks whatever you want — money, training, the people you keep meaning to
              call. You choose the fields and what kind of thing each one holds.
            </p>
            <button
              type="button"
              onClick={handleCreate}
              disabled={pending}
              className="text-accent mt-1 text-sm underline underline-offset-4"
            >
              Create your first dashboard
            </button>
          </div>
        ) : (
          <ul className="divide-line divide-y">
            {dashboards.map((dashboard) => (
              <li key={dashboard.id}>
                <button
                  type="button"
                  onClick={() => router.push(`/dashboards/${dashboard.id}`)}
                  className="hover:bg-surface-sunken flex w-full items-center gap-3 px-4 py-3 text-left transition-colors sm:px-6"
                >
                  <span className="text-xl" aria-hidden>
                    {dashboard.emoji ?? "📊"}
                  </span>
                  <span className="text-ink min-w-0 flex-1 truncate text-sm font-medium">
                    {dashboard.name || "Untitled dashboard"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
