"use server";

import { and, eq, isNull, max, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { dashboardFields, dashboards } from "@/db/schema";
import {
  coerceConfig,
  coerceValue,
  DEFAULT_FIELD_H,
  DEFAULT_FIELD_W,
  defaultsFor,
  isFieldKind,
  MAX_LABEL_LENGTH,
} from "@/lib/dashboard/field";
import { clampBox, firstFreeSlot } from "@/lib/dashboard/grid";
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

  // The existing boxes, so the new field lands in a gap rather than on top of
  // something. One extra read, but placing blind means every new field starts
  // colliding and the first thing the user sees is a layout shuffling itself.
  const existing = await db
    .select({
      id: dashboardFields.id,
      x: dashboardFields.gridX,
      y: dashboardFields.gridY,
      w: dashboardFields.gridW,
      h: dashboardFields.gridH,
      position: dashboardFields.position,
    })
    .from(dashboardFields)
    .where(eq(dashboardFields.dashboardId, input.dashboardId));

  const position = existing.reduce((highest, row) => Math.max(highest, row.position), -1) + 1;
  const slot = firstFreeSlot(existing, DEFAULT_FIELD_W, DEFAULT_FIELD_H);
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
      gridX: slot.x,
      gridY: slot.y,
      gridW: DEFAULT_FIELD_W,
      gridH: DEFAULT_FIELD_H,
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
 * Writes a whole grid layout at once.
 *
 * One statement with four `CASE` expressions rather than a write per field: a
 * drag can move half a dashboard, and Supabase is ~270ms away, so a loop here
 * would turn one gesture into a second of round trips.
 *
 * The boxes are re-clamped server-side. `normalise` already ran on the client,
 * but that is a rendering concern — this is the trust boundary, and nothing
 * stops a crafted call asking for a field 400 columns wide.
 */
export async function updateFieldLayout(input: {
  dashboardId: string;
  layout: { id: string; x: number; y: number; w: number; h: number }[];
}) {
  const userId = await requireUserId();
  if (input.layout.length === 0) return;

  const boxes = input.layout.map((entry) => ({ id: entry.id, ...clampBox(entry) }));

  const caseFor = (pick: (box: (typeof boxes)[number]) => number, column: AnyPgColumn) => {
    const cases = boxes.map(
      (box) => sql`when ${dashboardFields.id} = ${box.id}::uuid then ${pick(box)}::int`,
    );
    return sql`case ${sql.join(cases, sql` `)} else ${column} end`;
  };

  await db
    .update(dashboardFields)
    .set({
      gridX: caseFor((box) => box.x, dashboardFields.gridX),
      gridY: caseFor((box) => box.y, dashboardFields.gridY),
      gridW: caseFor((box) => box.w, dashboardFields.gridW),
      gridH: caseFor((box) => box.h, dashboardFields.gridH),
      // Kept in step with the visual order so the phone's single column and the
      // pause-menu glance, which both read `position`, follow the grid.
      position: caseFor(
        (box) => boxes.filter((o) => o.y < box.y || (o.y === box.y && o.x < box.x)).length,
        dashboardFields.position,
      ),
    })
    .where(
      and(eq(dashboardFields.dashboardId, input.dashboardId), eq(dashboardFields.userId, userId)),
    );

  revalidateDashboards();
}
