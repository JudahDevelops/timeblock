"use client";

import type { StatusView } from "@/lib/status/resolve";
import { formatDuration } from "@/lib/status/format";
import { cn } from "@/lib/utils";

/**
 * The always-visible strip: "where am I", answered without any interaction.
 *
 * Carries no `role="dialog"` on purpose — that attribute is a behavioural switch
 * in `swipe-pager.tsx`, which refuses page-turn gestures while one exists. The
 * HUD is always mounted, so claiming it would disable mobile paging for good.
 */
export function StatusHud({ view, onOpen }: { view: StatusView; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open status window"
      className="border-line bg-surface hover:bg-surface-sunken flex w-full shrink-0 items-center gap-3 border-t px-4 py-2 text-left text-sm transition-colors"
    >
      <Summary view={view} />
      <kbd className="text-ink-faint hidden shrink-0 text-xs sm:inline">⌘.</kbd>
    </button>
  );
}

function Summary({ view }: { view: StatusView }) {
  if (view.kind === "clear") {
    return (
      <span className="text-ink-muted min-w-0 flex-1 truncate">
        {view.blocksToday > 0 ? "Day complete" : "Nothing scheduled today"}
      </span>
    );
  }

  if (view.kind === "gap") {
    return (
      <>
        <span className="text-ink-muted min-w-0 flex-1 truncate">
          Nothing scheduled · next{" "}
          <span className="text-ink font-medium">{view.nextBlock.title}</span>
        </span>
        <span className="text-ink-muted shrink-0 tabular-nums">
          in {formatDuration(view.nextBlock.startsInMs)}
        </span>
      </>
    );
  }

  const overrunning = view.kind === "overrunning";

  return (
    <>
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", overrunning ? "bg-warn" : "bg-now")}
      />

      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{view.block.title}</span>
        {view.current ? (
          <>
            <span className="text-ink-faint mx-1.5">·</span>
            <span className="text-ink-muted">{view.current.text}</span>
          </>
        ) : null}
      </span>

      {/* Progress as a shape first: the bar is what gets read at a glance and
          the number is the footnote, not the other way round. */}
      <span className="hidden shrink-0 items-center gap-2 sm:flex">
        <ProgressBar value={view.block.progress} tone={overrunning ? "warn" : "now"} />
        <span className="text-ink-muted w-16 text-right text-xs tabular-nums">
          {overrunning ? "over" : `${formatDuration(view.block.remainingMs)} left`}
        </span>
      </span>
    </>
  );
}

export function ProgressBar({
  value,
  tone = "now",
  className,
}: {
  value: number;
  tone?: "now" | "warn";
  className?: string;
}) {
  return (
    <span
      className={cn("bg-surface-sunken block h-1.5 w-20 overflow-hidden rounded-full", className)}
      role="progressbar"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span
        className={cn("block h-full rounded-full transition-[width]", {
          "bg-now": tone === "now",
          "bg-warn": tone === "warn",
        })}
        style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }}
      />
    </span>
  );
}
