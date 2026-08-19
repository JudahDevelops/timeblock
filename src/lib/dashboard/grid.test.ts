import { describe, expect, it } from "vitest";

import {
  CELL_HEIGHT,
  clampBox,
  compact,
  firstFreeSlot,
  GAP,
  GRID_COLUMNS,
  gridHeight,
  groupRowsNeeded,
  MIN_H,
  MIN_W,
  normalise,
  overlaps,
  PREVIOUS_GRID_COLUMNS,
  PREVIOUS_ROW_HEIGHT,
  scaleRows,
  scaleToColumns,
  type GridBox,
  pointToCell,
  resolveCollisions,
  toSingleColumn,
  type GridItem,
} from "./grid";

const item = (id: string, x: number, y: number, w = 3, h = 1): GridItem => ({ id, x, y, w, h });

describe("clampBox", () => {
  it("keeps a box inside the grid", () => {
    expect(clampBox({ x: 99, y: 0, w: 6, h: 1 })).toEqual({
      x: GRID_COLUMNS - 6,
      y: 0,
      w: 6,
      h: 1,
    });
    expect(clampBox({ x: -5, y: -5, w: 6, h: 1 })).toEqual({ x: 0, y: 0, w: 6, h: 1 });
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
    // Laid out edge to edge at the default width, so nothing needs clamping,
    // pushing or lifting and the pipeline has to be a no-op.
    const tidy = [item("a", 0, 0, 6), item("b", 6, 0, 6), item("c", 12, 0, 6)];
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
  const WIDTH = 1200; // 50px per column
  const CELL = 80;

  it("maps a pixel offset to a column and row", () => {
    expect(pointToCell(0, 0, WIDTH, CELL)).toEqual({ x: 0, y: 0 });
    expect(pointToCell(250, 90, WIDTH, CELL)).toEqual({ x: 5, y: 1 });
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

  it("leaves room for a tall field instead of stacking on top of it", () => {
    // A group is three rows by default, so counting positions rather than rows
    // put the next field two rows inside it — the mobile clipping, exactly.
    const stacked = toSingleColumn([item("group", 0, 0, 6, 3), item("after", 0, 1)]);
    expect(stacked.map((i) => i.y)).toEqual([0, 3]);
  });

  it("takes the height the caller asks for, and leaves room for it", () => {
    // How a group gets the space its children need on a phone.
    const stacked = toSingleColumn([item("group", 0, 0, 6, 2), item("after", 0, 1)], (i) =>
      i.id === "group" ? 5 : i.h,
    );
    expect(stacked.map((i) => i.h)).toEqual([5, 1]);
    expect(stacked.map((i) => i.y)).toEqual([0, 5]);
  });

  it("never overlaps itself, whatever the heights", () => {
    const stacked = toSingleColumn([
      item("a", 0, 0, 3, 2),
      item("b", 6, 0, 3, 3),
      item("c", 0, 1, 3, 1),
    ]);

    for (const [i, one] of stacked.entries()) {
      for (const other of stacked.slice(i + 1)) {
        expect(overlaps(one, other)).toBe(false);
      }
    }
  });
});

describe("scaleToColumns", () => {
  const double = (box: GridBox) => scaleToColumns(box, PREVIOUS_GRID_COLUMNS, GRID_COLUMNS);

  it("doubles a box from the old grid into the new one", () => {
    expect(double({ x: 0, y: 0, w: 12, h: 1 })).toEqual({ x: 0, y: 0, w: 24, h: 1 });
    expect(double({ x: 6, y: 2, w: 6, h: 3 })).toEqual({ x: 12, y: 2, w: 12, h: 3 });
  });

  it("leaves the vertical axis alone", () => {
    // The migration touches `grid_x` and `grid_w` only. A row that moved would
    // reshuffle every dashboard vertically for no reason.
    const scaled = double({ x: 4, y: 7, w: 4, h: 5 });
    expect(scaled.y).toBe(7);
    expect(scaled.h).toBe(5);
  });

  it("survives an odd width without rounding it away", () => {
    // A real row: BENCH PRESS sits at w=5, which only stays exact because the
    // factor is a whole number.
    expect(double({ x: 0, y: 0, w: 5, h: 1 })).toEqual({ x: 0, y: 0, w: 10, h: 1 });
  });

  it("keeps every real layout inside the new grid, untouched by clampBox", () => {
    // The failure this migration has to be proved against. Every box below is a
    // shape taken from a live dashboard; if doubling pushed any right edge past
    // 24, `clampBox` would quietly shrink it and the next drag would persist the
    // loss. Asserting `clampBox` is a no-op is the proof it does not.
    const live: GridBox[] = [
      { x: 0, y: 0, w: 12, h: 1 }, // full width, the commonest row
      { x: 8, y: 0, w: 4, h: 1 }, // flush against the old right edge
      { x: 6, y: 0, w: 6, h: 1 }, // right half
      { x: 4, y: 0, w: 4, h: 1 }, // a middle third
      { x: 0, y: 0, w: 5, h: 1 }, // the odd one
      { x: 0, y: 0, w: 6, h: 3 }, // a group
    ];

    for (const box of live) {
      const scaled = double(box);
      expect(scaled.x + scaled.w).toBeLessThanOrEqual(GRID_COLUMNS);
      expect(scaled.w).toBeGreaterThanOrEqual(MIN_W);
      expect(clampBox(scaled)).toEqual(scaled);
    }
  });

  it("carries a full row across as a full row", () => {
    // Four quarters tiling the old grid must tile the new one exactly, with no
    // gap opening up and no overlap appearing.
    const row = Array.from({ length: 4 }, (_, i) => double({ x: i * 3, y: 0, w: 3, h: 1 }));

    expect(row.map((b) => b.x)).toEqual([0, 6, 12, 18]);
    expect(row.at(-1)!.x + row.at(-1)!.w).toBe(GRID_COLUMNS);
    for (const [i, one] of row.entries()) {
      for (const other of row.slice(i + 1)) expect(overlaps(one, other)).toBe(false);
    }
  });
});

describe("scaleRows", () => {
  it("doubles a box down the vertical axis", () => {
    expect(scaleRows({ x: 4, y: 3, w: 8, h: 1 }, 2)).toEqual({ x: 4, y: 6, w: 8, h: 2 });
  });

  it("leaves the horizontal axis alone", () => {
    const scaled = scaleRows({ x: 9, y: 0, w: 7, h: 4 }, 2);
    expect(scaled.x).toBe(9);
    expect(scaled.w).toBe(7);
  });

  it("never scales a box below the minimum height", () => {
    expect(scaleRows({ x: 0, y: 0, w: 8, h: 1 }, 0.25).h).toBe(MIN_H);
  });

  it("draws every migrated box at exactly the pixels it occupied before", () => {
    // The whole point of the vertical change, and the thing that would have
    // gone wrong silently. A field's height is `h * (CELL + GAP) - GAP`, so the
    // gap is inside the row: halving CELL from 96 to 48 would give a row of 56
    // and grow every card by 8px for each row it spans. 44 makes the new row 52
    // — exactly half of 104 — and the geometry is preserved.
    const NEW_ROW = CELL_HEIGHT + GAP;
    expect(NEW_ROW * 2).toBe(PREVIOUS_ROW_HEIGHT);

    for (const box of [
      { x: 0, y: 0, w: 8, h: 1 },
      { x: 0, y: 1, w: 8, h: 2 },
      { x: 8, y: 3, w: 12, h: 3 },
      { x: 0, y: 5, w: 24, h: 6 },
    ]) {
      const scaled = scaleRows(box, 2);
      expect(scaled.y * NEW_ROW).toBe(box.y * PREVIOUS_ROW_HEIGHT);
      expect(scaled.h * NEW_ROW - GAP).toBe(box.h * PREVIOUS_ROW_HEIGHT - GAP);
    }
  });

  it("lets a field be half a row shorter than it could be before", () => {
    // What the change buys: one new row is 44px where the old floor was 96.
    expect(MIN_H * (CELL_HEIGHT + GAP) - GAP).toBe(44);
  });
});

describe("groupRowsNeeded", () => {
  // A nested row is 64+8 against the dashboard's 96+8 — almost exactly two
  // thirds, which is the ratio the component passes in.
  const RATIO = 72 / 104;

  it("leaves an empty group at the height it was given", () => {
    expect(groupRowsNeeded(0, RATIO, 3)).toBe(3);
  });

  it("never shrinks a group below its stored height", () => {
    // One child in a group the user deliberately made tall stays tall.
    expect(groupRowsNeeded(1, RATIO, 6)).toBe(6);
  });

  it("grows a group that cannot show what is inside it", () => {
    // The reported bug: four one-row children in a three-row group, where the
    // fourth was simply cut off.
    expect(groupRowsNeeded(4, RATIO, 3)).toBe(4);
    expect(groupRowsNeeded(8, RATIO, 3)).toBe(7);
  });

  it("always leaves a row for the header and the add button", () => {
    // Both sit inside the card but outside the nested grid, so a group sized to
    // its children exactly would clip the control that fills it.
    for (const children of [1, 2, 3, 5, 10]) {
      const rows = groupRowsNeeded(children, RATIO, 1);
      expect(rows).toBeGreaterThan(children * RATIO);
    }
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
    const full = Array.from({ length: 4 }, (_, i) => item(`f${i}`, i * 6, 0, 6, 1));
    expect(firstFreeSlot(full, 6, 1)).toEqual({ x: 0, y: 1 });
  });

  it("returns a slot that genuinely does not collide", () => {
    const items = [item("a", 0, 0, 6, 2), item("b", 6, 0, 6, 1)];
    const slot = firstFreeSlot(items, 4, 1);
    const candidate = { ...slot, w: 4, h: 1 };
    expect(items.some((i) => overlaps(candidate, i))).toBe(false);
  });
});
