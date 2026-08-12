"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { db } from "@/db";
import { events } from "@/db/schema";
import { pushEventBestEffort } from "@/lib/sync/push";
import { requireUserId } from "@/server/auth";

const MAX_TITLE_LENGTH = 500;

/**
 * Sends a local write on to Google once the response is already on its way.
 *
 * The push is a token refresh plus a REST round-trip to another continent, and
 * awaiting it inline put all of that between the user releasing a block and the
 * action returning — for a result nothing renders, since failures are swallowed
 * and swept up by `pushPending` within five minutes anyway. The database write
 * is still awaited before this is scheduled, so the row a push reads is the one
 * just committed.
 */
function push(userId: string, eventId: string) {
  after(() => pushEventBestEffort(userId, eventId));
}

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

  push(userId, row.id);
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

  push(userId, input.id);
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

  push(userId, input.id);
  revalidatePath("/calendar", "page");
}

/**
 * Soft delete. A tombstone rather than a real delete, so a Google full resync
 * cannot resurrect something the user removed here.
 */
export async function deleteEvent(id: string) {
  const userId = await requireUserId();

  await db
    .update(events)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(events.id, id), eq(events.userId, userId)));

  // The tombstone is what the push reads to know this is a withdrawal, so it
  // has to be written first.
  push(userId, id);
  revalidatePath("/calendar", "page");
}

/**
 * Pins the status window's cursor to a checklist item, or clears the override.
 *
 * Three things this deliberately does not do. It does not push to Google: the
 * cursor is a local reading position with no representation in a calendar event,
 * and sending one would be a write with nothing on the other side to receive it.
 * It does not touch `updatedAt`, because `pushPending` reads
 * `lastPushedAt < updatedAt` as "this row has unsent changes" and `reconcile`
 * uses the same timestamp to decide who wins a conflict — moving a cursor would
 * otherwise queue a spurious push and could hand a contested edit to the wrong
 * side. And it does not validate that the id exists in the body: checklist items
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
