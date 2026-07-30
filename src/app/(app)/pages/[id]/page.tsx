import { notFound } from "next/navigation";

import { requireUserId } from "@/server/auth";
import { getPageById } from "@/server/queries/pages";

import { PageDetail } from "./page-detail";

export default async function PageDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;

  const page = await getPageById(userId, id);
  if (!page) notFound();

  return <PageDetail pageId={page.id} title={page.title} emoji={page.emoji} />;
}
