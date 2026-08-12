"use client";

import { useParams } from "next/navigation";

import { PageSkeleton } from "@/components/shell/page-skeleton";

/**
 * Shown while the route segment itself is still loading.
 *
 * The `<Suspense>` in `page.tsx` covers the data; this covers the step before
 * it, when the route's own code is still being fetched. Both render the same
 * skeleton, so the two cases are indistinguishable to the user.
 *
 * `useParams` rather than a prop — a `loading.tsx` receives none.
 */
export default function Loading() {
  const params = useParams<{ id: string }>();
  return <PageSkeleton pageId={params.id} />;
}
