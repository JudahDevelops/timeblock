import { NextResponse } from "next/server";

import { toPrefixTsQuery } from "@/lib/search/query";
import { requireUserId } from "@/server/auth";
import { searchEvents } from "@/server/queries/search";

/** Shares the Postgres pool with the rest of the server; not edge-compatible. */
export const runtime = "nodejs";

/** Longer than this is a paste, not a search. */
const MAX_QUERY_LENGTH = 200;

export type SearchResult = {
  id: string;
  title: string;
  startsAt: string;
  snippet: string;
};

export async function GET(request: Request) {
  const userId = await requireUserId();
  const raw = new URL(request.url).searchParams.get("q") ?? "";

  const tsquery = toPrefixTsQuery(raw.slice(0, MAX_QUERY_LENGTH));
  // Punctuation alone parses to nothing. Answering with an empty list beats a
  // round-trip to Postgres that can only match nothing.
  const results: SearchResult[] = tsquery
    ? (await searchEvents(userId, tsquery)).map((hit) => ({
        ...hit,
        startsAt: hit.startsAt.toISOString(),
      }))
    : [];

  // Results turn stale the moment a body is autosaved, and they are personal.
  return NextResponse.json({ results }, { headers: { "cache-control": "no-store" } });
}
