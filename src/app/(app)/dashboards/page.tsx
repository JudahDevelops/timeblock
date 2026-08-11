import { redirect } from "next/navigation";

import { requireUserId } from "@/server/auth";
import { getDashboards } from "@/server/queries/dashboards";

import { DashboardsList } from "./dashboards-list";

export default async function DashboardsPage() {
  const userId = await requireUserId();
  const dashboards = await getDashboards(userId);

  // With exactly one dashboard the index is a list of one, which is a click
  // between the user and the thing they came for.
  if (dashboards.length === 1) redirect(`/dashboards/${dashboards[0].id}`);

  return <DashboardsList dashboards={dashboards} />;
}
