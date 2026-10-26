"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { events } from "@/db/schema";
import { requireUserId } from "@/server/auth";

const MAX_TITLE_LENGTH = 500;

/**
 * Server Actions are a public HTTP surface, so inputs are validated here even
 * though the only caller today is our own grid.
 */
function assertValidRange(startsAt: Date, endsAt: Date) {
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw new Error("Invalid date");
  }
  if (endsAt <= startsAt) {
    throw new Error("Event must end after it starts");
  }
}

export async function createEvent(input: {
  title: string;
  startsAt: Date;
  endsAt: Date;
  tz: string;
}) {
  const userId = await requireUserId();
  assertValidRange(input.startsAt, input.endsAt);

  const [row] = await db
    .insert(events)
    .values({
      userId,
      title: input.title.slice(0, MAX_TITLE_LENGTH),
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      tz: input.tz,
    })
    .returning({ id: events.id });

  revalidatePath("/calendar", "page");
  return row;
}

/** Move or resize. Both are just a new range. */
export async function updateEventTime(input: { id: string; startsAt: Date; endsAt: Date }) {
  const userId = await requireUserId();
  assertValidRange(input.startsAt, input.endsAt);

  const updated = await db
    .update(events)
    .set({ startsAt: input.startsAt, endsAt: input.endsAt, updatedAt: new Date() })
    .where(and(eq(events.id, input.id), eq(events.userId, userId), isNull(events.deletedAt)))
    .returning({ id: events.id });

  if (updated.length === 0) throw new Error("Event not found");

  revalidatePath("/calendar", "page");
}

export async function updateEventTitle(input: { id: string; title: string }) {
  const userId = await requireUserId();

  const updated = await db
    .update(events)
    .set({ title: input.title.slice(0, MAX_TITLE_LENGTH), updatedAt: new Date() })
    .where(and(eq(events.id, input.id), eq(events.userId, userId), isNull(events.deletedAt)))
    .returning({ id: events.id });

  if (updated.length === 0) throw new Error("Event not found");

  revalidatePath("/calendar", "page");
}

/** Soft delete. The row keeps its body until something purges it deliberately. */
export async function deleteEvent(id: string) {
  const userId = await requireUserId();

  // A second delete is a no-op rather than an error: the block is already gone,
  // which is what the user wanted.
  const deleted = await db
    .update(events)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(events.id, id), eq(events.userId, userId), isNull(events.deletedAt)))
    .returning({ id: events.id });

  if (deleted.length === 0) return;

  revalidatePath("/calendar", "page");
}

/**
 * Pins the status window's cursor to a checklist item, or clears the override.
 *
 * It does not touch `updatedAt`: the cursor is a reading position, not an edit to
 * the block. And it does not validate that the id exists in the body: checklist items
 * live in jsonb, the body may be mid-edit in another tab, and `resolveCursor`
 * already falls back when a pin goes stale. Storing an id that resolves to
 * nothing is harmless; refusing to store one the user just clicked is not.
 */
export async function setBlockCursor(input: { id: string; cursorItemId: string | null }) {
  const userId = await requireUserId();

  const updated = await db
    .update(events)
    .set({ cursorItemId: input.cursorItemId })
    .where(and(eq(events.id, input.id), eq(events.userId, userId), isNull(events.deletedAt)))
    .returning({ id: events.id });

  if (updated.length === 0) throw new Error("Event not found");
}
