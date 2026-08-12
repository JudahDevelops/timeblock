import { describe, expect, it } from "vitest";

import { canNest, depthOf, type Nestable } from "./tree";

/** Builds the id → field map the rules read, from a plain list. */
function index(fields: Nestable[]): ReadonlyMap<string, Nestable> {
  return new Map(fields.map((field) => [field.id, field]));
}

const field = (id: string, parentId: string | null = null): Nestable => ({ id, parentId });

describe("depthOf", () => {
  it("is zero at the top level", () => {
    const a = field("a");
    expect(depthOf(a, index([a]))).toBe(0);
  });

  it("counts each group on the way up", () => {
    const a = field("a");
    const b = field("b", "a");
    const c = field("c", "b");
    const map = index([a, b, c]);

    expect(depthOf(b, map)).toBe(1);
    expect(depthOf(c, map)).toBe(2);
  });

  it("treats a missing parent as the top level", () => {
    // The parent row may have been deleted, or belong to another dashboard.
    // Losing the child would make a row that exists impossible to see.
    const orphan = field("orphan", "gone");
    expect(depthOf(orphan, index([orphan]))).toBe(0);
  });

  it("refuses a chain that loops", () => {
    const a = field("a", "b");
    const b = field("b", "a");
    expect(depthOf(a, index([a, b]))).toBe(Infinity);
  });

  it("refuses a field that is its own parent", () => {
    const self = field("self", "self");
    expect(depthOf(self, index([self]))).toBe(Infinity);
  });

  it("refuses a chain deeper than the ceiling", () => {
    const a = field("a");
    const b = field("b", "a");
    const c = field("c", "b");
    const d = field("d", "c");
    expect(depthOf(d, index([a, b, c, d]))).toBe(Infinity);
  });
});

describe("canNest", () => {
  it("says no at the top level", () => {
    const a = field("a");
    expect(canNest(a, index([a]))).toBe(false);
  });

  it("allows a group inside a group", () => {
    // The whole point of the change: depth 2 is drawable.
    const a = field("a");
    const b = field("b", "a");
    const c = field("c", "b");
    expect(canNest(c, index([a, b, c]))).toBe(true);
  });

  it("stops at the ceiling", () => {
    const a = field("a");
    const b = field("b", "a");
    const c = field("c", "b");
    const d = field("d", "c");
    expect(canNest(d, index([a, b, c, d]))).toBe(false);
  });

  it("says no to a cycle", () => {
    const a = field("a", "b");
    const b = field("b", "a");
    expect(canNest(a, index([a, b]))).toBe(false);
  });

  it("says no to a field parented to itself", () => {
    const self = field("self", "self");
    expect(canNest(self, index([self]))).toBe(false);
  });
});
