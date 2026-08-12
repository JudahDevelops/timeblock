"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useToast } from "@/components/shell/toast";
import {
  DEFAULT_FIELD_H,
  DEFAULT_FIELD_W,
  defaultsFor,
  type DashboardField,
  type FieldKind,
} from "@/lib/dashboard/field";
import {
  firstFreeSlot,
  GRID_COLUMNS,
  gridHeight,
  MIN_H,
  MIN_W,
  normalise,
  toSingleColumn,
  type GridItem,
} from "@/lib/dashboard/grid";
import { useMediaQuery } from "@/lib/use-media-query";
import { createField, updateFieldLayout, updateDashboard } from "@/server/actions/dashboards";
import type { DashboardDetail } from "@/server/queries/dashboards";

import { AddField } from "./add-field";
import { FieldRow } from "./field-row";
import { useInvalidateDashboards } from "./use-dashboards";

/** A field drawn before its insert has returned, with the count that retires it. */
type PendingField = { countWhenAdded: number; field: DashboardField };

/** One grid row in pixels. A field is this tall before anyone resizes it. */
const CELL_HEIGHT = 96;
const GAP = 8;

/** What the pointer is doing to a field, and where it grabbed it. */
type Gesture = {
  id: string;
  mode: "move" | "resize";
  /** Offset from the field's own origin, in grid units, so it doesn't jump on grab. */
  grabDX: number;
  grabDY: number;
};

/**
 * One dashboard, as a free-form grid.
 *
 * Fields are placed and sized in grid units — never pixels — which is what lets
 * the same layout render at any width and collapse to a readable column on a
 * phone. All the arithmetic lives in `lib/dashboard/grid.ts`; this file owns
 * only the pointer handling and the drawing.
 */
export function DashboardView({ dashboard, now }: { dashboard: DashboardDetail; now: Date }) {
  const router = useRouter();
  const toast = useToast();
  const invalidate = useInvalidateDashboards();
  const [name, setName] = useState(dashboard.name);

  /**
   * The layout while a pointer is down, drawn before it is saved.
   *
   * Held locally for the length of the gesture and fired without awaiting, the
   * same rule every grid mutation follows — a drag that waited on Supabase would
   * lag a third of a second behind the finger.
   */
  const [draft, setDraft] = useState<GridItem[] | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);

  /** Fields drawn before the insert has come back. See `handleAdd`. */
  const [adding, setAdding] = useState<PendingField[]>([]);

  const surface = useRef<HTMLDivElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (document.activeElement !== nameInput.current) setName(dashboard.name);
  }, [dashboard.name]);

  // Free-form placement is a desktop affordance. A phone gets one ordered
  // column, which is how the eye reads it anyway.
  const narrow = !useMediaQuery("(min-width: 640px)", true);

  const stillPending = adding.filter((entry) => dashboard.fields.length <= entry.countWhenAdded);
  const fields = [...dashboard.fields, ...stillPending.map((entry) => entry.field)];

  /**
   * The layout as drawn: the dragged one if it still describes these fields,
   * otherwise the server's.
   *
   * Derived rather than reconciled in an effect. A draft that has been overtaken
   * — the write landed, or a field was added or removed elsewhere — simply stops
   * matching and the server's layout takes over on the next render, with no
   * `setState` in an effect to trigger a cascading one.
   */
  const layout = (() => {
    const fromServer: GridItem[] = fields.map((field) => ({
      id: field.id,
      x: field.x,
      y: field.y,
      w: field.w,
      h: field.h,
    }));

    if (!draft) return normalise(fromServer);

    const ids = new Set(fromServer.map((item) => item.id));
    const stillValid =
      draft.length === fromServer.length && draft.every((item) => ids.has(item.id));

    return stillValid ? draft : normalise(fromServer);
  })();

  const boxes = new Map(layout.map((item) => [item.id, item]));
  const rows = gridHeight(narrow ? toSingleColumn(layout) : layout);

  const handleAdd = (kind: FieldKind) => {
    const { config, value } = defaultsFor(kind);
    const id = `pending:${crypto.randomUUID()}`;
    const slot = firstFreeSlot(layout, DEFAULT_FIELD_W, DEFAULT_FIELD_H);
    const entry: PendingField = {
      countWhenAdded: dashboard.fields.length + adding.length,
      field: {
        id,
        label: "",
        kind,
        config,
        value,
        position: fields.length,
        ...slot,
        w: DEFAULT_FIELD_W,
        h: DEFAULT_FIELD_H,
      } as DashboardField,
    };

    setAdding((current) => [...current, entry]);

    // Fired without awaiting: the field is already on screen, so a round trip
    // between the click and the first sight of it buys nothing.
    void createField({ dashboardId: dashboard.id, kind })
      .then(() => {
        invalidate();
        router.refresh();
        setAdding((current) => current.filter((pending) => pending.field.id !== id));
      })
      .catch(() => {
        setAdding((current) => current.filter((pending) => pending.field.id !== id));
        toast("Could not add that field.");
      });
  };

  const save = (next: GridItem[]) => {
    const previous = layout;

    void updateFieldLayout({
      dashboardId: dashboard.id,
      layout: next.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })),
    })
      .then(() => {
        invalidate();
        router.refresh();
      })
      .catch(() => {
        setDraft(previous);
        router.refresh();
        toast("Could not save the layout.");
      });
  };

  /**
   * Move or resize, driven by the pointer.
   *
   * Both gestures are the same loop over `normalise`: the only difference is
   * whether the pointer changes the box's origin or its size. Column width is
   * measured per gesture rather than stored, since the surface is fluid.
   */
  const startGesture = (id: string, mode: "move" | "resize", event: React.PointerEvent) => {
    // The phone's single column is not draggable: positions are derived there,
    // so a drag would write a layout the user cannot see the effect of.
    if (narrow) return;

    const box = boxes.get(id);
    const element = surface.current;
    if (!box || !element) return;

    event.preventDefault();

    const surfaceBox = element.getBoundingClientRect();
    const columnWidth = surfaceBox.width / GRID_COLUMNS;
    const rowHeight = CELL_HEIGHT + GAP;

    const pointerX = (event.clientX - surfaceBox.left) / columnWidth;
    const pointerY = (event.clientY - surfaceBox.top) / rowHeight;

    // Where inside the field it was grabbed, so it does not snap its corner to
    // the cursor the instant the drag begins.
    const start: Gesture = {
      id,
      mode,
      grabDX: pointerX - box.x,
      grabDY: pointerY - box.y,
    };
    setGesture(start);

    let latest = layout;

    const onMove = (move: PointerEvent) => {
      const x = (move.clientX - surfaceBox.left) / columnWidth;
      const y = (move.clientY - surfaceBox.top) / rowHeight;

      const proposed =
        mode === "move"
          ? { ...box, x: Math.round(x - start.grabDX), y: Math.round(y - start.grabDY) }
          : {
              ...box,
              w: Math.max(MIN_W, Math.round(x - box.x)),
              h: Math.max(MIN_H, Math.round(y - box.y)),
            };

      latest = normalise(
        layout.map((item) => (item.id === id ? { ...item, ...proposed } : item)),
        id,
      );
      setDraft(latest);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setGesture(null);

      if (sameLayout(latest, layout)) return;
      save(latest);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <input
        ref={nameInput}
        value={name}
        placeholder="Untitled dashboard"
        aria-label="Dashboard name"
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          if (name === dashboard.name) return;
          const previous = dashboard.name;
          void updateDashboard({ id: dashboard.id, name })
            .then(invalidate)
            .catch(() => {
              setName(previous);
              router.refresh();
              toast("Could not rename the dashboard.");
            });
        }}
        className="text-ink placeholder:text-ink-faint w-full bg-transparent text-2xl font-semibold tracking-tight outline-none"
      />

      {/* The grid is absolute-positioned rather than CSS Grid: a dragged field
          has to be placeable at any cell mid-gesture, and `grid-column` cannot
          express "follow the pointer" without a reflow on every move. */}
      <div
        ref={surface}
        className="relative mt-5"
        style={{ height: rows > 0 ? rows * (CELL_HEIGHT + GAP) : undefined }}
      >
        {(narrow ? toSingleColumn(layout) : layout).map((item) => {
          const field = fields.find((entry) => entry.id === item.id);
          if (!field) return null;

          const isPending = field.id.startsWith("pending:");
          const active = gesture?.id === item.id;

          return (
            <div
              key={item.id}
              className="absolute transition-[left,top,width,height] duration-150"
              style={{
                left: `${(item.x / GRID_COLUMNS) * 100}%`,
                top: item.y * (CELL_HEIGHT + GAP),
                width: `${(item.w / GRID_COLUMNS) * 100}%`,
                height: item.h * (CELL_HEIGHT + GAP) - GAP,
                paddingRight: item.x + item.w < GRID_COLUMNS ? GAP : 0,
                // Lifted above its neighbours while it is being carried.
                zIndex: active ? 20 : undefined,
                transitionDuration: active ? "0ms" : undefined,
              }}
            >
              <FieldRow
                field={field}
                now={now}
                pending={isPending}
                dragging={active}
                resizable={!narrow && !isPending}
                onDragStart={
                  isPending ? undefined : (event) => startGesture(item.id, "move", event)
                }
                onResizeStart={
                  isPending ? undefined : (event) => startGesture(item.id, "resize", event)
                }
              />
            </div>
          );
        })}
      </div>

      {/* Not disabled while a field is in flight: each click already draws its
          own field, so several can be added without waiting between them. */}
      <div className="mt-3">
        <AddField onPick={handleAdd} />
      </div>

      {fields.length === 0 ? (
        <p className="text-ink-faint mt-6 text-center text-sm">
          Nothing tracked yet. Add a field and pick what kind of thing it is.
        </p>
      ) : null}
    </div>
  );
}

function sameLayout(a: GridItem[], b: GridItem[]): boolean {
  if (a.length !== b.length) return false;

  const byId = new Map(b.map((item) => [item.id, item]));
  return a.every((item) => {
    const other = byId.get(item.id);
    return other?.x === item.x && other.y === item.y && other.w === item.w && other.h === item.h;
  });
}
