import { describe, expect, it } from "vitest";

import { formatClock, formatDuration, formatSpan } from "./format";

const minutes = (n: number) => n * 60_000;

describe("formatDuration", () => {
  it("renders minutes under an hour", () => {
    expect(formatDuration(minutes(23))).toBe("23m");
  });

  it("renders whole hours without a stray 0m", () => {
    expect(formatDuration(minutes(120))).toBe("2h");
  });

  it("renders hours and minutes together", () => {
    expect(formatDuration(minutes(97))).toBe("1h 37m");
  });

  it("rounds part-minutes up so a running block never reads 0m", () => {
    expect(formatDuration(30_000)).toBe("1m");
  });

  it("carries a rounded-up minute into the next hour rather than saying 60m", () => {
    expect(formatDuration(minutes(119) + 30_000)).toBe("2h");
  });

  it("floors at zero for an elapsed deadline", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(-5000)).toBe("0m");
  });
});

describe("formatClock", () => {
  it("pads minutes so a column stays aligned", () => {
    expect(formatClock(new Date(2026, 7, 11, 9, 0))).toBe("9:00");
    expect(formatClock(new Date(2026, 7, 11, 17, 5))).toBe("17:05");
  });
});

describe("formatSpan", () => {
  it("joins start and end with an en dash", () => {
    const span = formatSpan(new Date(2026, 7, 11, 9, 0), new Date(2026, 7, 11, 11, 0));
    expect(span).toBe("9:00–11:00");
  });
});
