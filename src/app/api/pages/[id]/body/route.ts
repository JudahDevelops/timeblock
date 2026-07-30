import { and, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { pages } from "@/db/schema";
import { isBlockDocument, type BlockDocument } from "@/lib/editor/document";
import { blocksToPlainText } from "@/lib/editor/plain-text";
import { requireUserId } from "@/server/auth";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 2_000_000;

export type PageDocument = {
  id: string;
  title: string;
  emoji: string | null;
  body: BlockDocument;
  bodyRev: number;
};

async function loadDocument(userId: string, id: string) {
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

  return {
    id: row.id,
    title: row.title,
    emoji: row.emoji,
    body: isBlockDocument(row.body) ? row.body : [],
    bodyRev: row.bodyRev,
  } satisfies PageDocument;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;

  const document = await loadDocument(userId, id);
  if (!document) return NextResponse.json({ error: "not_found" }, { status: 404 });

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

  const bodyText = blocksToPlainText(body);

  const [updated] = await db
    .update(pages)
    .set({
      body,
      bodyText,
      bodyRev: sql`${pages.bodyRev} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(pages.id, id),
        eq(pages.userId, userId),
        isNull(pages.deletedAt),
        eq(pages.bodyRev, baseRev as number),
      ),
    )
    .returning({ bodyRev: pages.bodyRev });

  if (updated) return NextResponse.json({ bodyRev: updated.bodyRev });

  const current = await loadDocument(userId, id);
  if (!current) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ error: "conflict", current }, { status: 409 });
}
