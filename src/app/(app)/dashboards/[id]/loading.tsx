"use client";

import { useParams } from "next/navigation";

import { DashboardSkeleton } from "@/components/shell/dashboard-skeleton";

/** See `pages/[id]/loading.tsx`. */
export default function Loading() {
  const params = useParams<{ id: string }>();
  return <DashboardSkeleton dashboardId={params.id} />;
}
