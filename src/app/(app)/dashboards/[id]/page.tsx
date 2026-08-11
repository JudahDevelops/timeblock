import { notFound } from "next/navigation";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import { SidebarTrigger } from "@/components/shell/app-shell";
import { requireUserId } from "@/server/auth";
import { getDashboardById } from "@/server/queries/dashboards";

export default async function DashboardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;

  const dashboard = await getDashboardById(userId, id);
  if (!dashboard) notFound();

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="border-line flex shrink-0 items-center gap-3 border-b px-4 py-3 sm:px-6 md:hidden">
        <SidebarTrigger />
        <span className="text-sm font-medium">Dashboards</span>
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* "Now" is resolved here rather than in the component: reading the clock
            during render is what `react-hooks/purity` rejects, and relative dates
            need one anyway. */}
        <DashboardView dashboard={dashboard} now={new Date()} />
      </div>
    </div>
  );
}
