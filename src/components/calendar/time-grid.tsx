"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isSameDay } from "date-fns";

import {
  BLOCK_GAP,
  BLOCK_INSET,
  BLOCK_MIN_HEIGHT,
  BLOCK_TRAIL,
  clampToDay,
  dayAtMinutes,
  DAY_HEIGHT,
  GUTTER_WIDTH,
  HOURS,
  MIN_EVENT_MINUTES,
  MINUTES_PER_DAY,
  minutesSinceMidnight,
  minutesToY,
  snapToStep,
  spanForDay,
  yToMinutes,
} from "@/lib/calendar/geometry";
import { layoutDay } from "@/lib/calendar/layout";
import { useCoarsePointer } from "@/lib/use-coarse-pointer";
import type { CalendarEvent } from "@/server/queries/events";
import {
  createEvent,
  deleteEvent,
  updateEventTime,
  updateEventTitle,
} from "@/server/actions/events";

import { EventDrawer } from "../editor/event-drawer";
import { useToast } from "../shell/toast";
import { BlockActions } from "./block-actions";
import { useEventOverlay } from "./use-event-overlay";
import { EventBlock } from "./event-block";
import { NowIndicator } from "./now-indicator";

/**
 * How far the pointer must travel before a press counts as a drag. Below this
 * a press is a click: it selects a block, and on bare grid it does nothing.
 * Without it, every stray tap created an event.
 */
const DRAG_THRESHOLD_PX = 4;

/** Where the grid opens: the start of a working day, not midnight. */
const DEFAULT_SCROLL_MINUTES = 7 * 60;

/**
 * Touch has no drag-to-create: that gesture is indistinguishable from a scroll.
 * A tap drops a block of this length, which is then adjusted with the handles.
 */
const TAP_CREATE_MINUTES = 60;
const TAP_SLOP_PX = 8;
const TAP_MAX_MS = 600;

type DragBase = {
  dayIndex: number;
  currentMinutes: number;
  originX: number;
  originY: number;
  moved: boolean;
};

type Drag = DragBase &
  (
    | { kind: "create"; anchorMinutes: number }
    | { kind: "move"; id: string; durationMinutes: number; grabOffsetMinutes: number }
    | { kind: "resize"; id: string; edge: "start" | "end"; fixedMinutes: number }
  );

/**
 * A block dragged out but not yet named. It exists only on the client.
 *
 * `title` is set the moment one is typed, and stays for as long as the insert
 * is in flight — otherwise naming a block would blank it again for the length
 * of the round trip.
 */
type Draft = { id: string; startsAt: Date; endsAt: Date; title?: string };

/** The [start, end] a drag currently implies, already snapped and clamped. */
function dragRange(drag: Drag): { startMinutes: number; endMinutes: number } {
  if (drag.kind === "create") {
    const a = snapToStep(drag.anchorMinutes);
    const b = snapToStep(drag.currentMinutes);
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    return end - start < MIN_EVENT_MINUTES
      ? { startMinutes: start, endMinutes: start + MIN_EVENT_MINUTES }
      : { startMinutes: start, endMinutes: end };
  }

  if (drag.kind === "move") {
    const start = clampToDay(snapToStep(drag.currentMinutes - drag.grabOffsetMinutes));
    return { startMinutes: start, endMinutes: start + drag.durationMinutes };
  }

  const moving = snapToStep(drag.currentMinutes);
  if (drag.edge === "start") {
    const start = Math.min(moving, drag.fixedMinutes - MIN_EVENT_MINUTES);
    return { startMinutes: clampToDay(start), endMinutes: drag.fixedMinutes };
  }
  const end = Math.max(moving, drag.fixedMinutes + MIN_EVENT_MINUTES);
  return { startMinutes: drag.fixedMinutes, endMinutes: clampToDay(end) };
}

/** What a single column should draw on top of its stored events. */
type Preview = { id: string | null; startMinutes: number; endMinutes: number };

export function TimeGrid({
  days,
  events,
  openEventId = null,
}: {
  days: Date[];
  events: CalendarEvent[];
  /** A block to open immediately, set by the search palette. */
  openEventId?: string | null;
}) {
  const router = useRouter();
  const isCoarse = useCoarsePointer();

  const scrollRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<(HTMLDivElement | null)[]>([]);
  const tapRef = useRef<{ x: number; y: number; at: number } | null>(null);

  const [drag, setDrag] = useState<Drag | null>(null);
  /**
   * The drag is mirrored into a ref because `pointerup` must commit the exact
   * final geometry. Reading it from state would risk one stale frame if the
   * last `pointermove` render has not flushed yet.
   */
  const dragRef = useRef<Drag | null>(null);
  const frameRef = useRef<number | null>(null);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Id of the block whose quick-actions sheet is open, if any. */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  /** Id of the block whose document is open in the drawer, if any. */
  const [openId, setOpenId] = useState<string | null>(openEventId);

  const toast = useToast();
  const overlay = useEventOverlay(events);

  // Open on the working day rather than midnight — or, arriving from search, on
  // the block itself, so the grid behind the drawer shows where you landed.
  const scrolledRef = useRef(false);
  useLayoutEffect(() => {
    if (scrolledRef.current || !scrollRef.current) return;
    scrolledRef.current = true;

    const target = openEventId ? events.find((e) => e.id === openEventId) : null;
    const minutes = target
      ? Math.max(minutesSinceMidnight(target.startsAt) - 60, 0)
      : DEFAULT_SCROLL_MINUTES;
    scrollRef.current.scrollTop = minutesToY(minutes);
  }, [openEventId, events]);

  const merged = useMemo(() => {
    const rows = overlay.merged;
    if (!draft) return rows;
    return rows.concat({
      id: draft.id,
      title: draft.title ?? "",
      startsAt: draft.startsAt,
      endsAt: draft.endsAt,
      allDay: false,
      origin: "local",
      recurring: false,
    });
  }, [overlay.merged, draft]);

  /**
   * Google owns the shape of its own events. Every mutation path checks here
   * rather than trusting a block to have hidden its own affordances.
   */
  const isReadOnly = useCallback(
    (id: string) => merged.some((e) => e.id === id && e.origin === "google"),
    [merged],
  );

  const timed = useMemo(() => merged.filter((e) => !e.allDay), [merged]);

  // An all-day event has no slot on an hourly grid; drawn as a span it papers
  // over the whole day. These ride in a sticky row above the grid instead.
  const allDayByDay = useMemo(
    () =>
      days.map((day) =>
        merged.filter((e) => e.allDay && spanForDay(e.startsAt, e.endsAt, day) !== null),
      ),
    [days, merged],
  );
  const hasAllDay = allDayByDay.some((row) => row.length > 0);

  const registerColumn = useCallback((dayIndex: number, el: HTMLDivElement | null) => {
    columnsRef.current[dayIndex] = el;
  }, []);

  const minutesFromEvent = useCallback((dayIndex: number, clientY: number) => {
    const el = columnsRef.current[dayIndex];
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return clampToDay(yToMinutes(clientY - rect.top));
  }, []);

  const beginDrag = useCallback((next: Drag) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  /**
   * The only way selection changes. An unnamed draft lives exactly as long as
   * it stays selected — losing focus is not enough, or adjusting a block
   * before naming it would destroy the block.
   */
  const changeSelection = useCallback((id: string | null) => {
    setDraft((current) => (current && current.id !== id ? null : current));
    setSelectedId(id);
  }, []);

  const removeEvent = useCallback(
    (id: string) => {
      setSelectedId((current) => (current === id ? null : current));
      // Off the grid now, not when the tombstone lands. Awaiting the round trip
      // left the block sitting there looking like the key press was missed.
      overlay.hide(id);
      deleteEvent(id).catch(() => {
        overlay.unhide(id);
        router.refresh();
        toast("Couldn't delete that block.");
      });
    },
    [overlay, router, toast],
  );

  const saveTitle = useCallback(
    async (id: string, raw: string) => {
      const title = raw.trim();
      setEditingId(null);
      if (isReadOnly(id)) return;

      // An unnamed draft is not an event, so it never reaches the server — but
      // it also survives here. Blur happens whenever a handle is grabbed; only
      // deselecting it means the user walked away.
      if (draft && id === draft.id) {
        if (!title) return;
        // The draft is carried *through* the insert, now wearing its name.
        // Clearing it first — as this used to — took the block off the grid for
        // the whole round trip and put it back a moment later.
        const { startsAt, endsAt } = draft;
        setDraft({ id, startsAt, endsAt, title });

        try {
          const row = await createEvent({
            title,
            startsAt,
            endsAt,
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          });
          // Handing over in one tick: React batches both, so the draft is
          // replaced by the real row in a single render and never blinks.
          overlay.apply({
            id: row.id,
            title,
            startsAt,
            endsAt,
            allDay: false,
            origin: "local",
            recurring: false,
          });
          setDraft(null);
          changeSelection(row.id);
        } catch {
          setDraft(null);
          router.refresh();
          toast("Couldn't create that block.");
        }
        return;
      }

      // Unconditionally, unlike before: this used to write only when an entry
      // already existed, so the first rename of a server-rendered block wrote
      // nothing and the input unmounted back onto the old title.
      const existing = merged.find((e) => e.id === id);
      if (!existing || existing.title === title) return;

      overlay.apply({ ...existing, title });
      updateEventTitle({ id, title }).catch(() => {
        overlay.revert(id);
        router.refresh();
        toast("Couldn't rename that block.");
      });
    },
    [changeSelection, draft, isReadOnly, merged, overlay, router, toast],
  );

  /**
   * Moves a stored event, optimistically. Shared by the drag commit and the
   * drawer's time pickers so both paths agree on rollback.
   */
  const applyTime = useCallback(
    (id: string, startsAt: Date, endsAt: Date) => {
      const existing = merged.find((e) => e.id === id);
      if (!existing || existing.origin === "google") return;

      overlay.apply({ ...existing, startsAt, endsAt });
      // No refresh on success: the overlay already matches what the server
      // stored, and a round-trip here is what made dragging sluggish.
      updateEventTime({ id, startsAt, endsAt }).catch(() => {
        overlay.revert(id);
        router.refresh();
        toast("Couldn't move that block.");
      });
    },
    [merged, overlay, router, toast],
  );

  const commit = useCallback(
    (current: Drag) => {
      // A press that never travelled is a click, not a gesture.
      if (!current.moved) {
        if (current.kind === "create") changeSelection(null);
        return;
      }

      const { startMinutes, endMinutes } = dragRange(current);
      const day = days[current.dayIndex];
      const startsAt = dayAtMinutes(day, startMinutes);
      const endsAt = dayAtMinutes(day, endMinutes);

      if (current.kind === "create") {
        const id = `draft-${crypto.randomUUID()}`;
        setDraft({ id, startsAt, endsAt });
        setEditingId(id);
        changeSelection(id);
        return;
      }

      if (draft && current.id === draft.id) {
        setDraft({ ...draft, startsAt, endsAt });
        return;
      }

      applyTime(current.id, startsAt, endsAt);
    },
    [applyTime, changeSelection, days, draft],
  );

  // The drag continues on `window` so the pointer may leave the column
  // mid-gesture. Listeners are rebound whenever `commit` changes identity —
  // harmless, since nothing here uses pointer capture.
  const isDragging = drag !== null;
  useEffect(() => {
    if (!isDragging) return;

    function apply(event: PointerEvent) {
      const current = dragRef.current;
      if (!current) return;

      // Moving between columns re-targets the day, which is how an event is
      // dragged from Tuesday to Thursday.
      let dayIndex = current.dayIndex;
      if (current.kind === "move") {
        const hit = columnsRef.current.findIndex((el) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          return event.clientX >= rect.left && event.clientX < rect.right;
        });
        if (hit !== -1) dayIndex = hit;
      }

      const el = columnsRef.current[dayIndex];
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const travelled = Math.hypot(
        event.clientX - current.originX,
        event.clientY - current.originY,
      );
      const next: Drag = {
        ...current,
        dayIndex,
        moved: current.moved || travelled >= DRAG_THRESHOLD_PX,
        currentMinutes: clampToDay(yToMinutes(event.clientY - rect.top)),
      };
      dragRef.current = next;
      setDrag(next);
    }

    // Pointer events outpace the display; coalescing to one frame keeps the
    // grid from re-rendering several times per painted frame.
    function onMove(event: PointerEvent) {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        apply(event);
      });
    }

    function onUp() {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      const current = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (current) commit(current);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [isDragging, commit]);

  /**
   * Opens a block's document. A draft has no row to open yet, so it falls back
   * to naming inline — which is what turns it into a real event.
   */
  const handleOpen = useCallback(
    (id: string) => {
      if (draft && id === draft.id) setEditingId(id);
      else setOpenId(id);
    },
    [draft],
  );

  const handleRename = useCallback(
    (id: string) => {
      if (!isReadOnly(id)) setEditingId(id);
    },
    [isReadOnly],
  );

  // Keyboard acts on the selection rather than DOM focus, so a tap on mobile
  // and a click on desktop drive the same target. The drawer, when open, owns
  // the keyboard instead.
  useEffect(() => {
    if (!selectedId || editingId || openId) return;
    // Pinned for the closure: the effect only runs with a selection, but TS
    // cannot see that through the listener.
    const selected = selectedId;

    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.isContentEditable) return;

      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        if (draft && selected === draft.id) changeSelection(null);
        else if (!isReadOnly(selected)) removeEvent(selected);
      } else if (event.key === "Enter") {
        event.preventDefault();
        handleOpen(selected);
      } else if (event.key === "Escape") {
        changeSelection(null);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, editingId, openId, draft, changeSelection, handleOpen, isReadOnly, removeEvent]);

  const handleColumnPointerDown = useCallback(
    (dayIndex: number, event: React.PointerEvent) => {
      if (event.button !== 0) return;

      // Editing is deliberately left alone: the press blurs the title input on
      // its own, and unmounting the input instead would skip `onBlur` and
      // strand an unnamed draft on the grid forever.

      // A touch-drag on bare grid is a scroll, so touch waits for the pointer
      // to lift and only then decides whether it was a tap.
      if (event.pointerType === "touch") {
        tapRef.current = { x: event.clientX, y: event.clientY, at: Date.now() };
        return;
      }

      const minutes = minutesFromEvent(dayIndex, event.clientY);
      beginDrag({
        kind: "create",
        dayIndex,
        anchorMinutes: minutes,
        currentMinutes: minutes,
        originX: event.clientX,
        originY: event.clientY,
        moved: false,
      });
    },
    [beginDrag, minutesFromEvent],
  );

  const handleColumnTap = useCallback(
    (dayIndex: number, event: React.PointerEvent) => {
      const tap = tapRef.current;
      tapRef.current = null;
      if (!tap || event.pointerType !== "touch") return;

      const travelled = Math.hypot(event.clientX - tap.x, event.clientY - tap.y);
      if (travelled > TAP_SLOP_PX || Date.now() - tap.at > TAP_MAX_MS) return;

      // A rename is in flight. The blur this tap causes will commit or discard
      // it; touching the draft here would race that and lose the typed title.
      if (editingId) return;

      // A tap on bare grid first clears whatever is active — dropping an
      // unnamed draft with it — and only creates once nothing is.
      if (draft || selectedId) {
        changeSelection(null);
        return;
      }

      // Tap-create fills the hour the finger landed in, so a new block sits
      // flush between two lines rather than a quarter-hour off them.
      const start = Math.min(
        Math.floor(minutesFromEvent(dayIndex, event.clientY) / 60) * 60,
        MINUTES_PER_DAY - TAP_CREATE_MINUTES,
      );
      const day = days[dayIndex];
      const id = `draft-${crypto.randomUUID()}`;
      setDraft({
        id,
        startsAt: dayAtMinutes(day, start),
        endsAt: dayAtMinutes(day, start + TAP_CREATE_MINUTES),
      });
      changeSelection(id);
      setEditingId(id);
    },
    [changeSelection, days, draft, editingId, minutesFromEvent, selectedId],
  );

  const handleColumnPointerCancel = useCallback(() => {
    tapRef.current = null;
  }, []);

  const handleGrab = useCallback(
    (
      dayIndex: number,
      item: { id: string; startMinutes: number; endMinutes: number },
      edge: "body" | "start" | "end",
      event: React.PointerEvent,
    ) => {
      const minutes = minutesFromEvent(dayIndex, event.clientY);
      changeSelection(item.id);
      const base = {
        dayIndex,
        currentMinutes: minutes,
        originX: event.clientX,
        originY: event.clientY,
        moved: false,
      };
      if (edge === "body") {
        beginDrag({
          ...base,
          kind: "move",
          id: item.id,
          durationMinutes: item.endMinutes - item.startMinutes,
          grabOffsetMinutes: minutes - item.startMinutes,
        });
      } else {
        beginDrag({
          ...base,
          kind: "resize",
          id: item.id,
          edge,
          fixedMinutes: edge === "start" ? item.endMinutes : item.startMinutes,
        });
      }
    },
    [beginDrag, changeSelection, minutesFromEvent],
  );

  const handleDelete = useCallback(
    (id: string) => {
      if (draft && id === draft.id) changeSelection(null);
      else if (!isReadOnly(id)) void removeEvent(id);
    },
    [changeSelection, draft, isReadOnly, removeEvent],
  );

  const handleLongPress = useCallback(
    (id: string) => {
      // The press already began a drag; abandon it so the block does not follow
      // the finger while the sheet is up.
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      dragRef.current = null;
      setDrag(null);
      changeSelection(id);
      setMenuFor(id);
    },
    [changeSelection],
  );

  // Deleted underneath the drawer, or navigated away from: either way there is
  // nothing left to show, so the drawer unmounts on its own.
  const openEvent = openId ? (merged.find((e) => e.id === openId) ?? null) : null;

  // Only the column under the pointer gets a live preview; every other column
  // receives `null` and so is skipped by `memo` for the whole gesture.
  const previewRange = drag && drag.moved ? dragRange(drag) : null;
  const draggingId = drag && drag.kind !== "create" && drag.moved ? drag.id : null;

  return (
    // Tagged for the pager, which levels the three panes' scroll offsets
    // before a swipe so the week sliding in meets you at the same hour.
    <div ref={scrollRef} data-grid-scroll className="min-h-0 flex-1 overflow-y-auto">
      {hasAllDay ? (
        <div className="border-line bg-surface sticky top-0 z-20 flex border-b">
          <div className="shrink-0" style={{ width: GUTTER_WIDTH }} />
          <div className="flex flex-1">
            {days.map((day, dayIndex) => (
              <div
                key={day.toISOString()}
                className="border-line flex min-w-0 flex-1 flex-col gap-1 border-r p-1 last:border-r-0"
              >
                {allDayByDay[dayIndex].map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => setOpenId(event.id)}
                    className="bg-surface-raised text-ink-muted truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium"
                  >
                    {event.title || "Untitled"}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex" style={{ height: DAY_HEIGHT }}>
        {/* Hour gutter */}
        <div className="relative shrink-0" style={{ width: GUTTER_WIDTH }}>
          {HOURS.map((hour) => (
            <div
              key={hour}
              className="text-ink-faint absolute right-2 -translate-y-1/2 text-[11px] tabular-nums"
              style={{ top: minutesToY(hour * 60) }}
            >
              {hour === 0 ? "" : `${hour.toString().padStart(2, "0")}:00`}
            </div>
          ))}
        </div>

        <div className="relative flex flex-1">
          {/* Hour lines span the full width, behind every column. */}
          <div className="pointer-events-none absolute inset-0">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="border-line absolute inset-x-0 border-t"
                style={{ top: minutesToY(hour * 60) }}
              />
            ))}
          </div>

          {days.map((day, dayIndex) => (
            <DayColumn
              key={day.toISOString()}
              day={day}
              dayIndex={dayIndex}
              events={timed}
              draggingId={draggingId}
              preview={
                previewRange && drag?.dayIndex === dayIndex
                  ? {
                      id: drag.kind === "create" ? null : drag.id,
                      startMinutes: previewRange.startMinutes,
                      endMinutes: previewRange.endMinutes,
                    }
                  : null
              }
              draftId={draft?.id ?? null}
              editingId={editingId}
              selectedId={selectedId}
              isCoarse={isCoarse}
              registerColumn={registerColumn}
              onColumnPointerDown={handleColumnPointerDown}
              onColumnTap={handleColumnTap}
              onColumnPointerCancel={handleColumnPointerCancel}
              onGrab={handleGrab}
              onSelect={changeSelection}
              onStartEdit={handleOpen}
              onSaveTitle={saveTitle}
              onLongPress={handleLongPress}
            />
          ))}
        </div>
      </div>

      {menuFor ? (
        <BlockActions
          title={merged.find((e) => e.id === menuFor)?.title ?? ""}
          readOnly={isReadOnly(menuFor)}
          onOpen={() => {
            handleOpen(menuFor);
            setMenuFor(null);
          }}
          onRename={() => {
            handleRename(menuFor);
            setMenuFor(null);
          }}
          onDelete={() => {
            handleDelete(menuFor);
            setMenuFor(null);
          }}
          onClose={() => setMenuFor(null)}
        />
      ) : null}

      {openEvent ? (
        // Keyed on the id: switching blocks must rebuild the editor rather than
        // push new content into a live one.
        <EventDrawer
          key={openEvent.id}
          eventId={openEvent.id}
          title={openEvent.title}
          startsAt={openEvent.startsAt}
          endsAt={openEvent.endsAt}
          readOnly={openEvent.origin === "google"}
          recurring={openEvent.recurring}
          onClose={() => setOpenId(null)}
          onRename={(title) => void saveTitle(openEvent.id, title)}
          onReschedule={(startsAt, endsAt) => applyTime(openEvent.id, startsAt, endsAt)}
        />
      ) : null}
    </div>
  );
}

const DayColumn = memo(function DayColumn({
  day,
  dayIndex,
  events,
  draggingId,
  preview,
  draftId,
  editingId,
  selectedId,
  isCoarse,
  registerColumn,
  onColumnPointerDown,
  onColumnTap,
  onColumnPointerCancel,
  onGrab,
  onSelect,
  onStartEdit,
  onSaveTitle,
  onLongPress,
}: {
  day: Date;
  dayIndex: number;
  events: CalendarEvent[];
  draggingId: string | null;
  preview: Preview | null;
  draftId: string | null;
  editingId: string | null;
  selectedId: string | null;
  isCoarse: boolean;
  registerColumn: (dayIndex: number, el: HTMLDivElement | null) => void;
  onColumnPointerDown: (dayIndex: number, event: React.PointerEvent) => void;
  onColumnTap: (dayIndex: number, event: React.PointerEvent) => void;
  onColumnPointerCancel: () => void;
  onGrab: (
    dayIndex: number,
    item: { id: string; startMinutes: number; endMinutes: number },
    edge: "body" | "start" | "end",
    event: React.PointerEvent,
  ) => void;
  onSelect: (id: string) => void;
  onStartEdit: (id: string) => void;
  onSaveTitle: (id: string, title: string) => void;
  onLongPress: (id: string) => void;
}) {
  const spans = events
    .map((event) => {
      // The dragged block is drawn from `preview` instead, wherever it now is.
      if (event.id === draggingId) return null;
      const span = spanForDay(event.startsAt, event.endsAt, day);
      return span ? { id: event.id, event, ...span } : null;
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  if (preview?.id) {
    const event = events.find((e) => e.id === preview.id);
    if (event) {
      spans.push({
        id: event.id,
        event,
        startMinutes: preview.startMinutes,
        endMinutes: preview.endMinutes,
      });
    }
  }

  const placed = layoutDay(spans);

  return (
    <div
      ref={(el) => registerColumn(dayIndex, el)}
      className="border-line relative flex-1 border-r last:border-r-0"
      onPointerDown={(event) => onColumnPointerDown(dayIndex, event)}
      onPointerUp={(event) => onColumnTap(dayIndex, event)}
      onPointerCancel={onColumnPointerCancel}
    >
      {placed.map(({ item, column, columns }) => (
        <EventBlock
          key={item.id}
          title={item.event.title}
          startMinutes={item.startMinutes}
          endMinutes={item.endMinutes}
          column={column}
          columns={columns}
          isEditing={editingId === item.id}
          isSelected={selectedId === item.id}
          isDraft={item.id === draftId}
          isCoarse={isCoarse}
          readOnly={item.event.origin === "google"}
          recurring={item.event.recurring}
          onSelect={() => onSelect(item.id)}
          onStartEdit={() => onStartEdit(item.id)}
          onSaveTitle={(title) => onSaveTitle(item.id, title)}
          onGrab={(edge, event) => onGrab(dayIndex, item, edge, event)}
          onLongPress={() => onLongPress(item.id)}
        />
      ))}

      {/* Live preview while dragging out a brand-new block. */}
      {preview && !preview.id ? (
        <div
          className="border-line bg-surface-raised/80 pointer-events-none absolute rounded-md border"
          // Inset exactly as the real block will be, so nothing shifts under the
          // pointer at the moment the drag is released.
          style={{
            top: minutesToY(preview.startMinutes),
            height: Math.max(
              minutesToY(preview.endMinutes - preview.startMinutes) - BLOCK_GAP,
              BLOCK_MIN_HEIGHT,
            ),
            left: BLOCK_INSET,
            right: BLOCK_TRAIL,
          }}
        />
      ) : null}

      {isSameDay(day, new Date()) ? <NowIndicator /> : null}
    </div>
  );
});
