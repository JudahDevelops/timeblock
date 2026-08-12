import { extractChecklist, firstUnchecked, itemAfter, resolveCursor } from "@/lib/editor/checklist";
import type { ChecklistItem } from "@/lib/editor/checklist";
import type { BlockDocument } from "@/lib/editor/document";

/**
 * Resolving "where am I in my day" from the blocks around now.
 *
 * Pure and clock-free: `now` is always a parameter, never read here. That is what
 * makes every branch below testable, and it is also what keeps the caller honest
 * about the React purity rule — a component may not read the clock during render,
 * so it resolves `now` in an effect and passes it in.
 */

/** How long an ended block with unfinished items keeps holding the "now" slot. */
export const OVERRUN_GRACE_MS = 30 * 60 * 1000;

/** The subset of an event this module needs. Bodies are only read for checklists. */
export type StatusEvent = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  body: BlockDocument;
  /** Pinned checklist item, or null to follow the default. */
  cursorItemId: string | null;
};

export type StatusBlock = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  /** 0–1, clamped. Past 1 while a block is overrunning. */
  progress: number;
  elapsedMs: number;
  remainingMs: number;
  items: ChecklistItem[];
  doneCount: number;
  totalCount: number;
  /**
   * True when `current` came from a pinned cursor rather than the default.
   *
   * A stale pin resolves to the default and reports false, so the UI offers to
   * clear an override only when there is a live one to clear.
   */
  cursorPinned: boolean;
};

export type NextBlock = {
  id: string;
  title: string;
  startsAt: Date;
  /** Milliseconds until it begins. */
  startsInMs: number;
};

export type StatusView =
  | {
      kind: "running";
      block: StatusBlock;
      current: ChecklistItem | null;
      nextItem: ChecklistItem | null;
      nextBlock: NextBlock | null;
      later: LaterSummary;
    }
  | {
      kind: "overrunning";
      block: StatusBlock;
      current: ChecklistItem | null;
      nextItem: ChecklistItem | null;
      nextBlock: NextBlock | null;
      later: LaterSummary;
    }
  | { kind: "gap"; nextBlock: NextBlock; later: LaterSummary }
  | { kind: "clear"; blocksToday: number };

/** The dimmed footer: a count, never a list. Expanding it would defeat the point. */
export type LaterSummary = {
  remainingBlocks: number;
  /** End of the last block still to come, or null if this is the last one. */
  dayEndsAt: Date | null;
};

/**
 * The whole behavioural spec, as a priority ladder.
 *
 * Order matters: a block running *now* always wins over one that merely ran late,
 * so a new block starting is what retires an overrun rather than the grace timer.
 */
export function resolveStatus(events: StatusEvent[], now: Date): StatusView {
  const timed = events
    .filter((event) => !event.allDay)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  const ms = now.getTime();

  // 1. Something is running. If several overlap, the one that started most
  //    recently is the one you actually moved into.
  const running = timed
    .filter((event) => event.startsAt.getTime() <= ms && event.endsAt.getTime() > ms)
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0];

  if (running) {
    return withItems("running", running, timed, now);
  }

  // 2. Nothing running, but the block that just ended still has work in it.
  //    Bounded by a grace window so a forgotten checklist can't pin the window
  //    to a block from this morning.
  const justEnded = timed
    .filter(
      (event) => event.endsAt.getTime() <= ms && ms - event.endsAt.getTime() < OVERRUN_GRACE_MS,
    )
    .sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime())[0];

  if (justEnded) {
    const items = extractChecklist(justEnded.body);
    // `firstUnchecked` and not `resolveCursor`: overrunning is a claim about
    // work genuinely left undone, so it must not be triggered by a cursor parked
    // on an item the user already ticked. Once the state is entered, `withItems`
    // still honours the pin for *which* item to show.
    if (firstUnchecked(items)) {
      return withItems("overrunning", justEnded, timed, now);
    }
  }

  // 3. A gap. The countdown is the point of this state — it is the moment the
  //    day goes quiet and attention wanders.
  const upcoming = nextAfter(timed, now);
  if (upcoming) {
    return { kind: "gap", nextBlock: upcoming, later: summarise(timed, now) };
  }

  // 4. Nothing left.
  return { kind: "clear", blocksToday: timed.length };
}

function withItems(
  kind: "running" | "overrunning",
  event: StatusEvent,
  timed: StatusEvent[],
  now: Date,
): StatusView {
  const items = extractChecklist(event.body);
  const current = resolveCursor(items, event.cursorItemId);
  const pinned = current !== null && current.id === event.cursorItemId;

  return {
    kind,
    block: toBlock(event, items, now, pinned),
    current,
    nextItem: current ? itemAfter(items, current.id) : null,
    nextBlock: nextAfter(timed, now),
    later: summarise(timed, now),
  };
}

function toBlock(
  event: StatusEvent,
  items: ChecklistItem[],
  now: Date,
  cursorPinned: boolean,
): StatusBlock {
  const start = event.startsAt.getTime();
  const end = event.endsAt.getTime();
  const elapsedMs = Math.max(0, now.getTime() - start);
  // A zero-length block would divide by zero; treat it as wholly complete.
  const durationMs = Math.max(1, end - start);

  return {
    id: event.id,
    title: event.title,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    progress: Math.min(1, elapsedMs / durationMs),
    elapsedMs,
    remainingMs: Math.max(0, end - now.getTime()),
    items,
    doneCount: items.filter((item) => item.checked).length,
    totalCount: items.length,
    cursorPinned,
  };
}

/** Earliest block that has not started yet. */
function nextAfter(timed: StatusEvent[], now: Date): NextBlock | null {
  const ms = now.getTime();
  const upcoming = timed.find((event) => event.startsAt.getTime() > ms);
  if (!upcoming) return null;

  return {
    id: upcoming.id,
    title: upcoming.title,
    startsAt: upcoming.startsAt,
    startsInMs: upcoming.startsAt.getTime() - ms,
  };
}

function summarise(timed: StatusEvent[], now: Date): LaterSummary {
  const ms = now.getTime();
  const remaining = timed.filter((event) => event.startsAt.getTime() > ms);
  const dayEndsAt = remaining.reduce<Date | null>(
    (latest, event) => (!latest || event.endsAt > latest ? event.endsAt : latest),
    null,
  );

  return { remainingBlocks: remaining.length, dayEndsAt };
}
