import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { pages } from "@/db/schema";

export type PageSummary = {
  id: string;
  title: string;
  emoji: string | null;
  updatedAt: Date;
};

export type PageDetail = {
  id: string;
  title: string;
  emoji: string | null;
};

export async function getPageById(userId: string, id: string): Promise<PageDetail | null> {
  const [row] = await db
    .select({
      id: pages.id,
      title: pages.title,
      emoji: pages.emoji,
    })
    .from(pages)
    .where(and(eq(pages.id, id), eq(pages.userId, userId), isNull(pages.deletedAt)))
    .limit(1);

  return row ?? null;
}

export async function getPages(userId: string): Promise<PageSummary[]> {
  return db
    .select({
      id: pages.id,
      title: pages.title,
      emoji: pages.emoji,
      updatedAt: pages.updatedAt,
    })
    .from(pages)
    .where(and(eq(pages.userId, userId), isNull(pages.deletedAt)))
    .orderBy(desc(pages.updatedAt));
}
