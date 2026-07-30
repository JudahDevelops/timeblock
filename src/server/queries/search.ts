import "server-only";

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { events, pages } from "@/db/schema";
import { HIGHLIGHT_END, HIGHLIGHT_START } from "@/lib/search/highlight";

/**
 * One fragment, centred on the match. `MaxFragments=1` is what makes it centre:
 * left at the default, `ts_headline` returns the head of the document instead,
 * which for a long body is never the part that matched.
 */
const HEADLINE_OPTIONS = [
  `StartSel=${HIGHLIGHT_START}`,
  `StopSel=${HIGHLIGHT_END}`,
  "MaxWords=20",
  "MinWords=8",
  "MaxFragments=1",
].join(",");

export type SearchHit = {
  id: string;
  title: string;
  startsAt: Date;
  /** Words around the match, delimited by the sentinels above. Empty if the hit was on the title alone. */
  snippet: string;
};

/**
 * Events whose title or body matches, best first.
 *
 * `tsquery` arrives already built by `toPrefixTsQuery` — this takes a parsed
 * query expression, never raw user input.
 *
 * `ts_rank_cd` over `ts_rank` because cover density rewards matched terms that
 * appear near each other, which is what distinguishes the block that is
 * actually about the search from one that mentions both words in passing.
 */
export async function searchEvents(
  userId: string,
  tsquery: string,
  limit = 20,
): Promise<SearchHit[]> {
  const query = sql`to_tsquery('english', ${tsquery})`;

  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      startsAt: events.startsAt,
      snippet: sql<string>`ts_headline('english', coalesce(${events.bodyText}, ''), ${query}, ${HEADLINE_OPTIONS})`,
    })
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        isNull(events.deletedAt),
        // The GIN index answers this; everything else is computed on survivors.
        sql`${events.searchTsv} @@ ${query}`,
      ),
    )
    .orderBy(sql`ts_rank_cd(${events.searchTsv}, ${query}) desc`, desc(events.startsAt))
    .limit(limit);

  return rows.map((row) => ({
    ...row,
    // A body is one line per block, so a raw snippet arrives full of newlines.
    snippet: row.snippet.replace(/\s+/g, " ").trim(),
  }));
}

export type PageSearchHit = {
  id: string;
  title: string;
  emoji: string | null;
  snippet: string;
};

export async function searchPages(
  userId: string,
  tsquery: string,
  limit = 20,
): Promise<PageSearchHit[]> {
  const query = sql`to_tsquery('english', ${tsquery})`;

  const rows = await db
    .select({
      id: pages.id,
      title: pages.title,
      emoji: pages.emoji,
      snippet: sql<string>`ts_headline('english', coalesce(${pages.bodyText}, ''), ${query}, ${HEADLINE_OPTIONS})`,
    })
    .from(pages)
    .where(
      and(eq(pages.userId, userId), isNull(pages.deletedAt), sql`${pages.searchTsv} @@ ${query}`),
    )
    .orderBy(sql`ts_rank_cd(${pages.searchTsv}, ${query}) desc`)
    .limit(limit);

  return rows.map((row) => ({
    ...row,
    snippet: row.snippet.replace(/\s+/g, " ").trim(),
  }));
}
