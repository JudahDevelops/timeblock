import { describe, expect, it } from "vitest";

import {
  clampToDay,
  dayAtMinutes,
  HOUR_HEIGHT,
  MINUTES_PER_DAY,
  minutesSinceMidnight,
  minutesToY,
  snapToStep,
  spanForDay,
  yToMinutes,
} from "./geometry";

describe("time <-> pixel", () => {
  it("round-trips", () => {
    for (const minutes of [0, 15, 90, 725, MINUTES_PER_DAY]) {
      expect(yToMinutes(minutesToY(minutes))).toBeCloseTo(minutes);
    }
  });

  it("maps one hour to HOUR_HEIGHT", () => {
    expect(minutesToY(60)).toBe(HOUR_HEIGHT);
  });
});

describe("snapToStep", () => {
  it("snaps to the nearest 15 minutes", () => {
    expect(snapToStep(0)).toBe(0);
    expect(snapToStep(7)).toBe(0);
    expect(snapToStep(8)).toBe(15);
    expect(snapToStep(22)).toBe(15);
    expect(snapToStep(23)).toBe(30);
  });

  it("honours a custom step", () => {
    expect(snapToStep(17, 5)).toBe(15);
    expect(snapToStep(18, 5)).toBe(20);
  });
});

describe("clampToDay", () => {
  it("bounds to the day", () => {
    expect(clampToDay(-30)).toBe(0);
    expect(clampToDay(MINUTES_PER_DAY + 30)).toBe(MINUTES_PER_DAY);
    expect(clampToDay(600)).toBe(600);
  });
});

describe("dayAtMinutes", () => {
  it("builds a local time from minutes since midnight", () => {
    const result = dayAtMinutes(new Date(2026, 6, 29, 17, 43), 9 * 60 + 30);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(6);
    expect(result.getDate()).toBe(29);
    expect(result.getHours()).toBe(9);
    expect(result.getMinutes()).toBe(30);
  });

  it("does not mutate its input", () => {
    const day = new Date(2026, 6, 29, 12, 0);
    const before = day.getTime();
    dayAtMinutes(day, 0);
    expect(day.getTime()).toBe(before);
  });

  it("inverts minutesSinceMidnight", () => {
    const day = new Date(2026, 6, 29);
    expect(minutesSinceMidnight(dayAtMinutes(day, 615))).toBe(615);
  });
});

describe("spanForDay", () => {
  const day = new Date(2026, 6, 29);

  it("returns the span for a same-day event", () => {
    const start = new Date(2026, 6, 29, 9, 0);
    const end = new Date(2026, 6, 29, 10, 30);
    expect(spanForDay(start, end, day)).toEqual({ startMinutes: 540, endMinutes: 630 });
  });

  it("returns null for an event on another day", () => {
    const start = new Date(2026, 6, 30, 9, 0);
    const end = new Date(2026, 6, 30, 10, 0);
    expect(spanForDay(start, end, day)).toBeNull();
  });

  it("clips an event that started yesterday", () => {
    const start = new Date(2026, 6, 28, 22, 0);
    const end = new Date(2026, 6, 29, 1, 0);
    expect(spanForDay(start, end, day)).toEqual({ startMinutes: 0, endMinutes: 60 });
  });

  it("clips an event that runs into tomorrow", () => {
    const start = new Date(2026, 6, 29, 23, 0);
    const end = new Date(2026, 6, 30, 2, 0);
    expect(spanForDay(start, end, day)).toEqual({
      startMinutes: 1380,
      endMinutes: MINUTES_PER_DAY,
    });
  });

  it("covers the full day for an event spanning it entirely", () => {
    const start = new Date(2026, 6, 28, 8, 0);
    const end = new Date(2026, 6, 31, 8, 0);
    expect(spanForDay(start, end, day)).toEqual({
      startMinutes: 0,
      endMinutes: MINUTES_PER_DAY,
    });
  });

  it("excludes an event ending exactly at midnight today", () => {
    // Touching the boundary is not an overlap, or every day would show the
    // previous day's last event as a zero-height sliver.
    const start = new Date(2026, 6, 28, 22, 0);
    const end = new Date(2026, 6, 29, 0, 0);
    expect(spanForDay(start, end, day)).toBeNull();
  });

  it("includes an event starting exactly at midnight today", () => {
    const start = new Date(2026, 6, 29, 0, 0);
    const end = new Date(2026, 6, 29, 1, 0);
    expect(spanForDay(start, end, day)).toEqual({ startMinutes: 0, endMinutes: 60 });
  });
});
