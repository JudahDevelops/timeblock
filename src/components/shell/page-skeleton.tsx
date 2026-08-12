"use client";

import { useSyncExternalStore } from "react";

import { readTabs, subscribeTabs } from "@/lib/tabs";

/**
 * A page before its body has arrived.
 *
 * The header is not a grey block. Opening a document the strip already knows
 * about means the title and icon are in hand before the request is made, so
 * they are painted for real on the first frame and never move again — the body
 * fills in underneath them. That is the whole difference between a page that
 * appears instantly and one that appears twice.
 *
 * Falls back to blocks only for a document this client has never seen: a
 * permalink, a hard refresh, a tab restored into a new session.
 *
 * The measurements below are copied from `page-detail.tsx` rather than shared,
 * because they are two renderings of one layout and a mismatch shows up as the
 * title jumping when the real page lands. Change one, change the other.
 */
export function PageSkeleton({ pageId }: { pageId: string }) {
  const known = useKnownTab(`/pages/${pageId}`);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[900px] px-6 pt-8 pb-24 sm:px-24 md:pt-16">
        {/* The emoji is a `p-1` button at 78px/none in the real page, so the
            placeholder carries the same padding — otherwise the title below it
            starts 8px high and drops when the document lands. */}
        <div className="mb-4">
          {known ? (
            <div className="p-1 text-[78px] leading-none">{known.emoji ?? "📄"}</div>
          ) : (
            <div className="bg-surface-raised m-1 size-[78px] animate-pulse rounded-lg" />
          )}
        </div>

        {/* 50px, not 48: the real title is a 40px input at `leading-tight`, and
            measuring it is the only way to get this right. */}
        {known ? (
          <h1 className="mb-2 text-[40px] leading-tight font-bold">{known.title || "Untitled"}</h1>
        ) : (
          <div className="bg-surface-raised mb-2 h-[50px] w-2/3 animate-pulse rounded-md" />
        )}

        <div className="mt-8 flex flex-col gap-3" aria-hidden>
          {/* Descending widths, so it reads as prose rather than as a table. */}
          {["92%", "78%", "85%", "45%"].map((width) => (
            <div
              key={width}
              className="bg-surface-raised h-4 animate-pulse rounded"
              style={{ width }}
            />
          ))}
        </div>

        <span className="sr-only" role="status" data-skeleton="page">
          Loading page
        </span>
      </div>
    </div>
  );
}

/**
 * What the open-tabs strip already knows about this href, if anything.
 *
 * `useSyncExternalStore` alone is not enough here. `sessionStorage` does not
 * exist on the server, so the first render must return the empty snapshot — but
 * the store only notifies on `openTab`/`closeTab`, and a skeleton is on screen
 * precisely when nothing is opening or closing. Nothing would ever wake it, and
 * it would sit showing grey blocks over a title it already had.
 *
 * The mount flag is what re-reads it: `false` through hydration so the markup
 * matches, then `true` on the effect immediately after, which is still well
 * before the document arrives.
 */
export function useKnownTab(href: string) {
  const tabs = useSyncExternalStore(subscribeTabs, readTabs, serverSnapshot);
  return tabs.find((tab) => tab.href === href) ?? null;
}

/**
 * Stable identity, or `useSyncExternalStore` re-renders forever.
 *
 * Returned only on the server. On the client the real `readTabs` runs from the
 * very first render — `sessionStorage` is synchronous and already populated, so
 * there is nothing to wait for and no second commit to arrange. An earlier
 * version gated this behind a mounted flag, which both cost a render and put a
 * `setState` in an effect that the React Compiler lint refuses.
 */
const NONE: never[] = [];
function serverSnapshot() {
  return NONE;
}
