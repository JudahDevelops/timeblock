import { NextResponse } from "next/server";

import { toPrefixTsQuery } from "@/lib/search/query";
import { requireUserId } from "@/server/auth";
import { searchEvents, searchPages } from "@/server/queries/search";

/** Shares the Postgres pool with the rest of the server; not edge-compatible. */
export const runtime = "nodejs";

/** Longer than this is a paste, not a search. */
const MAX_QUERY_LENGTH = 200;

export type SearchResult = {
  id: string;
  title: string;
  startsAt: string;
  snippet: string;
  kind: "event" | "page";
  emoji?: string | null;
};

export async function GET(request: Request) {
  const userId = await requireUserId();
  const raw = new URL(request.url).searchParams.get("q") ?? "";

  const tsquery = toPrefixTsQuery(raw.slice(0, MAX_QUERY_LENGTH));
  // Punctuation alone parses to nothing. Answering with an empty list beats a
  // round-trip to Postgres that can only match nothing.
  let results: SearchResult[] = [];
  if (tsquery) {
    const [eventHits, pageHits] = await Promise.all([
      searchEvents(userId, tsquery),
      searchPages(userId, tsquery),
    ]);
    results = [
      ...eventHits.map((hit) => ({
        ...hit,
        startsAt: hit.startsAt.toISOString(),
        kind: "event" as const,
      })),
      ...pageHits.map((hit) => ({
        ...hit,
        startsAt: "",
        kind: "page" as const,
      })),
    ];
  }

  // Results turn stale the moment a body is autosaved, and they are personal.
  return NextResponse.json({ results }, { headers: { "cache-control": "no-store" } });
}
