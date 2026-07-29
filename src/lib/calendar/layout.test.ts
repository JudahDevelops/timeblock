import { describe, expect, it } from "vitest";

import { layoutDay, type Positionable } from "./layout";

const ev = (id: string, startMinutes: number, endMinutes: number): Positionable => ({
  id,
  startMinutes,
  endMinutes,
});

/** Convenience: map id -> {column, columns}. */
function place(items: Positionable[]) {
  return Object.fromEntries(
    layoutDay(items).map((p) => [p.item.id, { column: p.column, columns: p.columns }]),
  );
}

describe("layoutDay", () => {
  it("gives a lone event the full width", () => {
    expect(place([ev("a", 540, 600)])).toEqual({ a: { column: 0, columns: 1 } });
  });

  it("keeps sequential events full width", () => {
    // 9-10 then 10-11 do not overlap, so neither should be narrowed.
    const result = place([ev("a", 540, 600), ev("b", 600, 660)]);
    expect(result).toEqual({
      a: { column: 0, columns: 1 },
      b: { column: 0, columns: 1 },
    });
  });

  it("splits two overlapping events into two columns", () => {
    const result = place([ev("a", 540, 660), ev("b", 600, 720)]);
    expect(result).toEqual({
      a: { column: 0, columns: 2 },
      b: { column: 1, columns: 2 },
    });
  });

  it("reuses a freed column instead of widening the cluster", () => {
    // c starts after a ends, so it can sit back in column 0 even though the
    // cluster is held open by the long event b.
    const result = place([ev("a", 540, 600), ev("b", 550, 720), ev("c", 600, 660)]);
    expect(result.b.columns).toBe(2);
    expect(result.a.column).toBe(0);
    expect(result.c.column).toBe(0);
    expect(result.b.column).toBe(1);
  });

  it("puts the longest event leftmost when starts tie", () => {
    const result = place([ev("short", 540, 570), ev("long", 540, 720)]);
    expect(result.long.column).toBe(0);
    expect(result.short.column).toBe(1);
  });

  it("separates non-overlapping clusters", () => {
    const result = place([
      ev("a", 540, 600),
      ev("b", 550, 610), // overlaps a
      ev("c", 900, 960), // far later, own cluster
    ]);
    expect(result.a.columns).toBe(2);
    expect(result.b.columns).toBe(2);
    expect(result.c.columns).toBe(1);
  });

  it("handles three mutually overlapping events", () => {
    const result = place([ev("a", 540, 720), ev("b", 550, 700), ev("c", 560, 690)]);
    expect(new Set([result.a.column, result.b.column, result.c.column])).toEqual(
      new Set([0, 1, 2]),
    );
    expect(result.a.columns).toBe(3);
  });

  it("is deterministic for identical spans", () => {
    const items = [ev("b", 540, 600), ev("a", 540, 600)];
    expect(place(items)).toEqual(place([...items].reverse()));
  });

  it("returns every input event exactly once", () => {
    const items = [ev("a", 0, 60), ev("b", 30, 90), ev("c", 45, 120), ev("d", 600, 660)];
    expect(layoutDay(items)).toHaveLength(4);
  });

  it("handles an empty day", () => {
    expect(layoutDay([])).toEqual([]);
  });
});
