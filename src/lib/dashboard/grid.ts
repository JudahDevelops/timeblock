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

/**
 * Twenty-four divides by 2, 3, 4, 6 and 8, so halves, thirds, quarters and
 * eighths all land clean.
 *
 * Doubled from twelve, which was too coarse to place a small reading precisely:
 * the narrowest field a twelve-column grid can express is a sixth of the width,
 * and a number with a two-word label does not need that much room. Doubling
 * rather than picking some other number is what made the migration exact —
 * every stored `grid_x` and `grid_w` scaled by two with nothing to round.
 */
export const GRID_COLUMNS = 24;

/**
 * Smallest usable field: a sixth of the width, one row tall.
 *
 * `MIN_H` stays at one even though every stored height doubled — a row is now
 * half what it was, and being able to ask for a single one of them is the point
 * of halving it. A one-row field is 44px, which still holds a label and a
 * reading on one line.
 */
export const MIN_W = 4;
export const MIN_H = 1;

/** What the grid was before it was doubled. See `scaleToColumns`. */
export const PREVIOUS_GRID_COLUMNS = 12;

/**
 * The gap between two boxes, in pixels.
 *
 * Lives here rather than in the component because it is inside the row: a
 * field's height is `h * (CELL_HEIGHT + GAP) - GAP`, so the gap is part of the
 * arithmetic that decides whether a layout keeps its geometry, not a decoration
 * applied afterwards.
 */
export const GAP = 8;

/**
 * One grid row in pixels at the top level.
 *
 * Halved along with the column count, so a field can be half a row tall rather
 * than rounded up to a whole one. 44 rather than 48 because it is the *row* —
 * `CELL_HEIGHT + GAP` — that has to halve: 44 + 8 is 52, exactly half of the 104
 * this grid used to step by, so every migrated box lands on the pixel it already
 * occupied. 48 would have made the row 56 and grown every card by 8px per row it
 * spans.
 */
export const CELL_HEIGHT = 44;

/**
 * A group's rows are shorter than the dashboard's.
 *
 * A nested grid is drawn inside a card that is itself only a few rows tall, so
 * borrowing the outer row height would mean a group could never hold more than
 * one thing without being resized first. 28 + 8 is 36, half of the 72 it was,
 * for the same reason as above.
 */
export const NESTED_CELL_HEIGHT = 28;

/** What a row measured before it was halved. See `scaleRows`. */
export const PREVIOUS_ROW_HEIGHT = 104;

export type GridBox = { x: number; y: number; w: number; h: number };
export type GridItem = GridBox & { id: string };

/**
 * A box expressed in one column count, re-expressed in another.
 *
 * This is the arithmetic `drizzle/0009_*.sql` performs against every stored row,
 * written here so it can be tested rather than trusted. The migration is a
 * one-way, non-idempotent write over real dashboards, and the failure it has to
 * be proved against is silent: a doubled box whose right edge exceeded the grid
 * would be shrunk by `clampBox`, and `updateFieldLayout` re-clamps server-side,
 * so the first drag afterwards would persist the loss with nothing to undo it.
 *
 * Exact only when the counts are whole multiples — which is the reason 24 was
 * chosen over any other number. Heights are untouched: this scales the
 * horizontal axis alone, matching the migration.
 */
export function scaleToColumns(box: GridBox, from: number, to: number): GridBox {
  const factor = to / from;
  return { ...box, x: Math.round(box.x * factor), w: Math.round(box.w * factor) };
}

/**
 * The same, down the other axis.
 *
 * Rows have no count to scale against — the grid has no bottom — so this takes
 * the factor directly. It exists because halving the row *height* means every
 * stored `y` and `h` has to double to keep a layout where it was, and that is
 * arithmetic worth testing rather than trusting to a `* 2` in SQL.
 */
export function scaleRows(box: GridBox, factor: number): GridBox {
  return { ...box, y: Math.round(box.y * factor), h: Math.max(MIN_H, Math.round(box.h * factor)) };
}

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
 *
 * `y` accumulates each item's own height rather than counting positions. Using
 * the index put a three-row group at `y: 0` and the next field at `y: 1`, so
 * every group on every phone — they are three rows by default — drew on top of
 * whatever followed it, and the card's `overflow-hidden` cut off the rest.
 */
export function toSingleColumn(
  items: GridItem[],
  /**
   * The height an item needs here, where it may differ from the one stored.
   *
   * A group is the case that matters: its stored height is whatever it was
   * dragged to on a desktop, next to other fields, and on a phone it is the
   * full width of the screen with nothing beside it. Asking the caller lets
   * this stay pure — it is the component that knows what a group contains.
   */
  heightOf?: (item: GridItem) => number,
): GridItem[] {
  let y = 0;

  return [...items]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((item) => {
      const h = Math.max(MIN_H, Math.round(heightOf?.(item) ?? item.h));
      const placed = { ...item, x: 0, y, w: GRID_COLUMNS, h };
      y += h;
      return placed;
    });
}

/**
 * How many rows a group needs on a phone to show everything inside it.
 *
 * Vertical space is the cheap axis on a narrow screen — the page scrolls — so a
 * group is given the room its children actually occupy rather than the height it
 * happened to be resized to beside other fields. Without this a three-row group
 * holding four one-row children simply cut the fourth off: the card is
 * `overflow-hidden`, and `html, body` do not scroll.
 *
 * `childRows` is measured in the nested grid's own rows, which are shorter than
 * the dashboard's; `ratio` converts them. The extra row is the header and the
 * "Add to group" button, which sit outside the nested grid but inside the card.
 */
export function groupRowsNeeded(childRows: number, ratio: number, stored: number): number {
  if (childRows <= 0) return stored;
  return Math.max(stored, Math.ceil(childRows * ratio) + 1);
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
