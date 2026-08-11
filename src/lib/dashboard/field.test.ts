import { describe, expect, it } from "vitest";

import {
  coerceConfig,
  coerceValue,
  defaultsFor,
  formatNumber,
  formatRelativeDate,
  formatValue,
  isFieldKind,
  parseField,
  progressFraction,
} from "./field";
import type { DashboardField } from "./field";

const row = (over: Partial<Parameters<typeof parseField>[0]>) =>
  parseField({
    id: "f1",
    label: "Field",
    position: 0,
    kind: "number",
    config: {},
    value: null,
    ...over,
  });

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0, 0);

describe("parseField", () => {
  it("returns null for a kind it does not recognise", () => {
    expect(row({ kind: "sparkline" })).toBeNull();
  });

  it("reads a number field with its prefix and suffix", () => {
    const field = row({ kind: "number", config: { prefix: "$" }, value: 4200 });
    expect(field).toMatchObject({ kind: "number", value: 4200, config: { prefix: "$" } });
  });

  it("drops a non-numeric value rather than storing NaN", () => {
    expect(row({ kind: "number", value: "4200" })?.value).toBeNull();
    expect(row({ kind: "number", value: Number.NaN })?.value).toBeNull();
  });

  it("falls back to a usable target when progress config is missing or non-positive", () => {
    expect(row({ kind: "progress", config: {} })).toMatchObject({ config: { target: 100 } });
    expect(row({ kind: "progress", config: { target: 0 } })).toMatchObject({
      config: { target: 100 },
    });
    expect(row({ kind: "progress", config: { target: -5 } })).toMatchObject({
      config: { target: 100 },
    });
  });

  it("keeps only string entries in a list", () => {
    const field = row({ kind: "list", value: ["Ada", 42, null, "Grace"] });
    expect(field?.value).toEqual(["Ada", "Grace"]);
  });

  it("treats a non-boolean checkbox value as unset", () => {
    expect(row({ kind: "checkbox", value: "yes" })?.value).toBeNull();
    expect(row({ kind: "checkbox", value: false })?.value).toBe(false);
  });

  it("rejects a date that is not a calendar day", () => {
    expect(row({ kind: "date", value: "last tuesday" })?.value).toBeNull();
    expect(row({ kind: "date", value: "2026-13-40" })?.value).toBeNull();
    expect(row({ kind: "date", value: "2026-08-11" })?.value).toBe("2026-08-11");
  });

  it("survives malformed jsonb at the trust boundary", () => {
    expect(row({ kind: "number", config: "not an object" })).toMatchObject({ kind: "number" });
    expect(row({ kind: "list", value: "not an array" })?.value).toBeNull();
  });
});

describe("defaultsFor", () => {
  it("gives a progress field a target that will not divide by zero", () => {
    expect(defaultsFor("progress")).toEqual({ config: { target: 100 }, value: null });
  });

  it("starts a list empty rather than unset", () => {
    expect(defaultsFor("list")).toEqual({ config: {}, value: [] });
  });
});

describe("coerceValue", () => {
  it("parses a typed number, including one with thousands separators", () => {
    expect(coerceValue("number", "4,200")).toBe(4200);
    expect(coerceValue("number", "72.5")).toBe(72.5);
  });

  it("treats an empty string as cleared, not as zero", () => {
    expect(coerceValue("number", "")).toBeNull();
    expect(coerceValue("number", "   ")).toBeNull();
  });

  it("rejects a number that is not one", () => {
    expect(coerceValue("number", "abc")).toBeNull();
    expect(coerceValue("progress", {})).toBeNull();
  });

  it("caps text and list length", () => {
    const long = "x".repeat(1000);
    expect((coerceValue("text", long) as string).length).toBe(500);
    expect((coerceValue("list", Array(200).fill("a")) as string[]).length).toBe(50);
  });

  it("passes null through for every kind", () => {
    for (const kind of ["number", "progress", "text", "date", "checkbox", "list"] as const) {
      expect(coerceValue(kind, null)).toBeNull();
    }
  });
});

describe("coerceConfig", () => {
  it("clamps decimals into a sane range", () => {
    expect(coerceConfig("number", { decimals: 99 })).toEqual({ decimals: 4 });
    expect(coerceConfig("number", { decimals: -3 })).toEqual({ decimals: 0 });
  });

  it("drops unset keys rather than storing nulls in jsonb", () => {
    expect(coerceConfig("number", { prefix: "  ", suffix: "kg" })).toEqual({ suffix: "kg" });
  });

  it("rescues a target that would divide by zero", () => {
    expect(coerceConfig("progress", { target: 0 })).toEqual({ target: 100 });
    expect(coerceConfig("progress", { target: 30 })).toEqual({ target: 30 });
  });

  it("gives the kinds without settings an empty config", () => {
    expect(coerceConfig("text", { prefix: "$" })).toEqual({});
  });
});

describe("progressFraction", () => {
  const field = (
    value: number | null,
    target: number,
  ): Extract<DashboardField, { kind: "progress" }> => ({
    id: "p",
    label: "Progress",
    position: 0,
    kind: "progress",
    config: { target },
    value,
  });

  it("is the value over the target", () => {
    expect(progressFraction(field(30, 120))).toBe(0.25);
  });

  it("clamps rather than overflowing the track", () => {
    expect(progressFraction(field(200, 100))).toBe(1);
    expect(progressFraction(field(-10, 100))).toBe(0);
  });

  it("is empty when nothing has been recorded", () => {
    expect(progressFraction(field(null, 100))).toBe(0);
  });
});

describe("formatValue", () => {
  const now = at(2026, 8, 11);
  const build = (over: Partial<DashboardField> & Pick<DashboardField, "kind">) =>
    ({ id: "f", label: "F", position: 0, config: {}, value: null, ...over }) as DashboardField;

  it("renders a number with prefix, separators and unit", () => {
    expect(formatValue(build({ kind: "number", config: { prefix: "$" }, value: 4200 }), now)).toBe(
      "$4,200",
    );
    expect(formatValue(build({ kind: "number", config: { suffix: "kg" }, value: 72 }), now)).toBe(
      "72 kg",
    );
  });

  it("renders progress against its target", () => {
    expect(formatValue(build({ kind: "progress", config: { target: 120 }, value: 30 }), now)).toBe(
      "30 / 120",
    );
  });

  it("renders an unset field as a dash for every kind", () => {
    expect(formatValue(build({ kind: "number" }), now)).toBe("—");
    expect(formatValue(build({ kind: "text" }), now)).toBe("—");
    expect(formatValue(build({ kind: "date" }), now)).toBe("—");
    expect(formatValue(build({ kind: "checkbox" }), now)).toBe("—");
    expect(formatValue(build({ kind: "list", value: [] }), now)).toBe("—");
  });

  it("renders a checkbox in words rather than a symbol", () => {
    expect(formatValue(build({ kind: "checkbox", value: true }), now)).toBe("Done");
    expect(formatValue(build({ kind: "checkbox", value: false }), now)).toBe("Not done");
  });

  it("joins a list into one line", () => {
    expect(formatValue(build({ kind: "list", value: ["Ada", "Grace"] }), now)).toBe("Ada, Grace");
  });
});

describe("formatRelativeDate", () => {
  const now = at(2026, 8, 11);

  it("names the days either side of today", () => {
    expect(formatRelativeDate("2026-08-11", now)).toBe("Today");
    expect(formatRelativeDate("2026-08-10", now)).toBe("Yesterday");
    expect(formatRelativeDate("2026-08-12", now)).toBe("Tomorrow");
  });

  it("counts days, then weeks, then months, then years", () => {
    expect(formatRelativeDate("2026-08-08", now)).toBe("3 days ago");
    expect(formatRelativeDate("2026-07-28", now)).toBe("2 weeks ago");
    expect(formatRelativeDate("2026-05-11", now)).toBe("3 months ago");
    expect(formatRelativeDate("2025-08-11", now)).toBe("1 year ago");
  });

  it("reads forwards for a future date", () => {
    expect(formatRelativeDate("2026-08-14", now)).toBe("In 3 days");
    expect(formatRelativeDate("2026-08-18", now)).toBe("In 1 week");
  });

  it("compares calendar days, not elapsed hours", () => {
    // Logged late last night, read early this morning: still "Yesterday", which
    // an hours-based subtraction would call "1 day ago" then "2 days ago".
    const earlyMorning = new Date(2026, 7, 11, 6, 0, 0, 0);
    expect(formatRelativeDate("2026-08-10", earlyMorning)).toBe("Yesterday");
  });

  it("does not drift a day west of Greenwich", () => {
    // `new Date("2026-08-11")` is UTC midnight, which is the 10th in the Americas.
    expect(formatRelativeDate("2026-08-11", now)).toBe("Today");
  });

  it("returns a dash for something that is not a date", () => {
    expect(formatRelativeDate("soon", now)).toBe("—");
  });
});

describe("formatNumber", () => {
  it("groups thousands", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
  });

  it("honours a configured decimal count", () => {
    expect(formatNumber(4.5, 2)).toBe("4.50");
    expect(formatNumber(4, 0)).toBe("4");
  });
});

describe("isFieldKind", () => {
  it("accepts every menu kind and nothing else", () => {
    expect(isFieldKind("progress")).toBe(true);
    expect(isFieldKind("sparkline")).toBe(false);
    expect(isFieldKind(7)).toBe(false);
  });
});
