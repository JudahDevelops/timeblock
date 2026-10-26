import { describe, expect, it } from "vitest";

import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("keeps an internal path", () => {
    expect(safeNext("/calendar/day/2026-10-26?open=abc")).toBe("/calendar/day/2026-10-26?open=abc");
  });

  it("falls back to / when missing", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext("")).toBe("/");
  });

  it("rejects absolute and protocol-relative URLs", () => {
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("/\\evil.com")).toBe("/");
  });
});
