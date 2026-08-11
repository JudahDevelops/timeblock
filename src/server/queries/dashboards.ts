import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { dashboardFields, dashboards } from "@/db/schema";
import { parseField, type DashboardField } from "@/lib/dashboard/field";

export type DashboardSummary = {
  id: string;
  name: string;
  emoji: string | null;
  position: number;
};

export type DashboardDetail = DashboardSummary & {
  fields: DashboardField[];
};

export async function getDashboards(userId: string): Promise<DashboardSummary[]> {
  return db
    .select({
      id: dashboards.id,
      name: dashboards.name,
      emoji: dashboards.emoji,
      position: dashboards.position,
    })
    .from(dashboards)
    .where(and(eq(dashboards.userId, userId), isNull(dashboards.deletedAt)))
    .orderBy(asc(dashboards.position), asc(dashboards.createdAt));
}

export async function getDashboardById(
  userId: string,
  id: string,
): Promise<DashboardDetail | null> {
  const [dashboard] = await db
    .select({
      id: dashboards.id,
      name: dashboards.name,
      emoji: dashboards.emoji,
      position: dashboards.position,
    })
    .from(dashboards)
    .where(and(eq(dashboards.id, id), eq(dashboards.userId, userId), isNull(dashboards.deletedAt)))
    .limit(1);

  if (!dashboard) return null;

  return { ...dashboard, fields: await getFields(userId, id) };
}

/**
 * Every dashboard with its fields, in one round trip per table.
 *
 * Two queries and a group rather than a query per dashboard: Supabase is ~270ms
 * away, so a handful of dashboards would otherwise cost most of a second before
 * anything rendered.
 */
export async function getDashboardsWithFields(userId: string): Promise<DashboardDetail[]> {
  const summaries = await getDashboards(userId);
  if (summaries.length === 0) return [];

  const rows = await db
    .select()
    .from(dashboardFields)
    .where(eq(dashboardFields.userId, userId))
    .orderBy(asc(dashboardFields.position), asc(dashboardFields.createdAt));

  const byDashboard = new Map<string, DashboardField[]>();
  for (const row of rows) {
    const field = parseField(row);
    // A row whose `kind` this build does not know is skipped rather than thrown
    // on, so a dashboard written by a newer version still renders what it can.
    if (!field) continue;

    const existing = byDashboard.get(row.dashboardId);
    if (existing) existing.push(field);
    else byDashboard.set(row.dashboardId, [field]);
  }

  return summaries.map((summary) => ({
    ...summary,
    fields: byDashboard.get(summary.id) ?? [],
  }));
}

async function getFields(userId: string, dashboardId: string): Promise<DashboardField[]> {
  const rows = await db
    .select()
    .from(dashboardFields)
    .where(and(eq(dashboardFields.dashboardId, dashboardId), eq(dashboardFields.userId, userId)))
    .orderBy(asc(dashboardFields.position), asc(dashboardFields.createdAt));

  return rows.map(parseField).filter((field): field is DashboardField => field !== null);
}
