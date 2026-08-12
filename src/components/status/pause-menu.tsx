"use client";

import { useEffect, useRef, useState } from "react";

import { DashboardGlance } from "@/components/dashboard/dashboard-glance";
import { useDashboards } from "@/components/dashboard/use-dashboards";
import { itemAfter, itemBefore } from "@/lib/editor/checklist";
import type { ChecklistItem } from "@/lib/editor/checklist";
import { formatDuration, formatSpan } from "@/lib/status/format";
import type { StatusBlock, StatusView } from "@/lib/status/resolve";
import { cn } from "@/lib/utils";
import { setBlockCursor } from "@/server/actions/events";

import { ProgressBar } from "./status-hud";

/**
 * A tab in the menu: the fixed "Now" view, or one per dashboard.
 *
 * Separate tabs are what let each surface obey its own rules. "Now" is a
 * two-second glance and stays ruthlessly short; a dashboard is a thing you study
 * and can be as long as the user made it. On one page they would have to
 * compromise on each other.
 */
type TabId = "now" | `dashboard:${string}`;

/**
 * The pause menu: a surface you enter, read, and leave.
 *
 * Tabbed from the first version even though there is one tab, because that is
 * the frame dashboards slot into — adding them should be a new entry in `TABS`,
 * not a restructuring of the overlay.
 *
 * Carries `role="dialog"`, which besides the accessibility role is what stops
 * `swipe-pager.tsx` turning the calendar page under a finger dragged across the
 * open menu.
 */
export function PauseMenu({
  view,
  now,
  onClose,
}: {
  view: StatusView;
  now: Date;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<TabId>("now");
  const panel = useRef<HTMLDivElement>(null);
  // Fetched only once the menu is mounted — nothing loads for a window nobody
  // has opened.
  const { data: dashboards } = useDashboards(true);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  const tabs: { id: TabId; label: string }[] = [
    { id: "now", label: "Now" },
    ...(dashboards ?? []).map((dashboard) => ({
      id: `dashboard:${dashboard.id}` as TabId,
      label: dashboard.name || "Untitled",
    })),
  ];

  // A dashboard deleted in another tab must not leave the menu on a tab that no
  // longer exists.
  const active = tabs.some((entry) => entry.id === tab) ? tab : "now";
  const openDashboard = active.startsWith("dashboard:")
    ? dashboards?.find((dashboard) => `dashboard:${dashboard.id}` === active)
    : undefined;

  return (
    <div className="fixed inset-0 z-50 flex justify-center px-4 pt-[10vh]">
      <button
        type="button"
        aria-label="Close status window"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Status"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          // Consumed here so the grid's own Escape handler does not also clear
          // the current block selection underneath.
          event.stopPropagation();
          event.preventDefault();
          onClose();
        }}
        className="border-line bg-surface relative flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border shadow-2xl outline-none"
      >
        {/* `no-scrollbar`, not `overflow-x-visible`: the strip must still scroll
            when there are more dashboards than fit. It just must not show a bar
            to do it — the tabs are 1px taller than their box, so `auto` reserved
            a full horizontal gutter for an overflow nobody can see or use. */}
        <div className="border-line no-scrollbar scroll-x-only flex shrink-0 items-center gap-1 border-b px-2">
          {tabs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={cn(
                "-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors",
                entry.id === active
                  ? "border-ink text-ink font-medium"
                  : "text-ink-muted hover:text-ink border-transparent",
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {active === "now" ? <NowTab view={view} /> : null}
          {openDashboard ? <DashboardGlance dashboard={openDashboard} now={now} /> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The cursor the menu is drawing, which is not always the one the server sent.
 *
 * Moving the cursor is a keypress, and waiting for a round-trip before the
 * highlight moves would make the list feel stuck — the same reason every grid
 * mutation draws before it saves. The local pin is therefore authoritative for
 * rendering until the server view agrees with it, at which point it is dropped
 * so the server is back in charge.
 *
 * The pending id is compared against `view`, not cleared on a timer: the status
 * query refetches on its own minute tick, so "the server now says what I said"
 * is a signal that actually arrives.
 */
function useCursor(block: StatusBlock | null, current: ChecklistItem | null) {
  const [pending, setPending] = useState<string | null>(null);

  // The server has caught up (or something else moved the cursor) — stop
  // overriding it. Comparing during render rather than in an effect keeps this
  // pure, which `react-hooks/set-state-in-effect` requires.
  if (pending !== null && current?.id === pending) setPending(null);

  const shown = pending ? (block?.items.find((item) => item.id === pending) ?? current) : current;

  function move(direction: 1 | -1) {
    if (!block || !shown) return;

    const target =
      direction === 1 ? itemAfter(block.items, shown.id) : itemBefore(block.items, shown.id);
    if (!target) return;

    setPending(target.id);
    // Not awaited, and failure is silent by design: the worst case is the
    // highlight snapping back to where the server still thinks it is, which is
    // self-explanatory on screen in a way a toast about a reading position
    // would not be.
    void setBlockCursor({ id: block.id, cursorItemId: target.id }).catch(() => setPending(null));
  }

  function clear() {
    if (!block) return;
    setPending(null);
    void setBlockCursor({ id: block.id, cursorItemId: null }).catch(() => {});
  }

  // Registered on the window rather than on the panel, because the panel loses
  // focus the moment a tab button or the reset link is clicked and the arrows
  // would go dead. The menu is modal, so there is nothing underneath that wants
  // these keys — except a text field, which is why typing is still guarded.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? "")) {
        return;
      }

      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return { shown, clear };
}

/**
 * Three zones, separated by luminance rather than by size.
 *
 * Bright for now, normal for next, faint for later — so the eye lands on the
 * current block before it has read a word. "Later" is a count and never a list:
 * expanding it would turn a two-second read into a fourth thing to parse.
 */
function NowTab({ view }: { view: StatusView }) {
  // Called before any branch: a hook may not sit behind a conditional return,
  // and the `clear`/`gap` states have no block to carry a cursor anyway.
  const hasBlock = view.kind === "running" || view.kind === "overrunning";
  const { shown, clear } = useCursor(hasBlock ? view.block : null, hasBlock ? view.current : null);

  if (view.kind === "clear") {
    return (
      <Section>
        <Label>Done</Label>
        <p className="text-ink mt-1 text-xl font-semibold tracking-tight">
          {view.blocksToday > 0 ? "Day complete" : "Nothing scheduled"}
        </p>
        <p className="text-ink-muted mt-1 text-sm">
          {view.blocksToday > 0
            ? `${view.blocksToday} ${view.blocksToday === 1 ? "block" : "blocks"} today.`
            : "No blocks on the calendar for today."}
        </p>
      </Section>
    );
  }

  if (view.kind === "gap") {
    // The gap is the moment attention wanders, so it gets the same weight as a
    // running block rather than reading as an empty state.
    return (
      <>
        <Section>
          <Label>Now</Label>
          <p className="text-ink mt-1 text-xl font-semibold tracking-tight">Nothing scheduled</p>
        </Section>

        <Section bordered>
          <Label>Next</Label>
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <span className="text-ink truncate text-lg font-medium">{view.nextBlock.title}</span>
            <span className="text-ink-muted shrink-0 text-sm tabular-nums">
              in {formatDuration(view.nextBlock.startsInMs)}
            </span>
          </div>
        </Section>

        <Later view={view} />
      </>
    );
  }

  const overrunning = view.kind === "overrunning";
  const nextAfterShown = shown ? itemAfter(view.block.items, shown.id) : null;

  return (
    <>
      <Section>
        <div className="flex items-center justify-between gap-3">
          <Label tone={overrunning ? "warn" : "now"}>{overrunning ? "Overrunning" : "Now"}</Label>
          <span className="text-ink-muted text-xs tabular-nums">
            {formatSpan(view.block.startsAt, view.block.endsAt)}
          </span>
        </div>

        <p className="text-ink mt-1 truncate text-xl font-semibold tracking-tight">
          {view.block.title}
        </p>

        <div className="mt-3 flex items-center gap-3">
          <ProgressBar
            value={view.block.progress}
            tone={overrunning ? "warn" : "now"}
            className="w-full flex-1"
          />
          <span className="text-ink-muted shrink-0 text-xs tabular-nums">
            {overrunning
              ? `${formatDuration(view.block.elapsedMs)} elapsed`
              : `${formatDuration(view.block.remainingMs)} left`}
          </span>
        </div>

        {shown ? (
          <div className="mt-4">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className={cn("shrink-0 text-sm", overrunning ? "text-warn" : "text-now")}
              >
                ▸
              </span>
              <span
                className={cn(
                  "truncate font-medium",
                  // A ticked item can only be current because it was pinned
                  // there, so it reads as struck through rather than as the
                  // next thing to do.
                  shown.checked ? "text-ink-muted line-through" : "text-ink",
                )}
              >
                {shown.text}
              </span>
            </div>
            <div className="mt-1 flex items-baseline gap-2 pl-5">
              {view.block.totalCount > 0 ? (
                <p className="text-ink-muted text-xs tabular-nums">
                  {view.block.doneCount} of {view.block.totalCount} complete
                </p>
              ) : null}
              {view.block.cursorPinned ? (
                <button
                  type="button"
                  onClick={clear}
                  className="text-ink-faint hover:text-ink text-xs underline underline-offset-4 transition-colors"
                >
                  Pinned · reset
                </button>
              ) : null}
            </div>
          </div>
        ) : view.block.totalCount > 0 ? (
          <p className="text-ink-muted mt-4 text-sm">All {view.block.totalCount} items complete.</p>
        ) : (
          <p className="text-ink-faint mt-4 text-sm">No checklist in this block.</p>
        )}
      </Section>

      <Section bordered>
        <div className="flex items-center justify-between gap-3">
          <Label>Up next</Label>
          {/* Named rather than left to be discovered: the pause-menu research
              flags the unlabelled affordance as the recurring failure. */}
          {view.block.totalCount > 1 ? (
            <span className="text-ink-faint text-xs">↑↓ to move</span>
          ) : null}
        </div>
        {/* Two rows answering different questions — "what in thirty seconds"
            and "when does this end" — which previously arrived as two nearly
            identical lines of small grey text. Each is tagged for what it is,
            because the distinction is the entire value of the section. */}
        <div className="mt-2 space-y-2">
          {/* Derived from the cursor being drawn rather than from `view.nextItem`,
              which still trails the server by a round-trip after an arrow press
              and would briefly disagree with the highlight above. */}
          <NextRow
            text={nextAfterShown?.text ?? null}
            empty="Nothing else in this block"
            item={nextAfterShown}
          />
          {view.nextBlock ? (
            <div className="border-line-soft flex items-baseline gap-2 border-t pt-2">
              <Tag>Block</Tag>
              <span className="text-ink min-w-0 flex-1 truncate text-sm">
                {view.nextBlock.title}
              </span>
              <span className="text-ink-muted shrink-0 text-xs tabular-nums">
                in {formatDuration(view.nextBlock.startsInMs)}
              </span>
            </div>
          ) : null}
        </div>
      </Section>

      <Later view={view} />
    </>
  );
}

/**
 * What kind of thing a "Next" row is.
 *
 * A step belongs to the block on screen; a block is what replaces it. Told apart
 * by a word rather than by an icon — an unlabelled glyph is the failure the
 * pause-menu research names most often, and these two are close enough in shape
 * that a bullet versus a rule was not doing it.
 */
function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="border-line text-ink-faint shrink-0 rounded border px-1.5 py-px text-[10px] font-medium tracking-wide uppercase">
      {children}
    </span>
  );
}

function NextRow({
  text,
  empty,
  item,
}: {
  text: string | null;
  empty: string;
  item: ChecklistItem | null;
}) {
  if (!text) return <p className="text-ink-faint text-sm">{empty}</p>;

  return (
    <div className="flex items-baseline gap-2">
      <Tag>Step</Tag>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          item?.checked ? "text-ink-faint line-through" : "text-ink-muted",
        )}
      >
        {text}
      </span>
    </div>
  );
}

function Later({ view }: { view: Extract<StatusView, { later: unknown }> }) {
  const { remainingBlocks, dayEndsAt } = view.later;
  if (remainingBlocks === 0) return null;

  return (
    <Section bordered>
      <p className="text-ink-faint text-xs">
        Later today · {remainingBlocks} more {remainingBlocks === 1 ? "block" : "blocks"}
        {dayEndsAt
          ? ` · ends ${dayEndsAt.getHours()}:${String(dayEndsAt.getMinutes()).padStart(2, "0")}`
          : ""}
      </p>
    </Section>
  );
}

function Section({ children, bordered }: { children: React.ReactNode; bordered?: boolean }) {
  return <div className={cn("px-5 py-4", bordered && "border-line border-t")}>{children}</div>;
}

function Label({ children, tone }: { children: React.ReactNode; tone?: "now" | "warn" }) {
  return (
    <span
      className={cn("text-xs font-medium tracking-wide uppercase", {
        "text-now": tone === "now",
        "text-warn": tone === "warn",
        "text-ink-faint": !tone,
      })}
    >
      {children}
    </span>
  );
}
