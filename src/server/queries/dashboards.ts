import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { dashboardFields, dashboards, type DashboardFieldRow } from "@/db/schema";
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

/**
 * One dashboard with its fields, in a single round trip's worth of waiting.
 *
 * The two reads are issued together rather than in sequence. The field query
 * looks nothing up from the first result — it filters on `dashboardId` and
 * `userId`, both known before either runs — so awaiting the dashboard row first
 * bought nothing and cost a second ~270ms trip to Supabase on every open.
 *
 * Fields for a dashboard that turns out not to exist are simply discarded, and
 * cost nothing: the query returns no rows.
 */
export async function getDashboardById(
  userId: string,
  id: string,
): Promise<DashboardDetail | null> {
  const [rows, fields] = await Promise.all([
    db
      .select({
        id: dashboards.id,
        name: dashboards.name,
        emoji: dashboards.emoji,
        position: dashboards.position,
      })
      .from(dashboards)
      .where(
        and(eq(dashboards.id, id), eq(dashboards.userId, userId), isNull(dashboards.deletedAt)),
      )
      .limit(1),
    getFields(userId, id),
  ]);

  const [dashboard] = rows;
  if (!dashboard) return null;

  return { ...dashboard, fields };
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

  const byDashboard = new Map<string, typeof rows>();
  for (const row of rows) {
    const existing = byDashboard.get(row.dashboardId);
    if (existing) existing.push(row);
    else byDashboard.set(row.dashboardId, [row]);
  }

  return summaries.map((summary) => ({
    ...summary,
    // Nested per dashboard rather than across the whole set, so a `parentId`
    // pointing at another dashboard's field cannot pull a row across.
    fields: nestFields(byDashboard.get(summary.id) ?? []),
  }));
}

async function getFields(userId: string, dashboardId: string): Promise<DashboardField[]> {
  const rows = await db
    .select()
    .from(dashboardFields)
    .where(and(eq(dashboardFields.dashboardId, dashboardId), eq(dashboardFields.userId, userId)))
    .orderBy(asc(dashboardFields.position), asc(dashboardFields.createdAt));

  return nestFields(rows);
}

/**
 * Turns one dashboard's flat rows into top-level fields carrying their children.
 *
 * Done here rather than with a recursive query because the tree is only ever two
 * ranks tall: one pass to parse, one to attach. A child whose parent is missing
 * from the set — deleted underneath us, or pointing at another dashboard — is
 * promoted to the top level rather than dropped, so a field can never become
 * invisible while its row still exists.
 */
function nestFields(rows: DashboardFieldRow[]): DashboardField[] {
  const parsed = rows
    .map(parseField)
    // A row whose `kind` this build does not know is skipped rather than thrown
    // on, so a dashboard written by a newer version still renders what it can.
    .filter((field): field is DashboardField => field !== null);

  const byId = new Map(parsed.map((field) => [field.id, field]));
  const top: DashboardField[] = [];

  for (const field of parsed) {
    const parent = field.parentId ? byId.get(field.parentId) : undefined;
    // Only a group may hold anything. A parent of any other kind means a stale
    // pointer — the kind was changed underneath the child — and the child is
    // better shown at the top level than not at all.
    if (parent && parent.kind === "group" && parent.id !== field.id) parent.children.push(field);
    else top.push(field);
  }

  return top;
}
