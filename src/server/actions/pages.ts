"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { pages } from "@/db/schema";
import { requireUserId } from "@/server/auth";

const MAX_TITLE_LENGTH = 500;

export async function createPage(input: { title: string; emoji?: string }) {
  const userId = await requireUserId();

  const [row] = await db
    .insert(pages)
    .values({
      userId,
      title: input.title.slice(0, MAX_TITLE_LENGTH),
      emoji: input.emoji ?? null,
    })
    .returning({ id: pages.id });

  revalidatePath("/pages", "page");
  return row;
}

export async function updatePageTitle(input: { id: string; title: string }) {
  const userId = await requireUserId();

  const updated = await db
    .update(pages)
    .set({ title: input.title.slice(0, MAX_TITLE_LENGTH), updatedAt: new Date() })
    .where(and(eq(pages.id, input.id), eq(pages.userId, userId), isNull(pages.deletedAt)))
    .returning({ id: pages.id });

  if (updated.length === 0) throw new Error("Page not found");

  revalidatePath("/pages", "page");
}

export async function updatePageEmoji(input: { id: string; emoji: string | null }) {
  const userId = await requireUserId();

  const updated = await db
    .update(pages)
    .set({ emoji: input.emoji, updatedAt: new Date() })
    .where(and(eq(pages.id, input.id), eq(pages.userId, userId), isNull(pages.deletedAt)))
    .returning({ id: pages.id });

  if (updated.length === 0) throw new Error("Page not found");

  revalidatePath("/pages", "page");
}

export async function deletePage(id: string) {
  const userId = await requireUserId();

  await db
    .update(pages)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(pages.id, id), eq(pages.userId, userId)));

  revalidatePath("/pages", "page");
}
