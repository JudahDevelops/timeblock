import { Suspense } from "react";
import { notFound } from "next/navigation";

import { PageSkeleton } from "@/components/shell/page-skeleton";
import { requireUserId } from "@/server/auth";
import { getPageById } from "@/server/queries/pages";

import { PageDetail } from "./page-detail";

/**
 * The route paints before it knows anything.
 *
 * Awaiting the query here rather than inside a boundary is what used to make
 * opening a page feel slow: with nothing suspended, the router has no fallback
 * to show, so it holds the *previous* screen on screen until the server is
 * finished. Supabase is ~270ms away, so every click was most of a second of a
 * frozen page with no indication that anything had happened.
 *
 * Splitting the await into a child leaves this component synchronous, so the
 * skeleton is painted on the click and the document streams in behind it.
 *
 * `key` matters: without it React reuses the boundary across a change of `id`,
 * and navigating page → page shows the old document until the new one lands
 * instead of falling back.
 */
export default async function PageDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <Suspense key={id} fallback={<PageSkeleton pageId={id} />}>
      <PageContent id={id} />
    </Suspense>
  );
}

async function PageContent({ id }: { id: string }) {
  const userId = await requireUserId();

  const page = await getPageById(userId, id);
  if (!page) notFound();

  return (
    <PageDetail
      pageId={page.id}
      title={page.title}
      emoji={page.emoji}
      // Handed down rather than refetched: this is the whole document, already
      // loaded, and passing it is what lets the editor render on first paint.
      initialDoc={{
        id: page.id,
        title: page.title,
        emoji: page.emoji,
        body: page.body,
        bodyRev: page.bodyRev,
      }}
    />
  );
}
