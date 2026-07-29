"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

import type { EventDocument } from "@/app/api/events/[id]/body/route";
import { dayAtMinutes, MIN_EVENT_MINUTES, minutesSinceMidnight } from "@/lib/calendar/geometry";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { cn } from "@/lib/utils";

import { useBodyAutosave, type SaveState } from "./use-body-autosave";

const BlockEditor = dynamic(() => import("./block-editor"), {
  ssr: false,
  loading: () => <div className="px-14 py-8 text-sm text-zinc-400">Loading editor…</div>,
});

function parseTimeInput(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes <= 24 * 60 ? minutes : null;
}

const STATUS_LABEL: Record<SaveState, string> = {
  idle: "",
  pending: "Unsaved",
  saving: "Saving…",
  saved: "Saved",
  conflict: "Out of date",
  error: "Couldn't save",
};

export function EventDrawer({
  eventId,
  title,
  startsAt,
  endsAt,
  readOnly = false,
  recurring = false,
  onClose,
  onRename,
  onReschedule,
}: {
  eventId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  /**
   * Imported from Google. Its title and slot belong to them; the document
   * below is still ours, which is the entire point of the product.
   */
  readOnly?: boolean;
  /**
   * One occurrence of a series. Worth surfacing because the body is keyed to
   * this instance alone — notes written here do not appear on next week's.
   */
  recurring?: boolean;
  onClose: () => void;
  onRename: (title: string) => void;
  onReschedule: (startsAt: Date, endsAt: Date) => void;
}) {
  const keyboardInset = useKeyboardInset();

  const { data, isPending, isError } = useQuery({
    queryKey: ["event-body", eventId],
    queryFn: async (): Promise<EventDocument> => {
      const response = await fetch(`/api/events/${eventId}/body`);
      if (!response.ok) throw new Error(`Failed to load event ${eventId}`);
      return response.json();
    },
    // The editor becomes the source of truth the moment it mounts, so a
    // background refetch would fight the user's typing. Nothing is cached
    // either: reopening must re-read `body_rev` or the first save 409s.
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return (
    <>
      {/* Full-bleed on a phone, so the grid behind it needs shielding from
          stray taps. On a wide screen the grid stays live beside the drawer. */}
      <div
        className="fixed inset-0 z-30 bg-black/20 sm:hidden"
        onPointerDown={onClose}
        aria-hidden
      />

      <aside
        className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-zinc-200 bg-white sm:w-[640px] dark:border-zinc-800 dark:bg-zinc-950"
        // The drawer is pinned to the layout viewport, which iOS leaves at full
        // height behind the keyboard. Padding the bottom by whatever the keyboard
        // covers squeezes the flex column instead, keeping the footer and the last
        // line of text above it.
        style={keyboardInset > 0 ? { paddingBottom: keyboardInset } : undefined}
        role="dialog"
        aria-label={title || "Untitled block"}
      >
        <Header
          title={title}
          startsAt={startsAt}
          endsAt={endsAt}
          readOnly={readOnly}
          recurring={recurring}
          onClose={onClose}
          onRename={onRename}
          onReschedule={onReschedule}
        />

        {isError ? (
          <p className="px-6 py-8 text-sm text-red-600">
            Couldn&apos;t load this block. Close and try again.
          </p>
        ) : isPending ? (
          <p className="px-6 py-8 text-sm text-zinc-400">Loading…</p>
        ) : (
          <Body doc={data} onClose={onClose} />
        )}
      </aside>
    </>
  );
}

function Header({
  title,
  startsAt,
  endsAt,
  readOnly,
  recurring,
  onClose,
  onRename,
  onReschedule,
}: {
  title: string;
  startsAt: Date;
  endsAt: Date;
  readOnly: boolean;
  recurring: boolean;
  onClose: () => void;
  onRename: (title: string) => void;
  onReschedule: (startsAt: Date, endsAt: Date) => void;
}) {
  const changeTime = (edge: "start" | "end", value: string) => {
    const minutes = parseTimeInput(value);
    if (minutes === null) return;

    if (edge === "start") {
      const next = dayAtMinutes(startsAt, minutes);
      // Dragging the start past the end would invert the block, so the end
      // follows along and the duration is preserved.
      const duration = Math.max(endsAt.getTime() - startsAt.getTime(), 0);
      onReschedule(next, new Date(next.getTime() + duration));
      return;
    }

    const end = dayAtMinutes(
      endsAt,
      Math.max(minutes, minutesSinceMidnight(startsAt) + MIN_EVENT_MINUTES),
    );
    onReschedule(startsAt, end);
  };

  return (
    <header className="flex shrink-0 flex-col gap-3 border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
      <div className="flex items-start gap-3">
        <input
          defaultValue={title}
          placeholder="Untitled block"
          readOnly={readOnly}
          // Keyed on the id upstream, so a fresh drawer always shows its own
          // title even though this input is uncontrolled.
          className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none placeholder:text-zinc-400"
          onBlur={(event) => onRename(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          aria-label="Close"
        >
          <svg
            viewBox="0 0 20 20"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </div>

      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <span className="tabular-nums">{format(startsAt, "EEE d MMM")}</span>
        {readOnly ? (
          <span className="tabular-nums">
            {format(startsAt, "HH:mm")} – {format(endsAt, "HH:mm")}
          </span>
        ) : (
          <>
            <TimeInput
              value={startsAt}
              onChange={(v) => changeTime("start", v)}
              label="Start time"
            />
            <span aria-hidden>–</span>
            <TimeInput value={endsAt} onChange={(v) => changeTime("end", v)} label="End time" />
          </>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {recurring ? (
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-900">
              Repeats
            </span>
          ) : null}
          {readOnly ? (
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-900">
              Google
            </span>
          ) : null}
        </span>
      </div>
    </header>
  );
}

function TimeInput({
  value,
  onChange,
  label,
}: {
  value: Date;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <input
      type="time"
      step={900}
      aria-label={label}
      value={format(value, "HH:mm")}
      onChange={(event) => onChange(event.currentTarget.value)}
      className="rounded-md bg-zinc-100 px-2 py-1 tabular-nums outline-none dark:bg-zinc-900"
    />
  );
}

function Body({ doc, onClose }: { doc: EventDocument; onClose: () => void }) {
  const [conflict, setConflict] = useState(false);

  const handleConflict = useCallback(() => setConflict(true), []);
  const { state, scheduleSave, flush } = useBodyAutosave({
    eventId: doc.id,
    initialRev: doc.bodyRev,
    onConflict: handleConflict,
  });

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      // Closing unmounts the editor, so anything pending has to go out first.
      void flush();
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flush, onClose]);

  return (
    <>
      {conflict ? (
        <p className="shrink-0 bg-amber-50 px-6 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          This block changed somewhere else. Nothing here is being saved — copy anything new, then
          reopen it.
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto py-4">
        <BlockEditor initialContent={doc.body} onChange={scheduleSave} />
      </div>

      <footer className="flex shrink-0 items-center justify-end border-t border-zinc-200 px-6 py-2 dark:border-zinc-800">
        <span
          className={cn(
            "text-xs",
            state === "error" || state === "conflict" ? "text-red-600" : "text-zinc-400",
          )}
        >
          {STATUS_LABEL[state]}
        </span>
      </footer>
    </>
  );
}
