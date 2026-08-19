"use client";

import { useRef, useState } from "react";

import type { DashboardField } from "@/lib/dashboard/field";
import {
  GRID_COLUMNS,
  gridHeight,
  groupRowsNeeded,
  MIN_H,
  MIN_W,
  normalise,
  toSingleColumn,
  type GridItem,
} from "@/lib/dashboard/grid";

import { FieldRow } from "./field-row";

/** One grid row in pixels at the top level. A field is this tall unresized. */
export const CELL_HEIGHT = 96;
export const GAP = 8;

/**
 * A group's rows are shorter than the dashboard's.
 *
 * A nested grid is drawn inside a card that is itself only a few rows tall, so
 * borrowing the outer row height would mean a group could never hold more than
 * one thing without being resized first.
 */
export const NESTED_CELL_HEIGHT = 64;

/** What the pointer is doing to a field, and where it grabbed it. */
type Gesture = {
  id: string;
  mode: "move" | "resize";
  /** Offset from the field's own origin, in grid units, so it doesn't jump on grab. */
  grabDX: number;
  grabDY: number;
};

/**
 * A free-form grid of fields, drawn and dragged.
 *
 * Extracted from the dashboard so a `group` field can host the very same surface
 * inside itself — same arithmetic, same gestures, same optimistic write path, at
 * a smaller row height. Everything positional lives in `lib/dashboard/grid.ts`;
 * this owns only pointer handling and drawing.
 *
 * `onSave` is passed in rather than called directly because the two surfaces
 * persist to different scopes: the dashboard writes its top-level boxes, a group
 * writes its children's.
 */
export function FieldGrid({
  fields,
  now,
  narrow,
  cellHeight = CELL_HEIGHT,
  depth = 0,
  onSave,
  onAddToGroup,
  onSaveChildren,
}: {
  fields: DashboardField[];
  now: Date;
  narrow: boolean;
  /** Shorter inside a group, whose card is only a few outer rows tall. */
  cellHeight?: number;
  /**
   * How many groups this grid sits inside — 0 on the dashboard itself.
   *
   * Carried down so a group can tell whether it is still allowed to offer
   * another group in its menu. The renderer recurses on the data; this is what
   * tells it when to stop.
   */
  depth?: number;
  onSave: (layout: GridItem[]) => void;
  onAddToGroup?: (groupId: string, kind: DashboardField["kind"]) => void;
  /** Saves one group's children. Distinct from `onSave`, which owns this surface. */
  onSaveChildren?: (groupId: string, layout: GridItem[]) => void;
}) {
  /**
   * The layout while a pointer is down, drawn before it is saved.
   *
   * Held locally for the length of the gesture and fired without awaiting, the
   * same rule every grid mutation follows — a drag that waited on Supabase would
   * lag a third of a second behind the finger.
   */
  const [draft, setDraft] = useState<GridItem[] | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const surface = useRef<HTMLDivElement>(null);

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
  const rowHeight = cellHeight + GAP;

  /**
   * On a phone a group is given the height its contents need.
   *
   * Its stored height was chosen on a desktop, beside other fields; here it has
   * the whole width to itself and anything that does not fit is cut off rather
   * than scrolled, because the card is `overflow-hidden` and the page does not
   * scroll. The nested grid's rows are shorter than this one's, hence the ratio.
   */
  const naturalHeight = (item: GridItem) => {
    const field = fields.find((entry) => entry.id === item.id);
    if (field?.kind !== "group" || field.children.length === 0) return item.h;

    const childRows = gridHeight(
      field.children.map((child) => ({
        id: child.id,
        x: child.x,
        y: child.y,
        w: child.w,
        h: child.h,
      })),
    );

    return groupRowsNeeded(childRows, (NESTED_CELL_HEIGHT + GAP) / rowHeight, item.h);
  };

  const drawn = narrow ? toSingleColumn(layout, naturalHeight) : layout;
  const rows = gridHeight(drawn);

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
    // A nested grid sits inside a draggable card. Without this the parent would
    // pick the whole group up the moment a child was grabbed.
    event.stopPropagation();

    const surfaceBox = element.getBoundingClientRect();
    const columnWidth = surfaceBox.width / GRID_COLUMNS;

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
      onSave(latest);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return (
    // Absolute-positioned rather than CSS Grid: a dragged field has to be
    // placeable at any cell mid-gesture, and `grid-column` cannot express
    // "follow the pointer" without a reflow on every move.
    <div
      ref={surface}
      className="relative"
      style={{ height: rows > 0 ? rows * rowHeight : undefined }}
    >
      {drawn.map((item) => {
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
              top: item.y * rowHeight,
              width: `${(item.w / GRID_COLUMNS) * 100}%`,
              height: item.h * rowHeight - GAP,
              paddingRight: item.x + item.w < GRID_COLUMNS ? GAP : 0,
              // Lifted above its neighbours while it is being carried.
              zIndex: active ? 20 : undefined,
              transitionDuration: active ? "0ms" : undefined,
            }}
          >
            <FieldRow
              field={field}
              now={now}
              narrow={narrow}
              pending={isPending}
              dragging={active}
              resizable={!narrow && !isPending}
              onDragStart={isPending ? undefined : (event) => startGesture(item.id, "move", event)}
              onResizeStart={
                isPending ? undefined : (event) => startGesture(item.id, "resize", event)
              }
              depth={depth}
              onAddToGroup={onAddToGroup}
              onSaveChildren={onSaveChildren}
            />
          </div>
        );
      })}
    </div>
  );
}

export function sameLayout(a: GridItem[], b: GridItem[]): boolean {
  if (a.length !== b.length) return false;

  const byId = new Map(b.map((item) => [item.id, item]));
  return a.every((item) => {
    const other = byId.get(item.id);
    return other?.x === item.x && other.y === item.y && other.w === item.w && other.h === item.h;
  });
}
