"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { isSameDay } from "date-fns";

import {
  clampToDay,
  dayAtMinutes,
  DAY_HEIGHT,
  MIN_EVENT_MINUTES,
  minutesToY,
  snapToStep,
  spanForDay,
  yToMinutes,
} from "@/lib/calendar/geometry";
import { layoutDay } from "@/lib/calendar/layout";
import type { CalendarEvent } from "@/server/queries/events";
import {
  createEvent,
  deleteEvent,
  updateEventTime,
  updateEventTitle,
} from "@/server/actions/events";

import { EventBlock } from "./event-block";
import { NowIndicator } from "./now-indicator";

const GUTTER_WIDTH = 56;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

type Drag =
  | { kind: "create"; dayIndex: number; anchorMinutes: number; currentMinutes: number }
  | {
      kind: "move";
      id: string;
      dayIndex: number;
      durationMinutes: number;
      grabOffsetMinutes: number;
      currentMinutes: number;
    }
  | {
      kind: "resize";
      id: string;
      dayIndex: number;
      edge: "start" | "end";
      fixedMinutes: number;
      currentMinutes: number;
    };

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

export function TimeGrid({ days, events }: { days: Date[]; events: CalendarEvent[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const scrollRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<(HTMLDivElement | null)[]>([]);

  const [drag, setDrag] = useState<Drag | null>(null);
  /**
   * The drag is mirrored into a ref because `pointerup` must commit the exact
   * final geometry. Reading it from state would risk one stale frame if the
   * last `pointermove` render has not flushed yet.
   */
  const dragRef = useRef<Drag | null>(null);
  const beginDrag = useCallback((next: Drag) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  const [editingId, setEditingId] = useState<string | null>(null);
  /** Events awaiting a server round-trip, so the grid never appears to lag. */
  const [optimistic, setOptimistic] = useState<Record<string, CalendarEvent>>({});

  // Open on the working day rather than midnight.
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = minutesToY(7 * 60);
  }, []);

  const merged = useMemo(
    () =>
      events
        .map((e) => optimistic[e.id] ?? e)
        .concat(Object.values(optimistic).filter((o) => !events.some((e) => e.id === o.id))),
    [events, optimistic],
  );

  const minutesFromEvent = useCallback((dayIndex: number, clientY: number) => {
    const el = columnsRef.current[dayIndex];
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return clampToDay(yToMinutes(clientY - rect.top));
  }, []);

  const commit = useCallback(
    (current: Drag) => {
      const { startMinutes, endMinutes } = dragRange(current);
      const day = days[current.dayIndex];
      const startsAt = dayAtMinutes(day, startMinutes);
      const endsAt = dayAtMinutes(day, endMinutes);

      if (current.kind === "create") {
        const tempId = `temp-${crypto.randomUUID()}`;
        setOptimistic((o) => ({
          ...o,
          [tempId]: { id: tempId, title: "", startsAt, endsAt, allDay: false, origin: "local" },
        }));
        setEditingId(tempId);

        startTransition(async () => {
          try {
            const row = await createEvent({
              title: "",
              startsAt,
              endsAt,
              tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
            });
            // Swap the temp id for the real one so the title edit targets the row.
            setOptimistic((o) => {
              const next = { ...o };
              const draft = next[tempId];
              delete next[tempId];
              if (draft && row) next[row.id] = { ...draft, id: row.id };
              return next;
            });
            setEditingId((id) => (id === tempId && row ? row.id : id));
          } catch {
            setOptimistic((o) => {
              const next = { ...o };
              delete next[tempId];
              return next;
            });
            setEditingId(null);
          }
        });
        return;
      }

      const existing = merged.find((e) => e.id === current.id);
      if (!existing) return;

      setOptimistic((o) => ({ ...o, [current.id]: { ...existing, startsAt, endsAt } }));
      startTransition(async () => {
        try {
          await updateEventTime({ id: current.id, startsAt, endsAt });
          router.refresh();
        } catch {
          setOptimistic((o) => {
            const next = { ...o };
            delete next[current.id];
            return next;
          });
        }
      });
    },
    [days, merged, router],
  );

  // The drag continues on `window` so the pointer may leave the column
  // mid-gesture. Listeners are rebound whenever `commit` changes identity —
  // harmless, since nothing here uses pointer capture.
  const isDragging = drag !== null;
  useEffect(() => {
    if (!isDragging) return;

    function onMove(event: PointerEvent) {
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
      const next = {
        ...current,
        dayIndex,
        currentMinutes: clampToDay(yToMinutes(event.clientY - rect.top)),
      };
      dragRef.current = next;
      setDrag(next);
    }

    function onUp() {
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

  async function saveTitle(id: string, title: string) {
    setEditingId(null);
    setOptimistic((o) => (o[id] ? { ...o, [id]: { ...o[id], title } } : o));
    try {
      await updateEventTitle({ id, title });
      router.refresh();
    } catch {
      router.refresh();
    }
  }

  async function removeEvent(id: string) {
    setOptimistic((o) => {
      const next = { ...o };
      delete next[id];
      return next;
    });
    await deleteEvent(id);
    router.refresh();
  }

  const previewRange = drag ? dragRange(drag) : null;

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto">
      <div className="flex" style={{ height: DAY_HEIGHT }}>
        {/* Hour gutter */}
        <div className="relative shrink-0" style={{ width: GUTTER_WIDTH }}>
          {HOURS.map((hour) => (
            <div
              key={hour}
              className="absolute right-2 -translate-y-1/2 text-[11px] text-zinc-400 tabular-nums"
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
                className="absolute inset-x-0 border-t border-zinc-100 dark:border-zinc-900"
                style={{ top: minutesToY(hour * 60) }}
              />
            ))}
          </div>

          {days.map((day, dayIndex) => {
            const spans = merged
              .map((event) => {
                const isDragging = drag?.kind !== "create" && drag?.id === event.id;
                const day0 = isDragging && previewRange ? days[drag.dayIndex] : null;

                if (isDragging && previewRange) {
                  if (!isSameDay(day0!, day)) return null;
                  return {
                    id: event.id,
                    event,
                    startMinutes: previewRange.startMinutes,
                    endMinutes: previewRange.endMinutes,
                  };
                }

                const span = spanForDay(event.startsAt, event.endsAt, day);
                return span ? { id: event.id, event, ...span } : null;
              })
              .filter((s): s is NonNullable<typeof s> => s !== null);

            const placed = layoutDay(spans);

            return (
              <div
                key={day.toISOString()}
                ref={(el) => {
                  columnsRef.current[dayIndex] = el;
                }}
                className="relative flex-1 border-r border-zinc-200 last:border-r-0 dark:border-zinc-800"
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  // Only bare grid clicks start a create; blocks stop propagation.
                  const minutes = minutesFromEvent(dayIndex, event.clientY);
                  setEditingId(null);
                  beginDrag({
                    kind: "create",
                    dayIndex,
                    anchorMinutes: minutes,
                    currentMinutes: minutes,
                  });
                }}
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
                    isGhost={item.id.startsWith("temp-")}
                    onStartEdit={() => setEditingId(item.id)}
                    onSaveTitle={(title) => saveTitle(item.id, title)}
                    onDelete={() => removeEvent(item.id)}
                    onGrab={(edge, clientY) => {
                      const minutes = minutesFromEvent(dayIndex, clientY);
                      if (edge === "body") {
                        beginDrag({
                          kind: "move",
                          id: item.id,
                          dayIndex,
                          durationMinutes: item.endMinutes - item.startMinutes,
                          grabOffsetMinutes: minutes - item.startMinutes,
                          currentMinutes: minutes,
                        });
                      } else {
                        beginDrag({
                          kind: "resize",
                          id: item.id,
                          dayIndex,
                          edge,
                          fixedMinutes: edge === "start" ? item.endMinutes : item.startMinutes,
                          currentMinutes: minutes,
                        });
                      }
                    }}
                  />
                ))}

                {/* Live preview while dragging out a brand-new block. */}
                {drag?.kind === "create" && drag.dayIndex === dayIndex && previewRange ? (
                  <div
                    className="pointer-events-none absolute inset-x-1 rounded-md bg-zinc-900/80 dark:bg-zinc-100/80"
                    style={{
                      top: minutesToY(previewRange.startMinutes),
                      height: minutesToY(previewRange.endMinutes - previewRange.startMinutes),
                    }}
                  />
                ) : null}

                {isSameDay(day, new Date()) ? <NowIndicator /> : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
