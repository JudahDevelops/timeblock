"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useToast } from "@/components/shell/toast";
import {
  formatNumber,
  formatRelativeDate,
  MAX_LIST_ITEMS,
  progressFraction,
  progressTone,
  NESTABLE_FIELD_KINDS,
  VALUE_SCALE_LABELS,
  VALUE_SCALES,
  type DashboardField,
  type FieldKind,
  type ValueScale,
} from "@/lib/dashboard/field";
import type { GridItem } from "@/lib/dashboard/grid";
import { deleteField, updateField } from "@/server/actions/dashboards";
import { cn } from "@/lib/utils";

import { AddField } from "./add-field";
import { FieldGrid, NESTED_CELL_HEIGHT } from "./field-grid";
import { CHECKBOX_SIZE, SCALE_TEXT, SCALE_TEXT_SOFT, TONE_FILL } from "./tone";
import { useInvalidateDashboards } from "./use-dashboards";

/**
 * One editable field.
 *
 * Writes follow the grid's rule rather than awaiting anything: the input already
 * shows what the user typed, the action is fired without `await`, and a failure
 * rolls the input back and says so. Nothing here blocks a keystroke on a
 * transatlantic round trip.
 */
export function FieldRow({
  field,
  now,
  onDragStart,
  onResizeStart,
  dragging,
  pending,
  resizable,
  narrow,
  onAddToGroup,
  onSaveChildren,
}: {
  field: DashboardField;
  now: Date;
  onDragStart?: (event: React.PointerEvent) => void;
  onResizeStart?: (event: React.PointerEvent) => void;
  dragging?: boolean;
  /** Drawn but not yet inserted: visible, and inert until it has a real id. */
  pending?: boolean;
  /** Desktop only — the phone's single column has no free positions to drag to. */
  resizable?: boolean;
  /** Passed through to a group's own grid, which collapses on a phone too. */
  narrow?: boolean;
  onAddToGroup?: (groupId: string, kind: FieldKind) => void;
  onSaveChildren?: (groupId: string, layout: GridItem[]) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const invalidate = useInvalidateDashboards();
  const [label, setLabel] = useState(field.label);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Gone from the list the instant it is clicked; back if the delete fails. */
  const [deleted, setDeleted] = useState(false);

  // The server row is the truth. When it changes underneath — another tab, a
  // rollback — the input follows it, unless the user is mid-edit in this one.
  const labelRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (document.activeElement !== labelRef.current) setLabel(field.label);
  }, [field.label]);

  const save = (
    patch: { label?: string; value?: unknown; config?: unknown; scale?: unknown },
    rollback: () => void,
  ) =>
    void updateField({ id: field.id, ...patch })
      .then(invalidate)
      .catch(() => {
        rollback();
        router.refresh();
        toast("Could not save that change.");
      });

  // After every hook, never before — hook order has to stay unconditional.
  if (deleted) return null;

  return (
    <div
      data-field-id={field.id}
      className={cn(
        // `surface-raised`, not `surface-sunken`: sunken is identical to surface
        // in the dark palette, so hovering a row there changed nothing at all.
        "border-line bg-surface group relative flex h-full flex-col overflow-hidden rounded-lg border px-3 py-2.5",
        // `ink-faint` on hover matches the Add-field button's border treatment.
        "hover:border-ink-faint hover:bg-surface-raised transition-colors",
        dragging && "border-ink-faint bg-surface-raised shadow-lg",
        // Inert while inserting: pointer events off is what stops a click from
        // naming a row id that does not exist on the server yet.
        pending && "pointer-events-none opacity-60",
      )}
      aria-busy={pending || undefined}
    >
      <div className="flex items-center gap-2">
        {onDragStart ? (
          <button
            type="button"
            aria-label={`Reorder ${field.label || "field"}`}
            onPointerDown={onDragStart}
            className="text-ink-faint hover:text-ink-muted -ml-1 shrink-0 cursor-grab touch-none p-1 transition-colors"
          >
            <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor" aria-hidden>
              <circle cx="6" cy="4" r="1.2" />
              <circle cx="10" cy="4" r="1.2" />
              <circle cx="6" cy="8" r="1.2" />
              <circle cx="10" cy="8" r="1.2" />
              <circle cx="6" cy="12" r="1.2" />
              <circle cx="10" cy="12" r="1.2" />
            </svg>
          </button>
        ) : null}

        <input
          ref={labelRef}
          value={label}
          placeholder="Untitled field"
          aria-label="Field label"
          onChange={(event) => setLabel(event.target.value)}
          onBlur={() => {
            if (label === field.label) return;
            const previous = field.label;
            save({ label }, () => setLabel(previous));
          }}
          // The label names the thing; the value is only its current reading. It
          // was the smallest, dimmest text on the card, which inverted that.
          // Full `text-ink` at `text-sm` semibold, no uppercase — small caps cost
          // legibility at this size and were doing the emphasis work that weight
          // and colour do better.
          className="text-ink placeholder:text-ink-faint min-w-0 flex-1 bg-transparent text-sm font-semibold tracking-tight outline-none"
        />

        {/* Every kind that draws a value of its own has at least a text size to
            set. A group draws its children instead, each carrying its own size,
            so there is nothing here for the gear to change. */}
        {field.kind === "group" ? null : (
          <button
            type="button"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-label="Field settings"
            aria-expanded={settingsOpen}
            className="text-ink-faint hover:text-ink shrink-0 p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          >
            <svg
              viewBox="0 0 16 16"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              aria-hidden
            >
              <circle cx="8" cy="8" r="2" />
              <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M13 3l-1.5 1.5M4.5 11.5L3 13" />
            </svg>
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            // Drawn gone before the write, like every grid mutation. The row is
            // restored rather than left in limbo if the server refuses.
            setDeleted(true);
            void deleteField(field.id)
              .then(() => {
                invalidate();
                router.refresh();
              })
              .catch(() => {
                setDeleted(false);
                toast("Could not delete that field.");
              });
          }}
          aria-label={`Delete ${field.label || "field"}`}
          className="text-ink-faint hover:text-danger shrink-0 p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          <svg
            viewBox="0 0 16 16"
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4M6.67 7.33v4M9.33 7.33v4M12.67 4v9.33a1.33 1.33 0 01-1.34 1.34H4.67a1.33 1.33 0 01-1.34-1.34V4" />
          </svg>
        </button>
      </div>

      {/* `px-1` pays for the `-mx-1` a list row uses to bleed its hover
          highlight to the card's edge — without it every row is 4px wider than
          this box on each side and the card scrolls sideways. `overflow-x-hidden`
          then backstops the other cause, a single unbroken word too long to
          wrap. Nothing here should ever move horizontally. */}
      <div className="mt-1.5 min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-1">
        <FieldValueEditor
          field={field}
          now={now}
          save={save}
          narrow={narrow}
          onAddToGroup={onAddToGroup}
          onSaveChildren={onSaveChildren}
        />
      </div>

      {settingsOpen ? (
        <FieldSettings field={field} save={save} onClose={() => setSettingsOpen(false)} />
      ) : null}

      {resizable && onResizeStart ? (
        <button
          type="button"
          aria-label={`Resize ${field.label || "field"}`}
          onPointerDown={onResizeStart}
          // Bottom-right, the corner every resizable thing has been grabbed by
          // for thirty years. Revealed on hover so a static dashboard is not
          // covered in handles.
          className="text-ink-faint hover:text-ink-muted absolute right-0.5 bottom-0.5 cursor-nwse-resize touch-none p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          <svg viewBox="0 0 10 10" className="size-2.5" fill="currentColor" aria-hidden>
            <circle cx="8" cy="8" r="1" />
            <circle cx="8" cy="4.5" r="1" />
            <circle cx="4.5" cy="8" r="1" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

type Save = (
  patch: { label?: string; value?: unknown; config?: unknown; scale?: unknown },
  rollback: () => void,
) => void;

/** The value affordance, chosen by kind — the whole point of picking a type. */
function FieldValueEditor({
  field,
  now,
  save,
  narrow,
  onAddToGroup,
  onSaveChildren,
}: {
  field: DashboardField;
  now: Date;
  save: Save;
  narrow?: boolean;
  onAddToGroup?: (groupId: string, kind: FieldKind) => void;
  onSaveChildren?: (groupId: string, layout: GridItem[]) => void;
}) {
  switch (field.kind) {
    case "number":
      return <NumberInput field={field} save={save} />;
    case "progress":
      return <ProgressInput field={field} save={save} />;
    case "text":
      return <TextInput field={field} save={save} />;
    case "date":
      return <DateInput field={field} now={now} save={save} />;
    case "checkbox":
      return <CheckboxInput field={field} save={save} />;
    case "list":
      return <ListInput field={field} save={save} />;
    case "group":
      return (
        <GroupSurface
          field={field}
          now={now}
          narrow={narrow}
          onAddToGroup={onAddToGroup}
          onSaveChildren={onSaveChildren}
        />
      );
  }
}

/**
 * A group's own grid, drawn inside the card.
 *
 * The same `FieldGrid` the dashboard uses, at a shorter row height — so a client
 * card can be moved and resized within its group exactly as the group is within
 * the dashboard.
 *
 * This and `field-grid` import each other, which is safe only because neither
 * touches the other during module evaluation: both references are resolved when
 * a component renders, by which point both modules have finished loading. The
 * recursion terminates on the data, not on a depth counter — a group is never
 * offered inside a group, so `children` is always empty one level down.
 */
function GroupSurface({
  field,
  now,
  narrow,
  onAddToGroup,
  onSaveChildren,
}: {
  field: Extract<DashboardField, { kind: "group" }>;
  now: Date;
  narrow?: boolean;
  onAddToGroup?: (groupId: string, kind: FieldKind) => void;
  onSaveChildren?: (groupId: string, layout: GridItem[]) => void;
}) {
  return (
    <div className="flex h-full flex-col gap-1.5">
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {field.children.length > 0 ? (
          <FieldGrid
            fields={field.children}
            now={now}
            narrow={narrow ?? false}
            cellHeight={NESTED_CELL_HEIGHT}
            onSave={(layout) => onSaveChildren?.(field.id, layout)}
          />
        ) : (
          <p className="text-ink-faint py-2 text-center text-xs">Nothing in here yet.</p>
        )}
      </div>

      {onAddToGroup ? (
        <AddField
          compact
          label="Add to group"
          kinds={NESTABLE_FIELD_KINDS}
          onPick={(kind) => onAddToGroup(field.id, kind)}
        />
      ) : null}
    </div>
  );
}

function NumberInput({
  field,
  save,
}: {
  field: Extract<DashboardField, { kind: "number" }>;
  save: Save;
}) {
  const [draft, setDraft] = useState(field.value === null ? "" : String(field.value));
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (document.activeElement !== input.current) {
      setDraft(field.value === null ? "" : String(field.value));
    }
  }, [field.value]);

  const { prefix, suffix } = field.config;

  return (
    <div className="flex items-baseline gap-1">
      {/* Prefix and unit track the value one notch down, so a huge figure does
          not end up wearing a tiny currency mark. */}
      {prefix ? (
        <span className={cn("text-ink-muted shrink-0", SCALE_TEXT_SOFT[field.scale])}>
          {prefix}
        </span>
      ) : null}
      <input
        ref={input}
        value={draft}
        inputMode="decimal"
        placeholder="—"
        aria-label={field.label || "Value"}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const previous = field.value === null ? "" : String(field.value);
          if (draft === previous) return;
          save({ value: draft }, () => setDraft(previous));
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className={cn(
          "text-ink placeholder:text-ink-faint min-w-0 flex-1 bg-transparent font-semibold tabular-nums outline-none",
          SCALE_TEXT[field.scale],
        )}
      />
      {suffix ? (
        <span className={cn("text-ink-muted shrink-0", SCALE_TEXT_SOFT[field.scale])}>
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

function ProgressInput({
  field,
  save,
}: {
  field: Extract<DashboardField, { kind: "progress" }>;
  save: Save;
}) {
  const [draft, setDraft] = useState(field.value === null ? "" : String(field.value));
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (document.activeElement !== input.current) {
      setDraft(field.value === null ? "" : String(field.value));
    }
  }, [field.value]);

  const fraction = progressFraction(field);
  const tone = progressTone(fraction, field.config.invert);

  return (
    <div>
      <div className="flex items-baseline gap-1">
        <input
          ref={input}
          value={draft}
          inputMode="decimal"
          placeholder="—"
          aria-label={field.label || "Value"}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            const previous = field.value === null ? "" : String(field.value);
            if (draft === previous) return;
            save({ value: draft }, () => setDraft(previous));
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          // Sized in `ch` so the field grows with the scale but still leaves the
          // target and the percentage room, which `flex-1` would swallow.
          style={{ width: "5ch" }}
          className={cn(
            "text-ink placeholder:text-ink-faint min-w-0 shrink bg-transparent font-semibold tabular-nums outline-none",
            SCALE_TEXT[field.scale],
          )}
        />
        <span
          className={cn(
            "text-ink-faint min-w-0 shrink truncate tabular-nums",
            SCALE_TEXT_SOFT[field.scale],
          )}
        >
          / {formatNumber(field.config.target)}
          {field.config.suffix ? ` ${field.config.suffix}` : ""}
        </span>
        <span className="text-ink-muted ml-auto shrink-0 text-xs tabular-nums">
          {Math.round(fraction * 100)}%
        </span>
      </div>

      {/* Shape first: the bar is what is read, the percentage only confirms it. */}
      <div
        className="bg-surface-sunken mt-1.5 h-1.5 w-full overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={Math.round(fraction * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={field.label || "Progress"}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width,background-color] duration-300",
            TONE_FILL[tone],
          )}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
    </div>
  );
}

function TextInput({
  field,
  save,
}: {
  field: Extract<DashboardField, { kind: "text" }>;
  save: Save;
}) {
  const [draft, setDraft] = useState(field.value ?? "");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (document.activeElement !== input.current) setDraft(field.value ?? "");
  }, [field.value]);

  return (
    <input
      ref={input}
      value={draft}
      placeholder="—"
      aria-label={field.label || "Value"}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const previous = field.value ?? "";
        if (draft === previous) return;
        save({ value: draft }, () => setDraft(previous));
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className={cn(
        "text-ink placeholder:text-ink-faint w-full bg-transparent outline-none",
        SCALE_TEXT_SOFT[field.scale],
      )}
    />
  );
}

function DateInput({
  field,
  now,
  save,
}: {
  field: Extract<DashboardField, { kind: "date" }>;
  now: Date;
  save: Save;
}) {
  return (
    <div className="flex items-baseline gap-3">
      {/* The relative reading is the value; the picker is how you change it. */}
      <span
        className={cn("text-ink min-w-0 shrink truncate font-semibold", SCALE_TEXT[field.scale])}
      >
        {field.value ? formatRelativeDate(field.value, now) : "—"}
      </span>
      <input
        type="date"
        value={field.value ?? ""}
        aria-label={field.label || "Date"}
        onChange={(event) => {
          const next = event.target.value || null;
          save({ value: next }, () => {});
        }}
        className="text-ink-faint hover:text-ink-muted ml-auto min-w-0 bg-transparent text-xs transition-colors outline-none"
      />
    </div>
  );
}

function CheckboxInput({
  field,
  save,
}: {
  field: Extract<DashboardField, { kind: "checkbox" }>;
  save: Save;
}) {
  /**
   * The box the user clicked, held only until the server row agrees.
   *
   * A checkbox has nothing half-typed to protect, so the prop stays the truth and
   * this is a pure override rather than a copy kept in sync by an effect — which
   * is what `react-hooks/set-state-in-effect` exists to prevent.
   */
  const [pending, setPending] = useState<{ from: boolean | null; to: boolean } | null>(null);

  const server = field.value ?? false;
  const checked = pending && pending.from === field.value ? pending.to : server;

  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          const next = event.target.checked;
          setPending({ from: field.value, to: next });
          save({ value: next }, () => setPending(null));
        }}
        className={cn("accent-now cursor-pointer", CHECKBOX_SIZE[field.scale])}
      />
      <span className={cn(SCALE_TEXT_SOFT[field.scale], checked ? "text-ink" : "text-ink-muted")}>
        {checked ? "Done" : "Not done"}
      </span>
    </label>
  );
}

/**
 * One list item, editable where it sits.
 *
 * Wrapping is the whole point: an item that ran past the card used to be reached
 * by dragging the row sideways, inside a card only a few columns wide. So this is
 * a `contentEditable` span rather than an `input` — an input is a single line by
 * construction, and a `textarea` would need its height measured from
 * `scrollHeight` on every keystroke *and* on first paint, which is a ref write
 * during render the compiler lint rejects. A span simply wraps and is as tall as
 * its text, with no measuring anywhere.
 *
 * `suppressContentEditableWarning` because React will not diff the children of an
 * element the browser is also editing — which is exactly what we want here: the
 * DOM owns the text mid-edit, and `key` on the parent restores it if the write
 * fails.
 */
function ListItemInput({
  value,
  scale,
  label,
  onCommit,
}: {
  value: string;
  scale: ValueScale;
  label: string;
  onCommit: (next: string) => void;
}) {
  return (
    <span
      role="textbox"
      tabIndex={0}
      contentEditable
      suppressContentEditableWarning
      aria-label={`Edit item in ${label || "list"}`}
      onBlur={(event) => {
        const next = event.currentTarget.textContent ?? "";
        if (next === value) return;
        onCommit(next);
      }}
      onKeyDown={(event) => {
        // Enter commits rather than opening a second line: the field holds a
        // list of short items, and a newline inside one has nowhere to go.
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.currentTarget.textContent = value;
          event.currentTarget.blur();
        }
      }}
      className={cn(
        // `min-w-0` lets this flex child shrink below its content width, which
        // is the precondition for wrapping at all; `break-words` then breaks a
        // run of text too long to fit even so. Without both, a long client name
        // sets the row's width and the card either scrolls sideways or clips the
        // text at both ends.
        "text-ink w-0 min-w-0 flex-1 leading-relaxed break-words whitespace-pre-wrap outline-none",
        SCALE_TEXT_SOFT[scale],
      )}
    >
      {value}
    </span>
  );
}

function ListInput({
  field,
  save,
}: {
  field: Extract<DashboardField, { kind: "list" }>;
  save: Save;
}) {
  const items = field.value ?? [];
  const [entry, setEntry] = useState("");

  const commit = (next: string[]) => {
    save({ value: next }, () => {});
  };

  return (
    <div>
      {items.length > 0 ? (
        <ul className="mb-1.5 space-y-0.5">
          {items.map((item, index) => (
            // Keyed by content as well as position. React will not diff the
            // children of a `contentEditable`, so after a delete the surviving
            // spans would keep whatever text the browser left in them; changing
            // the key is what forces them to remount and re-read the row. Safe
            // for typing, which never re-renders this list — the edit lives in
            // the DOM until blur.
            <li
              key={`${index}:${item}`}
              className="group/item hover:bg-surface-raised -mx-1 flex items-start gap-2 rounded px-1 py-0.5 transition-colors"
            >
              <span aria-hidden className="text-ink-faint shrink-0 text-xs leading-relaxed">
                ·
              </span>
              <ListItemInput
                value={item}
                scale={field.scale}
                label={field.label}
                onCommit={(next) => {
                  // An item emptied out is a deletion. Otherwise typing the text
                  // away would leave a blank bullet that has to be removed by
                  // hand anyway.
                  const trimmed = next.trim();
                  commit(
                    trimmed
                      ? items.map((existing, i) => (i === index ? trimmed : existing))
                      : items.filter((_, i) => i !== index),
                  );
                }}
              />
              <button
                type="button"
                aria-label={`Remove ${item}`}
                onClick={() => commit(items.filter((_, i) => i !== index))}
                className="text-ink-faint hover:text-danger shrink-0 rounded px-1 text-xs opacity-0 transition-opacity group-hover/item:opacity-100 focus-visible:opacity-100"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {items.length < MAX_LIST_ITEMS ? (
        // A `textarea`, not an `input`: a single-line input scrolls sideways by
        // construction, so a name longer than the card could only be read by
        // dragging the text through a slot. This wraps instead, like the
        // committed items directly above it. Enter still commits — `rows={1}`
        // and the Enter guard keep it behaving as one line that happens to wrap.
        <textarea
          value={entry}
          rows={1}
          placeholder="Add an item…"
          aria-label={`Add to ${field.label || "list"}`}
          onChange={(event) => setEntry(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const trimmed = entry.trim();
            if (!trimmed) return;
            // Cleared straight away so the next item can be typed immediately,
            // rather than waiting for the server to confirm the previous one.
            setEntry("");
            commit([...items, trimmed]);
          }}
          className={cn(
            "text-ink placeholder:text-ink-faint field-sizing-content w-full resize-none bg-transparent break-words outline-none",
            SCALE_TEXT_SOFT[field.scale],
          )}
        />
      ) : null}
    </div>
  );
}

/**
 * Size, unit, prefix and target. Tucked behind a toggle: set once, then rarely
 * touched. Size comes first because every kind has one, and the rest are the
 * per-kind extras layered after it.
 *
 * Laid over the card rather than appended below it. The card's height is set by
 * the grid, in whole rows, and it clips — so a panel in the normal flow was
 * pushed straight past the bottom edge and cut off, with the settings that
 * happened to be last unreachable at any field size. Overlaying means the panel
 * is bounded by the card instead of by whatever room the value left over, and it
 * scrolls inside that bound when even the whole card is not tall enough.
 */
function FieldSettings({
  field,
  save,
  onClose,
}: {
  field: DashboardField;
  save: Save;
  onClose: () => void;
}) {
  return (
    <div className="bg-surface-raised border-line-soft absolute inset-x-0 bottom-0 z-10 max-h-full overflow-y-auto border-t px-3 py-2 shadow-lg">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
          <ScalePicker field={field} save={save} />
          <KindSettings field={field} save={save} />
        </div>

        {/* The gear that opened this is behind the panel on a short field, so
            closing it needs its own way out. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close field settings"
          className="text-ink-faint hover:text-ink shrink-0 p-0.5 transition-colors"
        >
          <svg
            viewBox="0 0 16 16"
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/** The text size, as four labelled steps rather than a number to guess at. */
function ScalePicker({ field, save }: { field: DashboardField; save: Save }) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-ink-faint text-xs">Size</span>
      <select
        value={field.scale}
        aria-label="Text size"
        onChange={(event) => save({ scale: event.target.value }, () => {})}
        className="border-line text-ink rounded border bg-transparent px-1.5 py-0.5 text-xs outline-none"
      >
        {VALUE_SCALES.map((scale) => (
          <option key={scale} value={scale}>
            {VALUE_SCALE_LABELS[scale]}
          </option>
        ))}
      </select>
    </label>
  );
}

function KindSettings({ field, save }: { field: DashboardField; save: Save }) {
  if (field.kind === "number") {
    return (
      <>
        <SettingInput
          label="Prefix"
          defaultValue={field.config.prefix ?? ""}
          placeholder="$"
          onCommit={(value) => save({ config: { ...field.config, prefix: value } }, () => {})}
        />
        <SettingInput
          label="Unit"
          defaultValue={field.config.suffix ?? ""}
          placeholder="kg"
          onCommit={(value) => save({ config: { ...field.config, suffix: value } }, () => {})}
        />
        <SettingInput
          label="Decimals"
          defaultValue={field.config.decimals === undefined ? "" : String(field.config.decimals)}
          placeholder="0"
          onCommit={(value) =>
            save(
              { config: { ...field.config, decimals: value === "" ? undefined : Number(value) } },
              () => {},
            )
          }
        />
      </>
    );
  }

  if (field.kind === "progress") {
    return (
      <>
        <SettingInput
          label="Target"
          defaultValue={String(field.config.target)}
          placeholder="100"
          onCommit={(value) =>
            save({ config: { ...field.config, target: Number(value) } }, () => {})
          }
        />
        <SettingInput
          label="Unit"
          defaultValue={field.config.suffix ?? ""}
          placeholder="km"
          onCommit={(value) => save({ config: { ...field.config, suffix: value } }, () => {})}
        />
        {/* Which end is the good end. Phrased as the question rather than as
            "invert", which says nothing about what it will do to the bar. */}
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={field.config.invert ?? false}
            onChange={(event) =>
              save({ config: { ...field.config, invert: event.target.checked } }, () => {})
            }
            className="accent-now size-3.5 cursor-pointer"
          />
          <span className="text-ink-faint text-xs">Lower is better</span>
        </label>
      </>
    );
  }

  // The other kinds have nothing beyond their size, which the picker beside
  // this already owns.
  return null;
}

function SettingInput({
  label,
  defaultValue,
  placeholder,
  onCommit,
}: {
  label: string;
  defaultValue: string;
  placeholder: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(defaultValue);

  return (
    <label className="flex items-center gap-1.5">
      <span className="text-ink-faint text-xs">{label}</span>
      <input
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== defaultValue) onCommit(draft.trim());
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="border-line text-ink placeholder:text-ink-faint w-16 rounded border bg-transparent px-1.5 py-0.5 text-xs outline-none"
      />
    </label>
  );
}
