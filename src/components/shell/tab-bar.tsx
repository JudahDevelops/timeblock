"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";

import { closeAllTabs, closeTab, nextAfterClose, readTabs, subscribeTabs } from "@/lib/tabs";
import { cn } from "@/lib/utils";

/**
 * The strip of open documents.
 *
 * Renders nothing until a second tab exists: a bar showing one tab is a title
 * repeated under a title, and it would cost every calendar-only user a row of
 * vertical space for a feature they are not using.
 *
 * Desktop only. A phone has neither the width for a strip nor the pointer for a
 * close button, and it already has the sidebar and the swipe pager for moving
 * between things.
 */
export function TabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const tabs = useSyncExternalStore(subscribeTabs, readTabs, EMPTY);

  if (tabs.length < 2) return null;

  const handleClose = (href: string) => {
    // Read before the write: `nextAfterClose` needs the neighbours as they were.
    const target = nextAfterClose(tabs, href, pathname);
    closeTab(href);
    if (target) router.push(target);
  };

  return (
    <div className="border-line bg-surface no-scrollbar hidden shrink-0 items-stretch gap-px overflow-x-auto border-b md:flex">
      {tabs.map((tab) => {
        const active = tab.href === pathname;

        return (
          // Not a <button> wrapping a <Link>, and not a Link wrapping a button —
          // both are invalid nesting. Siblings in a group, with the close button
          // revealed on hover so the strip stays quiet until pointed at.
          <div
            key={tab.href}
            className={cn(
              "group relative flex min-w-0 shrink-0 items-center",
              active ? "bg-surface-raised" : "hover:bg-surface-sunken",
            )}
          >
            <Link
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex max-w-[180px] min-w-0 items-center gap-1.5 py-2 pr-7 pl-3 text-xs",
                active ? "text-ink" : "text-ink-muted hover:text-ink",
              )}
            >
              <span aria-hidden className="shrink-0 text-[13px] leading-none">
                {tab.emoji ?? "📄"}
              </span>
              <span className="truncate">{tab.title || "Untitled"}</span>
            </Link>

            <button
              type="button"
              onClick={() => handleClose(tab.href)}
              aria-label={`Close ${tab.title || "Untitled"}`}
              className={cn(
                "text-ink-faint hover:text-ink hover:bg-line absolute right-1.5 rounded p-0.5 transition-colors",
                // Always reachable by keyboard; only visible when it is wanted.
                "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                active && "opacity-60",
              )}
            >
              <svg
                viewBox="0 0 16 16"
                className="size-3"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={() => {
          closeAllTabs();
        }}
        className="text-ink-faint hover:text-ink ml-auto shrink-0 px-3 text-xs whitespace-nowrap transition-colors"
      >
        Close all
      </button>
    </div>
  );
}

/** A stable empty array, so the server snapshot never re-renders in a loop. */
const NONE: never[] = [];
function EMPTY() {
  return NONE;
}
