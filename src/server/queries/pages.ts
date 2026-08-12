import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { pages } from "@/db/schema";
import { isBlockDocument, type BlockDocument } from "@/lib/editor/document";

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
  /** The document itself, so the client never has to go and fetch it. */
  body: BlockDocument;
  bodyRev: number;
};

/**
 * One page, body included.
 *
 * The body used to be left out here and fetched again from the client, which
 * made opening a page three round trips deep: render the shell, hydrate, then
 * ask for the document — and that third request could not even begin until the
 * first two had finished. Supabase is ~270ms away, so the wait was most of a
 * second before any text appeared, on a query that had already had the row in
 * its hands and discarded the one column that mattered.
 *
 * Selecting it here costs nothing extra: it is the same row, the same index
 * lookup, one column wider.
 */
export async function getPageById(userId: string, id: string): Promise<PageDetail | null> {
  const [row] = await db
    .select({
      id: pages.id,
      title: pages.title,
      emoji: pages.emoji,
      body: pages.body,
      bodyRev: pages.bodyRev,
    })
    .from(pages)
    .where(and(eq(pages.id, id), eq(pages.userId, userId), isNull(pages.deletedAt)))
    .limit(1);

  if (!row) return null;

  // Guarded here rather than trusted: `body` is `jsonb`, so nothing about the
  // column type says it holds blocks.
  return { ...row, body: isBlockDocument(row.body) ? row.body : [] };
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
