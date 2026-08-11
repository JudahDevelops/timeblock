"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import type { DashboardDetail } from "@/server/queries/dashboards";

const KEY = ["dashboards"];

/**
 * Dashboards for the pause menu.
 *
 * `enabled` is the point: the menu is a surface you enter rather than live in, so
 * nothing is fetched until it is opened for the first time. After that the data
 * stays cached — a dashboard changes when the user edits it, not on a timer.
 */
export function useDashboards(enabled: boolean) {
  return useQuery<DashboardDetail[]>({
    queryKey: KEY,
    enabled,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/dashboards", { signal });
      if (!response.ok) throw new Error("dashboards_failed");
      const body = (await response.json()) as { dashboards: DashboardDetail[] };
      return body.dashboards;
    },
    staleTime: 30_000,
  });
}

/**
 * Marks the menu's copy stale after an edit on the dashboard page.
 *
 * The two surfaces read the same rows through different paths — the page through
 * a Server Component, the menu through this query — so `revalidatePath` alone
 * refreshes one and leaves the other showing the old number until it ages out.
 */
export function useInvalidateDashboards(): () => void {
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: KEY });
  }, [client]);
}
