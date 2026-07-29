import { and, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { events } from "@/db/schema";
import { isBlockDocument, type BlockDocument } from "@/lib/editor/document";
import { blocksToPlainText } from "@/lib/editor/plain-text";
import { requireUserId } from "@/server/auth";

/** Shares the Postgres pool with the rest of the server; not edge-compatible. */
export const runtime = "nodejs";

/** Roughly a novel's worth of blocks. Past this, something is wrong. */
const MAX_BODY_BYTES = 2_000_000;

export type EventDocument = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  body: BlockDocument;
  bodyRev: number;
};

async function loadDocument(userId: string, id: string) {
  const [row] = await db
    .select({
      id: events.id,
      title: events.title,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      body: events.body,
      bodyRev: events.bodyRev,
    })
    .from(events)
    .where(and(eq(events.id, id), eq(events.userId, userId), isNull(events.deletedAt)))
    .limit(1);

  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    // A body written by an older schema is still an array of blocks; anything
    // else means the column was corrupted, and an empty doc beats a crash.
    body: isBlockDocument(row.body) ? row.body : [],
    bodyRev: row.bodyRev,
  } satisfies EventDocument;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;

  const document = await loadDocument(userId, id);
  if (!document) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Never cached: the body is the one thing that must always be current, and a
  // stale copy would immediately 409 on the next save.
  return NextResponse.json(document, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { body, baseRev } = parsed as { body?: unknown; baseRev?: unknown };
  if (!isBlockDocument(body) || !Number.isInteger(baseRev)) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // Derived here, never sent by the client: search would silently rot if a
  // browser-side bug skipped it, and client input is not trustworthy anyway.
  const bodyText = blocksToPlainText(body);

  // The `body_rev` predicate is the whole concurrency story: two tabs racing
  // means the second one's UPDATE matches nothing.
  const [updated] = await db
    .update(events)
    .set({
      body,
      bodyText,
      bodyRev: sql`${events.bodyRev} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(events.id, id),
        eq(events.userId, userId),
        isNull(events.deletedAt),
        eq(events.bodyRev, baseRev as number),
      ),
    )
    .returning({ bodyRev: events.bodyRev });

  // No push from here, unlike the other mutations. This fires every 800ms of
  // typing, and the description stub is derived from the body — pushing inline
  // would rewrite it on every keystroke burst. Moving `updated_at` past
  // `last_pushed_at` is enough: the sweep coalesces a whole writing session
  // into one write to Google.
  if (updated) return NextResponse.json({ bodyRev: updated.bodyRev });

  // No row changed. Either the event is gone, or someone else got there first
  // — and the client needs the winning document to recover, not just a status.
  const current = await loadDocument(userId, id);
  if (!current) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ error: "conflict", current }, { status: 409 });
}
