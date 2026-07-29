import { describe, expect, it } from "vitest";

import { shiftAnchor, toDateParam, visibleDays } from "./date";

const JULY = new Date(2026, 6, 29);

describe("visibleDays", () => {
  it("opens a month on the Monday on or before the 1st", () => {
    const days = visibleDays(JULY, "month");
    expect(days).toHaveLength(42);
    // 1 July 2026 is a Wednesday, so the grid starts two days earlier.
    expect(toDateParam(days[0])).toBe("2026-06-29");
    expect(toDateParam(days[41])).toBe("2026-08-09");
  });

  it("starts day and 3-day on the anchor itself", () => {
    expect(visibleDays(JULY, "day").map(toDateParam)).toEqual(["2026-07-29"]);
    expect(visibleDays(JULY, "3day").map(toDateParam)).toEqual([
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
    ]);
  });
});

describe("shiftAnchor", () => {
  it("pages a month by a calendar month, not by 42 days", () => {
    const next = shiftAnchor(JULY, "month", 1);
    expect(toDateParam(next)).toBe("2026-08-01");
    // Paging twice must not skip September, which stepping by the grid would.
    expect(toDateParam(shiftAnchor(next, "month", 1))).toBe("2026-09-01");
  });

  it("pages back across a year boundary", () => {
    const january = new Date(2026, 0, 15);
    expect(toDateParam(shiftAnchor(january, "month", -1))).toBe("2025-12-01");
  });

  it("pages a week by exactly its own length", () => {
    expect(toDateParam(shiftAnchor(JULY, "week", 1))).toBe("2026-08-05");
  });
});
