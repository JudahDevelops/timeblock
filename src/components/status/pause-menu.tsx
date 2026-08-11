"use client";

import { useEffect, useRef, useState } from "react";

import { DashboardGlance } from "@/components/dashboard/dashboard-glance";
import { useDashboards } from "@/components/dashboard/use-dashboards";
import type { ChecklistItem } from "@/lib/editor/checklist";
import { formatDuration, formatSpan } from "@/lib/status/format";
import type { StatusView } from "@/lib/status/resolve";
import { cn } from "@/lib/utils";

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
        <div className="border-line flex shrink-0 items-center gap-1 overflow-x-auto border-b px-2">
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
 * Three zones, separated by luminance rather than by size.
 *
 * Bright for now, normal for next, faint for later — so the eye lands on the
 * current block before it has read a word. "Later" is a count and never a list:
 * expanding it would turn a two-second read into a fourth thing to parse.
 */
function NowTab({ view }: { view: StatusView }) {
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

        {view.current ? (
          <div className="mt-4">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className={cn("shrink-0 text-sm", overrunning ? "text-warn" : "text-now")}
              >
                ▸
              </span>
              <span className="text-ink truncate font-medium">{view.current.text}</span>
            </div>
            {view.block.totalCount > 0 ? (
              <p className="text-ink-muted mt-1 pl-5 text-xs tabular-nums">
                {view.block.doneCount} of {view.block.totalCount} complete
              </p>
            ) : null}
          </div>
        ) : view.block.totalCount > 0 ? (
          <p className="text-ink-muted mt-4 text-sm">All {view.block.totalCount} items complete.</p>
        ) : (
          <p className="text-ink-faint mt-4 text-sm">No checklist in this block.</p>
        )}
      </Section>

      <Section bordered>
        <Label>Next</Label>
        <div className="mt-2 space-y-2">
          <NextRow
            text={view.nextItem?.text ?? null}
            empty="Nothing else in this block"
            item={view.nextItem}
          />
          {view.nextBlock ? (
            <div className="border-line-soft flex items-baseline justify-between gap-3 border-t pt-2">
              <span className="text-ink truncate text-sm">{view.nextBlock.title}</span>
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
      <span aria-hidden className="text-ink-faint shrink-0 text-sm">
        ·
      </span>
      <span className={cn("truncate text-sm", item?.checked ? "text-ink-faint" : "text-ink-muted")}>
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
