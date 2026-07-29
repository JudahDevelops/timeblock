"use client";

import { format, isSameDay, isSameMonth } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { spanForDay } from "@/lib/calendar/geometry";
import { calendarPath, MONTH_ROWS, weekdayInitials } from "@/lib/date";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "@/server/queries/events";
import { updateEventTime, updateEventTitle } from "@/server/actions/events";
import { EventDrawer } from "../editor/event-drawer";
import { useToast } from "../shell/toast";
import { useEventOverlay } from "./use-event-overlay";

/**
 * A month of whole days.
 *
 * Deliberately not a time grid: at 1/30th the width of a day column there is
 * no honest way to draw an 09:00–09:15 block, so a month shows *what* is on a
 * day and hands off to the day view for *when*. Chips are ordered by start
 * time, which is the only part of the timing that survives at this scale.
 */
export function MonthGrid({
  days,
  events,
  anchor,
  openEventId,
}: {
  days: Date[];
  events: CalendarEvent[];
  anchor: Date;
  openEventId: string | null;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(openEventId);
  const toast = useToast();
  const overlay = useEventOverlay(events);

  const weekdays = useMemo(() => weekdayInitials(), []);

  // An event is on a day if it overlaps it at all, so a block running past
  // midnight shows on both — the same rule the time grid draws by.
  const byDay = useMemo(
    () =>
      days.map((day) =>
        overlay.merged.filter((e) => spanForDay(e.startsAt, e.endsAt, day) !== null),
      ),
    [days, overlay.merged],
  );

  const openEvent = overlay.merged.find((e) => e.id === openId) ?? null;

  /**
   * Applies a drawer edit, drawn before it is saved.
   *
   * The drawer's time inputs are controlled from these props, so awaiting the
   * server here meant the field ignored keystrokes until it answered — the
   * month view felt broken in a way the time grid never did, purely because
   * that one had an overlay and this one did not.
   */
  const edit = useCallback(
    (event: CalendarEvent, changes: Partial<CalendarEvent>, save: () => Promise<unknown>) => {
      overlay.apply({ ...event, ...changes });
      save().catch(() => {
        overlay.revert(event.id);
        router.refresh();
        toast("Couldn't save that change.");
      });
    },
    [overlay, router, toast],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-line grid shrink-0 grid-cols-7 border-b">
        {weekdays.map((initial, i) => (
          <div
            key={i}
            className="text-ink-faint py-2 text-center text-[11px] font-medium tracking-wide uppercase"
          >
            {initial}
          </div>
        ))}
      </div>

      <div
        className="grid min-h-0 flex-1 grid-cols-7"
        style={{ gridTemplateRows: `repeat(${MONTH_ROWS}, minmax(0, 1fr))` }}
      >
        {days.map((day, i) => (
          <DayCell
            key={day.toISOString()}
            day={day}
            events={byDay[i]}
            // The grid spills into the neighbouring months; those days are real
            // and clickable, just not what you came here to look at.
            outside={!isSameMonth(day, anchor)}
            onOpenEvent={setOpenId}
          />
        ))}
      </div>

      {openEvent ? (
        <EventDrawer
          key={openEvent.id}
          eventId={openEvent.id}
          title={openEvent.title}
          startsAt={openEvent.startsAt}
          endsAt={openEvent.endsAt}
          readOnly={openEvent.origin === "google"}
          recurring={openEvent.recurring}
          onClose={() => setOpenId(null)}
          onRename={(title) =>
            edit(openEvent, { title }, () => updateEventTitle({ id: openEvent.id, title }))
          }
          onReschedule={(startsAt, endsAt) =>
            edit(openEvent, { startsAt, endsAt }, () =>
              updateEventTime({ id: openEvent.id, startsAt, endsAt }),
            )
          }
        />
      ) : null}
    </div>
  );
}

/** Beyond this a cell would clip its chips silently, so the rest are counted. */
const MAX_CHIPS = 3;

function DayCell({
  day,
  events,
  outside,
  onOpenEvent,
}: {
  day: Date;
  events: CalendarEvent[];
  outside: boolean;
  onOpenEvent: (id: string) => void;
}) {
  const today = isSameDay(day, new Date());
  const shown = events.slice(0, MAX_CHIPS);
  const hidden = events.length - shown.length;
  const dayHref = calendarPath("day", day);

  return (
    <div className="border-line flex min-w-0 flex-col gap-0.5 overflow-hidden border-r border-b px-1 pt-1 pb-0.5 last:border-r-0">
      {/* `Link`, not a bare anchor. A full-page navigation inside an iOS
          home-screen app is handed back to Safari, chrome and all — the day
          view would open in a browser and never find its way home. */}
      <Link
        href={dayHref}
        className={cn(
          "mx-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-colors",
          today
            ? "bg-ink text-surface"
            : outside
              ? "text-ink-faint hover:bg-surface-raised"
              : "hover:bg-surface-raised",
        )}
      >
        {format(day, "d")}
      </Link>

      {shown.map((event) => (
        <button
          key={event.id}
          type="button"
          onClick={() => onOpenEvent(event.id)}
          className={cn(
            "border-line bg-surface-raised text-ink truncate rounded border px-1 py-0.5 text-left text-[10px] leading-tight font-medium",
            outside && "opacity-60",
          )}
        >
          {event.title || "Untitled"}
        </button>
      ))}

      {hidden > 0 ? (
        <Link href={dayHref} className="text-ink-faint px-1 text-[10px] hover:underline">
          +{hidden} more
        </Link>
      ) : null}
    </div>
  );
}
