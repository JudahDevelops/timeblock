"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { formatDistanceToNow } from "date-fns";

import type { PageSummary } from "@/server/queries/pages";
import { createPage } from "@/server/actions/pages";
import { SidebarTrigger } from "@/components/shell/app-shell";

export function PagesList({ pages }: { pages: PageSummary[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const handleCreate = () => {
    startTransition(async () => {
      const row = await createPage({ title: "" });
      router.push(`/pages/${row.id}`);
    });
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="border-line flex shrink-0 items-center gap-3 border-b px-4 py-3 sm:px-6">
        <SidebarTrigger />
        <h1 className="text-lg font-semibold">Pages</h1>
        <button
          type="button"
          onClick={handleCreate}
          disabled={pending}
          className="bg-accent text-accent-ink ml-auto rounded-md px-3 py-1.5 text-sm font-medium transition-opacity disabled:opacity-50"
        >
          New page
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {pages.length === 0 ? (
          <div className="text-ink-muted flex flex-col items-center justify-center gap-2 py-24">
            <svg
              viewBox="0 0 24 24"
              className="text-ink-faint size-10"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.25}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
              <path d="M14 2v6h6" />
              <path d="M12 18v-6" />
              <path d="M9 15h6" />
            </svg>
            <p className="text-sm">No pages yet</p>
            <button
              type="button"
              onClick={handleCreate}
              disabled={pending}
              className="text-accent text-sm underline underline-offset-4"
            >
              Create your first page
            </button>
          </div>
        ) : (
          <ul className="divide-line divide-y">
            {pages.map((page) => (
              <li key={page.id}>
                {/* A link, not a button: `next/link` prefetches the route on
                    hover, which is most of what makes opening a page feel
                    instant — a button cannot, and also loses middle-click and
                    open-in-new-tab. */}
                <Link
                  href={`/pages/${page.id}`}
                  className="hover:bg-surface-sunken flex w-full items-center gap-3 px-4 py-3 text-left transition-colors sm:px-6"
                >
                  <span className="text-xl" aria-hidden>
                    {page.emoji ?? "📄"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-ink truncate text-sm font-medium">
                      {page.title || "Untitled"}
                    </span>
                  </span>
                  <span className="text-ink-faint shrink-0 text-xs">
                    {formatDistanceToNow(page.updatedAt, { addSuffix: true })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
