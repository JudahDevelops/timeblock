import { describe, expect, it } from "vitest";

import {
  clampBox,
  compact,
  firstFreeSlot,
  GRID_COLUMNS,
  gridHeight,
  MIN_H,
  MIN_W,
  normalise,
  overlaps,
  pointToCell,
  resolveCollisions,
  toSingleColumn,
  type GridItem,
} from "./grid";

const item = (id: string, x: number, y: number, w = 3, h = 1): GridItem => ({ id, x, y, w, h });

describe("clampBox", () => {
  it("keeps a box inside the grid", () => {
    expect(clampBox({ x: 20, y: 0, w: 3, h: 1 })).toEqual({
      x: GRID_COLUMNS - 3,
      y: 0,
      w: 3,
      h: 1,
    });
    expect(clampBox({ x: -5, y: -5, w: 3, h: 1 })).toEqual({ x: 0, y: 0, w: 3, h: 1 });
  });

  it("holds a box to the minimum usable size", () => {
    expect(clampBox({ x: 0, y: 0, w: 0, h: 0 })).toEqual({ x: 0, y: 0, w: MIN_W, h: MIN_H });
  });

  it("never lets a box be wider than the grid", () => {
    expect(clampBox({ x: 0, y: 0, w: 99, h: 1 })).toEqual({
      x: 0,
      y: 0,
      w: GRID_COLUMNS,
      h: 1,
    });
  });

  it("rounds fractional units, which is all a drag ever produces", () => {
    expect(clampBox({ x: 2.6, y: 1.4, w: 3.5, h: 2.2 })).toEqual({ x: 3, y: 1, w: 4, h: 2 });
  });

  it("clamps x against the clamped width, not the requested one", () => {
    // A full-width box can only sit at 0, however far right it was dragged.
    expect(clampBox({ x: 9, y: 0, w: 99, h: 1 })).toEqual({ x: 0, y: 0, w: GRID_COLUMNS, h: 1 });
  });
});

describe("overlaps", () => {
  it("is true when boxes share a cell", () => {
    expect(overlaps(item("a", 0, 0, 4, 2), item("b", 2, 1, 4, 2))).toBe(true);
  });

  it("is false for boxes that merely touch", () => {
    expect(overlaps(item("a", 0, 0, 3, 1), item("b", 3, 0, 3, 1))).toBe(false);
    expect(overlaps(item("a", 0, 0, 3, 1), item("b", 0, 1, 3, 1))).toBe(false);
  });

  it("is false for boxes in different columns on the same row", () => {
    expect(overlaps(item("a", 0, 0), item("b", 6, 0))).toBe(false);
  });
});

describe("resolveCollisions", () => {
  it("pushes a colliding field below the one it landed on", () => {
    const resolved = resolveCollisions([item("a", 0, 0), item("b", 0, 0)], "a");
    expect(resolved.find((i) => i.id === "a")).toMatchObject({ x: 0, y: 0 });
    expect(resolved.find((i) => i.id === "b")).toMatchObject({ x: 0, y: 1 });
  });

  it("holds the anchor still and moves everything else around it", () => {
    // The dragged field is the one the user is actively positioning, so it wins.
    const resolved = resolveCollisions([item("a", 0, 0), item("dragged", 0, 0)], "dragged");
    expect(resolved.find((i) => i.id === "dragged")).toMatchObject({ y: 0 });
    expect(resolved.find((i) => i.id === "a")).toMatchObject({ y: 1 });
  });

  it("cascades a push through a stack", () => {
    const resolved = resolveCollisions(
      [item("a", 0, 0), item("b", 0, 1), item("dragged", 0, 0)],
      "dragged",
    );
    const y = (id: string) => resolved.find((i) => i.id === id)?.y;
    expect(y("dragged")).toBe(0);
    expect(y("a")).toBe(1);
    expect(y("b")).toBe(2);
  });

  it("leaves fields in different columns alone", () => {
    const resolved = resolveCollisions([item("a", 0, 0), item("b", 6, 0)]);
    expect(resolved.find((i) => i.id === "b")).toMatchObject({ x: 6, y: 0 });
  });

  it("pushes past a tall neighbour by its full height", () => {
    const resolved = resolveCollisions([item("tall", 0, 0, 3, 4), item("b", 0, 1)], "tall");
    expect(resolved.find((i) => i.id === "b")?.y).toBe(4);
  });

  it("never loses or duplicates a field", () => {
    const items = [item("a", 0, 0), item("b", 0, 0), item("c", 1, 0), item("d", 2, 0)];
    const resolved = resolveCollisions(items);
    expect(resolved.map((i) => i.id).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("terminates and separates everything when all fields start stacked", () => {
    const items = Array.from({ length: 6 }, (_, i) => item(`f${i}`, 0, 0));
    const resolved = resolveCollisions(items);

    for (const a of resolved) {
      for (const b of resolved) {
        if (a.id !== b.id) expect(overlaps(a, b)).toBe(false);
      }
    }
  });
});

describe("compact", () => {
  it("pulls a stranded field up into the gap above it", () => {
    expect(compact([item("a", 0, 5)])[0]).toMatchObject({ y: 0 });
  });

  it("keeps relative order while closing gaps", () => {
    const compacted = compact([item("a", 0, 0), item("b", 0, 4), item("c", 0, 9)]);
    expect(compacted.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(compacted.map((i) => i.y)).toEqual([0, 1, 2]);
  });

  it("lets a field rise past an empty column rather than blocking on it", () => {
    // `b` is in its own column, so nothing is above it.
    const compacted = compact([item("a", 0, 0, 3, 3), item("b", 6, 5)]);
    expect(compacted.find((i) => i.id === "b")).toMatchObject({ x: 6, y: 0 });
  });

  it("stops a field under the one above it", () => {
    const compacted = compact([item("a", 0, 0, 3, 2), item("b", 0, 7)]);
    expect(compacted.find((i) => i.id === "b")?.y).toBe(2);
  });

  it("introduces no overlaps", () => {
    const compacted = compact([item("a", 0, 0, 6, 2), item("b", 3, 4, 6, 2), item("c", 0, 9)]);
    for (const a of compacted) {
      for (const b of compacted) {
        if (a.id !== b.id) expect(overlaps(a, b)).toBe(false);
      }
    }
  });
});

describe("normalise", () => {
  it("clamps, resolves and compacts in one pass", () => {
    const result = normalise([item("a", 99, 9, 99, 1), item("b", 0, 0)]);
    for (const box of result) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual(GRID_COLUMNS);
    }
    expect(Math.min(...result.map((i) => i.y))).toBe(0);
  });

  it("leaves an already-tidy layout untouched", () => {
    const tidy = [item("a", 0, 0), item("b", 3, 0), item("c", 6, 0)];
    expect(normalise(tidy)).toEqual(expect.arrayContaining(tidy));
  });

  it("is idempotent", () => {
    // Running it twice must not keep shifting the layout around.
    const once = normalise([item("a", 0, 0), item("b", 0, 0), item("c", 4, 3)]);
    expect(normalise(once)).toEqual(once);
  });

  it("preserves the caller's array order", () => {
    // The passes sort internally to stay single-sweep. Handing that order back
    // would make every caller diffing arrays see a change that never happened.
    const input = [item("c", 4, 3), item("a", 0, 0), item("b", 0, 0)];
    expect(normalise(input).map((i) => i.id)).toEqual(["c", "a", "b"]);
  });
});

describe("pointToCell", () => {
  const WIDTH = 1200; // 100px per column
  const CELL = 80;

  it("maps a pixel offset to a column and row", () => {
    expect(pointToCell(0, 0, WIDTH, CELL)).toEqual({ x: 0, y: 0 });
    expect(pointToCell(250, 90, WIDTH, CELL)).toEqual({ x: 2, y: 1 });
  });

  it("never returns a column off the grid", () => {
    expect(pointToCell(WIDTH + 500, 0, WIDTH, CELL).x).toBe(GRID_COLUMNS - 1);
    expect(pointToCell(-100, -100, WIDTH, CELL)).toEqual({ x: 0, y: 0 });
  });

  it("survives a zero width without dividing by zero", () => {
    const cell = pointToCell(50, 50, 0, 0);
    expect(Number.isFinite(cell.x)).toBe(true);
    expect(Number.isFinite(cell.y)).toBe(true);
  });
});

describe("toSingleColumn", () => {
  it("stacks everything full width in reading order", () => {
    const stacked = toSingleColumn([item("b", 6, 0), item("a", 0, 0), item("c", 0, 1)]);
    expect(stacked.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(stacked.map((i) => i.y)).toEqual([0, 1, 2]);
    expect(stacked.every((i) => i.x === 0 && i.w === GRID_COLUMNS)).toBe(true);
  });

  it("keeps each field's own height", () => {
    const stacked = toSingleColumn([item("tall", 0, 0, 3, 3)]);
    expect(stacked[0].h).toBe(3);
  });
});

describe("gridHeight", () => {
  it("is the bottom edge of the lowest field", () => {
    expect(gridHeight([item("a", 0, 0, 3, 2), item("b", 6, 3, 3, 1)])).toBe(4);
  });

  it("is zero for an empty grid", () => {
    expect(gridHeight([])).toBe(0);
  });
});

describe("firstFreeSlot", () => {
  it("is the origin on an empty grid", () => {
    expect(firstFreeSlot([], 3, 1)).toEqual({ x: 0, y: 0 });
  });

  it("finds the gap beside an existing field", () => {
    expect(firstFreeSlot([item("a", 0, 0, 3, 1)], 3, 1)).toEqual({ x: 3, y: 0 });
  });

  it("drops to the next row when the first is full", () => {
    const full = Array.from({ length: 4 }, (_, i) => item(`f${i}`, i * 3, 0, 3, 1));
    expect(firstFreeSlot(full, 3, 1)).toEqual({ x: 0, y: 1 });
  });

  it("returns a slot that genuinely does not collide", () => {
    const items = [item("a", 0, 0, 6, 2), item("b", 6, 0, 6, 1)];
    const slot = firstFreeSlot(items, 4, 1);
    const candidate = { ...slot, w: 4, h: 1 };
    expect(items.some((i) => overlaps(candidate, i))).toBe(false);
  });
});
