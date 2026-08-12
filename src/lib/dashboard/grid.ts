/**
 * Free-form dashboard layout, as pure arithmetic.
 *
 * The grid is column-based rather than pixel-based: a field stores `{x, y, w, h}`
 * in grid units, so the same layout renders at any width and survives a device
 * change. Pixels only exist at the edges, in `pointToCell`, where a pointer has
 * to be turned into a column.
 *
 * Everything here is a pure function over plain objects — no React, no DOM, no
 * clock — which is what keeps the interaction layer thin enough to trust and this
 * file exhaustively testable. Same split as `calendar/geometry.ts`.
 */

/** Twelve divides by 2, 3, 4 and 6, so halves, thirds and quarters all land clean. */
export const GRID_COLUMNS = 12;

/** Smallest usable field: a third of the width, one row tall. */
export const MIN_W = 2;
export const MIN_H = 1;

export type GridBox = { x: number; y: number; w: number; h: number };
export type GridItem = GridBox & { id: string };

/** Clamps a box to the grid: never negative, never wider than the grid. */
export function clampBox(box: GridBox): GridBox {
  const w = Math.max(MIN_W, Math.min(GRID_COLUMNS, Math.round(box.w)));
  const h = Math.max(MIN_H, Math.round(box.h));
  const x = Math.max(0, Math.min(GRID_COLUMNS - w, Math.round(box.x)));
  const y = Math.max(0, Math.round(box.y));

  return { x, y, w, h };
}

/** Do two boxes share any cell? Touching edges do not count. */
export function overlaps(a: GridBox, b: GridBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Resolves overlaps by pushing downward, never sideways.
 *
 * Vertical-only is a deliberate limit rather than a simplification: a sideways
 * push changes a field's column, which is the thing the user chose most
 * deliberately, and it cascades unpredictably once the row is full. Pushing down
 * always terminates — the grid has no bottom — and reads as "things moved out of
 * the way" rather than "my layout rearranged itself".
 *
 * `anchorId` is the field being dragged: it holds its position and everything
 * else yields to it.
 */
export function resolveCollisions(items: GridItem[], anchorId?: string): GridItem[] {
  // Anchor first, then top-to-bottom. Sorting by `y` is what makes the sweep
  // single-pass: an item can only ever be pushed by one already placed above it.
  const ordered = [...items].sort((a, b) => {
    if (a.id === anchorId) return -1;
    if (b.id === anchorId) return 1;
    return a.y - b.y || a.x - b.x;
  });

  const placed: GridItem[] = [];

  for (const item of ordered) {
    const next = { ...item };

    // Drop it until it clears everything already placed. Re-checked from the
    // start after each move, since sliding down can meet a new neighbour.
    let moved = true;
    while (moved) {
      moved = false;
      for (const other of placed) {
        if (overlaps(next, other)) {
          next.y = other.y + other.h;
          moved = true;
        }
      }
    }

    placed.push(next);
  }

  return placed;
}

/**
 * Pulls every field up into the gaps left behind, preserving order.
 *
 * Without this a layout slowly fills with holes: delete a field from the top and
 * everything below stays where it was, stranded under empty space.
 */
export function compact(items: GridItem[]): GridItem[] {
  const ordered = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: GridItem[] = [];

  for (const item of ordered) {
    const next = { ...item };

    // Rise while the cell above is free.
    while (next.y > 0) {
      const lifted = { ...next, y: next.y - 1 };
      if (placed.some((other) => overlaps(lifted, other))) break;
      next.y = lifted.y;
    }

    placed.push(next);
  }

  return placed;
}

/**
 * Clamp, resolve, then compact — the pipeline every layout change goes through.
 *
 * The result is returned in the caller's original order, not the sorted order the
 * passes work in. Both `resolveCollisions` and `compact` sort by position to make
 * their sweeps single-pass, which would otherwise mean a settled layout came back
 * shuffled and every caller diffing arrays saw a change that never happened.
 */
export function normalise(items: GridItem[], anchorId?: string): GridItem[] {
  const clamped = items.map((item) => ({ ...item, ...clampBox(item) }));
  const placed = compact(resolveCollisions(clamped, anchorId));
  const byId = new Map(placed.map((item) => [item.id, item]));

  return items.map((item) => byId.get(item.id) ?? item);
}

/**
 * Where a pointer sits, in grid units.
 *
 * `cellHeight` comes from the caller because it is a rendering choice, not a
 * property of the grid — the engine has no opinion about how tall a row looks.
 */
export function pointToCell(
  offsetX: number,
  offsetY: number,
  width: number,
  cellHeight: number,
): { x: number; y: number } {
  const columnWidth = width / GRID_COLUMNS;

  return {
    x: Math.max(0, Math.min(GRID_COLUMNS - 1, Math.floor(offsetX / Math.max(1, columnWidth)))),
    y: Math.max(0, Math.floor(offsetY / Math.max(1, cellHeight))),
  };
}

/**
 * A single ordered column, for phones.
 *
 * Free-form placement is a desktop affordance; reading order on a narrow screen
 * is top-to-bottom, then left-to-right, exactly how the eye already scans it.
 */
export function toSingleColumn(items: GridItem[]): GridItem[] {
  return [...items]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((item, index) => ({ ...item, x: 0, y: index, w: GRID_COLUMNS, h: item.h }));
}

/** How many rows the layout occupies, for sizing the container. */
export function gridHeight(items: GridItem[]): number {
  return items.reduce((tallest, item) => Math.max(tallest, item.y + item.h), 0);
}

/** The first free spot for a new field, scanning left-to-right then down. */
export function firstFreeSlot(items: GridItem[], w: number, h: number): { x: number; y: number } {
  const width = Math.max(MIN_W, Math.min(GRID_COLUMNS, w));
  const height = Math.max(MIN_H, h);

  // Bounded by the current height: one row past the bottom is always free.
  for (let y = 0; y <= gridHeight(items); y += 1) {
    for (let x = 0; x <= GRID_COLUMNS - width; x += 1) {
      const candidate = { x, y, w: width, h: height };
      if (!items.some((item) => overlaps(candidate, item))) return { x, y };
    }
  }

  return { x: 0, y: gridHeight(items) };
}
