"use client";

import { useKnownTab } from "./page-skeleton";

/**
 * A dashboard before its fields have arrived.
 *
 * Same bargain as `page-skeleton.tsx`: the name and icon are already known for
 * anything in the open-tabs strip, so they are painted rather than blocked out,
 * and only the field grid below them is a placeholder.
 */
export function DashboardSkeleton({ dashboardId }: { dashboardId: string }) {
  const known = useKnownTab(`/dashboards/${dashboardId}`);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Matches the real header in `dashboards/[id]/page.tsx`, which is mobile
          only — without it the grid below shifts up by a row on a phone. */}
      <header className="border-line flex shrink-0 items-center gap-3 border-b px-4 py-3 sm:px-6 md:hidden">
        <div className="bg-surface-raised size-8 animate-pulse rounded-md" />
        <span className="text-sm font-medium">Dashboards</span>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
          {/* The icon sits above the name here, not beside it, and is 4xl rather
              than a page's 78px — a dashboard opens into its grid, so the header
              stays small. Mirrors `dashboard-view.tsx`. */}
          <div className="mb-2 w-fit">
            {known ? (
              <div className="p-1 text-4xl leading-none">{known.emoji ?? "📊"}</div>
            ) : (
              <div className="bg-surface-raised m-1 size-9 animate-pulse rounded-lg" />
            )}
          </div>

          {known ? (
            <h1 className="text-ink text-2xl font-semibold tracking-tight">
              {known.title || "Untitled dashboard"}
            </h1>
          ) : (
            <div className="bg-surface-raised h-8 w-64 animate-pulse rounded-md" />
          )}

          {/* One full-width column below 640px and a half-width pair above it,
              because that is what replaces this: `FieldGrid` collapses to a
              single ordered column on a phone, and a new field opens at a third
              of the width on a desktop. `h-24` is 96px, which is what a field
              opens at — `DEFAULT_FIELD_H` rows of `CELL_HEIGHT + GAP`, less the
              trailing gap — so the fields land where their placeholders were
              rather than stepping down as they arrive. */}
          <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2" aria-hidden>
            {Array.from({ length: 6 }, (_, i) => (
              <div
                key={i}
                className="border-line bg-surface-raised h-24 animate-pulse rounded-lg border"
              />
            ))}
          </div>

          <span className="sr-only" role="status" data-skeleton="dashboard">
            Loading dashboard
          </span>
        </div>
      </div>
    </div>
  );
}
