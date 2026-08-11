"use server";

import { and, eq, isNull, max, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { dashboardFields, dashboards } from "@/db/schema";
import {
  coerceConfig,
  coerceValue,
  defaultsFor,
  isFieldKind,
  MAX_LABEL_LENGTH,
} from "@/lib/dashboard/field";
import { requireUserId } from "@/server/auth";

const MAX_NAME_LENGTH = 120;

/** Both surfaces read dashboards, so both are stale after any write. */
function revalidateDashboards() {
  revalidatePath("/dashboards", "layout");
  revalidatePath("/calendar", "page");
}

export async function createDashboard(input: { name?: string; emoji?: string } = {}) {
  const userId = await requireUserId();

  // New dashboards land at the end rather than the front: the tab order is the
  // user's, and inserting at 0 would silently reshuffle it on every create.
  const [{ value: highest } = { value: null }] = await db
    .select({ value: max(dashboards.position) })
    .from(dashboards)
    .where(and(eq(dashboards.userId, userId), isNull(dashboards.deletedAt)));

  const [row] = await db
    .insert(dashboards)
    .values({
      userId,
      name: (input.name ?? "").slice(0, MAX_NAME_LENGTH),
      emoji: input.emoji ?? null,
      position: (highest ?? -1) + 1,
    })
    .returning({ id: dashboards.id });

  revalidateDashboards();
  return row;
}

export async function updateDashboard(input: { id: string; name?: string; emoji?: string | null }) {
  const userId = await requireUserId();

  const patch: { name?: string; emoji?: string | null; updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined) patch.name = input.name.slice(0, MAX_NAME_LENGTH);
  if (input.emoji !== undefined) patch.emoji = input.emoji;

  const updated = await db
    .update(dashboards)
    .set(patch)
    .where(
      and(eq(dashboards.id, input.id), eq(dashboards.userId, userId), isNull(dashboards.deletedAt)),
    )
    .returning({ id: dashboards.id });

  if (updated.length === 0) throw new Error("Dashboard not found");

  revalidateDashboards();
}

export async function deleteDashboard(id: string) {
  const userId = await requireUserId();

  // Soft delete, matching `pages`. The fields stay: they are cascaded only if the
  // row is ever hard-deleted, so an accidental delete stays recoverable in the DB.
  await db
    .update(dashboards)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(dashboards.id, id), eq(dashboards.userId, userId)));

  revalidateDashboards();
}

export async function createField(input: { dashboardId: string; kind: string; label?: string }) {
  const userId = await requireUserId();
  if (!isFieldKind(input.kind)) throw new Error("Unknown field type");

  // The parent is checked explicitly rather than left to the foreign key: an FK
  // would happily accept another user's dashboard id.
  const [parent] = await db
    .select({ id: dashboards.id })
    .from(dashboards)
    .where(
      and(
        eq(dashboards.id, input.dashboardId),
        eq(dashboards.userId, userId),
        isNull(dashboards.deletedAt),
      ),
    )
    .limit(1);

  if (!parent) throw new Error("Dashboard not found");

  const [{ value: highest } = { value: null }] = await db
    .select({ value: max(dashboardFields.position) })
    .from(dashboardFields)
    .where(eq(dashboardFields.dashboardId, input.dashboardId));

  const position = (highest ?? -1) + 1;
  const { config, value } = defaultsFor(input.kind);

  const [row] = await db
    .insert(dashboardFields)
    .values({
      dashboardId: input.dashboardId,
      userId,
      label: (input.label ?? "").slice(0, MAX_LABEL_LENGTH),
      kind: input.kind,
      config,
      value,
      position,
      // Seeded so the phase-2b grid has a sane starting layout for fields created
      // before it existed, rather than stacking every one of them at the origin.
      gridY: position,
    })
    .returning({ id: dashboardFields.id });

  revalidateDashboards();
  return row;
}

/**
 * Updates one field.
 *
 * `value` and `config` are optional and handled separately so setting a reading
 * cannot clobber the unit, and vice versa. Both are coerced against the stored
 * `kind` — never against a kind sent from the client, which would let a number
 * field be talked into holding a string.
 */
export async function updateField(input: {
  id: string;
  label?: string;
  value?: unknown;
  config?: unknown;
}) {
  const userId = await requireUserId();

  const [existing] = await db
    .select({ kind: dashboardFields.kind })
    .from(dashboardFields)
    .where(and(eq(dashboardFields.id, input.id), eq(dashboardFields.userId, userId)))
    .limit(1);

  if (!existing) throw new Error("Field not found");
  if (!isFieldKind(existing.kind)) throw new Error("Unknown field type");

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.label !== undefined) patch.label = input.label.slice(0, MAX_LABEL_LENGTH);
  if (input.value !== undefined) patch.value = coerceValue(existing.kind, input.value);
  if (input.config !== undefined) patch.config = coerceConfig(existing.kind, input.config);

  await db
    .update(dashboardFields)
    .set(patch)
    .where(and(eq(dashboardFields.id, input.id), eq(dashboardFields.userId, userId)));

  revalidateDashboards();
}

export async function deleteField(id: string) {
  const userId = await requireUserId();

  await db
    .delete(dashboardFields)
    .where(and(eq(dashboardFields.id, id), eq(dashboardFields.userId, userId)));

  revalidateDashboards();
}

/**
 * Rewrites the order of every field on a dashboard.
 *
 * One statement rather than a write per field: a drag can move many positions at
 * once, and Supabase is far enough away that a loop here would be visible as lag.
 */
export async function reorderFields(input: { dashboardId: string; orderedIds: string[] }) {
  const userId = await requireUserId();
  if (input.orderedIds.length === 0) return;

  const cases = input.orderedIds.map(
    (id, index) => sql`when ${dashboardFields.id} = ${id}::uuid then ${index}::int`,
  );

  await db
    .update(dashboardFields)
    .set({ position: sql`case ${sql.join(cases, sql` `)} else ${dashboardFields.position} end` })
    .where(
      and(eq(dashboardFields.dashboardId, input.dashboardId), eq(dashboardFields.userId, userId)),
    );

  revalidateDashboards();
}
