/**
 * Dashboard field types.
 *
 * A dashboard is a bag of user-defined fields and the system knows nothing about
 * what any of them mean — money, kilometres and "when did I last call Mum" are the
 * same machinery. That is the whole design: the meaning lives in the label the user
 * typed, never in a schema here.
 *
 * `kind` is picked from a menu at creation and never inferred. Inference that
 * guesses wrong about your own data is worse than one extra click, and it makes the
 * stored shape depend on what the value happened to look like the day it was typed.
 *
 * Config and value are separate on purpose (they are separate columns too): editing
 * a target must not disturb the reading, and clearing a reading must not lose the
 * unit. Both arrive from `jsonb` as `unknown`, so this module is the trust boundary
 * for them — the same job `isBlockDocument` does for block bodies. Nothing
 * downstream may assume a shape it did not get from `parseField`.
 */

/** Every field kind. The menu is generated from this, so adding one is additive. */
export const FIELD_KINDS = [
  "number",
  "progress",
  "text",
  "date",
  "checkbox",
  "list",
  "group",
] as const;

export type FieldKind = (typeof FIELD_KINDS)[number];

/** Menu copy. Kept beside the union so a new kind cannot ship without a label. */
export const FIELD_KIND_LABELS: Record<FieldKind, { label: string; hint: string }> = {
  number: { label: "Number", hint: "A figure with an optional unit — 4200, 72 kg" },
  progress: { label: "Progress", hint: "A value against a target, drawn as a bar" },
  text: { label: "Text", hint: "A short line — a note, a status, a name" },
  date: { label: "Date", hint: "A date, shown as how long ago it was" },
  checkbox: { label: "Checkbox", hint: "Done or not done" },
  list: { label: "List", hint: "A few short items" },
  group: { label: "Group", hint: "A box holding its own fields — one per client, say" },
};

/**
 * A group holds fields; nothing holds a group.
 *
 * One level is a deliberate ceiling rather than a step towards more. It keeps
 * both the renderer and the layout engine non-recursive, and it is the depth the
 * feature was asked for: a client list whose clients each carry a few readings.
 * The menu inside a group is filtered through this, so the case simply cannot be
 * created from the UI.
 */
export const NESTABLE_FIELD_KINDS = FIELD_KINDS.filter(
  (kind): kind is Exclude<FieldKind, "group"> => kind !== "group",
);

/**
 * How large a field's value is drawn.
 *
 * Lives on the base rather than in each kind's `config` because it is a
 * presentation choice that means the same thing everywhere — a headline number
 * and a headline note are the same request. Keeping it out of `config` also
 * means resizing a field never rewrites its unit or target.
 */
export const VALUE_SCALES = ["s", "m", "l", "xl"] as const;
export type ValueScale = (typeof VALUE_SCALES)[number];

export const DEFAULT_SCALE: ValueScale = "m";

/** Menu copy for the size picker. */
export const VALUE_SCALE_LABELS: Record<ValueScale, string> = {
  s: "Small",
  m: "Medium",
  l: "Large",
  xl: "Huge",
};

export function isValueScale(value: unknown): value is ValueScale {
  return typeof value === "string" && (VALUE_SCALES as readonly string[]).includes(value);
}

export type NumberConfig = { prefix?: string; suffix?: string; decimals?: number };
export type ProgressConfig = {
  target: number;
  suffix?: string;
  /**
   * Which end of the bar is the good end.
   *
   * Filling up is usually progress — 30 of 120km run — so the default reads low
   * as bad. But a field can just as easily count something you want to keep down
   * (budget spent, weight to lose), where a full bar is the warning. Per-field
   * because the machinery has no idea what any of these mean.
   */
  invert?: boolean;
};

/**
 * A field, discriminated on `kind`.
 *
 * `value` is nullable in every variant: a field that exists but has never been
 * filled in is a normal state, not an error. It reads as "—" and stays editable.
 */
export type DashboardField = {
  id: string;
  label: string;
  position: number;
  /** Grid box, in columns and rows. See `grid.ts` for what the units mean. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** How large the value is drawn. Meaningless for `checkbox`, harmless there. */
  scale: ValueScale;
  /** The `group` this field sits in, or null at the dashboard's top level. */
  parentId: string | null;
  /**
   * Fields nested inside this one. Only ever populated for a `group`, and their
   * own `children` are always empty — the tree is two ranks tall by design.
   *
   * Assembled by the query layer from a flat row set rather than fetched per
   * group: Supabase is ~270ms away, so a round trip per group would cost more
   * than the whole page.
   */
  children: DashboardField[];
} & FieldValue;

/** A third of the width and one row: what a new field is worth before it holds anything. */
export const DEFAULT_FIELD_W = 4;
export const DEFAULT_FIELD_H = 1;

export type FieldValue =
  | { kind: "number"; config: NumberConfig; value: number | null }
  | { kind: "progress"; config: ProgressConfig; value: number | null }
  | { kind: "text"; config: Record<string, never>; value: string | null }
  | { kind: "date"; config: Record<string, never>; value: string | null }
  | { kind: "checkbox"; config: Record<string, never>; value: boolean | null }
  | { kind: "list"; config: Record<string, never>; value: string[] | null }
  // A group's contents are rows of their own, joined by `parentId` — never a
  // blob in `value`. Separate rows are what let a child be dragged, resized and
  // written independently, which is the entire point of the kind.
  | { kind: "group"; config: Record<string, never>; value: null };

/** What a freshly created field of each kind starts as. */
export function defaultsFor(kind: FieldKind): { config: unknown; value: unknown } {
  switch (kind) {
    case "number":
      return { config: {}, value: null };
    // A target of zero would divide by zero on the very first render, so a new
    // progress field starts at a usable 100 rather than an unusable 0.
    case "progress":
      return { config: { target: 100 }, value: null };
    case "list":
      return { config: {}, value: [] };
    default:
      return { config: {}, value: null };
  }
}

/** A group is a surface, not a reading, so it opens at half width and three rows. */
export const DEFAULT_GROUP_W = 6;
export const DEFAULT_GROUP_H = 3;

/**
 * Rebuilds a typed field from the two opaque jsonb columns.
 *
 * Returns `null` for an unrecognised kind rather than throwing: a row written by a
 * newer version of the app must not take down the whole dashboard for an older one.
 * Callers filter nulls out.
 */
export function parseField(row: {
  id: string;
  label: string;
  position: number;
  kind: string;
  config: unknown;
  value: unknown;
  gridX?: number;
  gridY?: number;
  gridW?: number;
  gridH?: number;
  scale?: string;
  parentId?: string | null;
}): DashboardField | null {
  if (!isFieldKind(row.kind)) return null;

  const base = {
    id: row.id,
    label: row.label,
    position: row.position,
    parentId: row.parentId ?? null,
    // Filled in by the query layer, which is the only place that has the whole
    // row set to group from. A field parsed on its own has no children yet.
    children: [] as DashboardField[],
    // An unrecognised size falls back rather than rejecting the field: a row
    // written by a newer build should still render, just at the default size.
    scale: isValueScale(row.scale) ? row.scale : DEFAULT_SCALE,
    // Optional so the mapper stays usable from a caller that has not selected
    // the layout columns. Falling back to `position` keeps fields written before
    // the grid existed in a sane single column rather than stacked at the origin.
    x: row.gridX ?? 0,
    y: row.gridY ?? row.position,
    w: row.gridW ?? DEFAULT_FIELD_W,
    h: row.gridH ?? DEFAULT_FIELD_H,
  };
  const config = asRecord(row.config);

  switch (row.kind) {
    case "number":
      return {
        ...base,
        kind: "number",
        config: {
          prefix: asString(config.prefix),
          suffix: asString(config.suffix),
          decimals: asFiniteNumber(config.decimals) ?? undefined,
        },
        value: asFiniteNumber(row.value),
      };

    case "progress":
      return {
        ...base,
        kind: "progress",
        // A missing or non-positive target would make the bar meaningless, so it
        // falls back rather than rendering a division by zero.
        config: {
          target: positiveOr(asFiniteNumber(config.target), 100),
          suffix: asString(config.suffix),
        },
        value: asFiniteNumber(row.value),
      };

    case "text":
      return { ...base, kind: "text", config: {}, value: asString(row.value) ?? null };

    case "date":
      return { ...base, kind: "date", config: {}, value: asDateString(row.value) };

    case "checkbox":
      return {
        ...base,
        kind: "checkbox",
        config: {},
        value: typeof row.value === "boolean" ? row.value : null,
      };

    case "list":
      return {
        ...base,
        kind: "list",
        config: {},
        value: Array.isArray(row.value)
          ? row.value.filter((entry): entry is string => typeof entry === "string")
          : null,
      };

    case "group":
      return { ...base, kind: "group", config: {}, value: null };
  }
}

export function isFieldKind(value: unknown): value is FieldKind {
  return typeof value === "string" && (FIELD_KINDS as readonly string[]).includes(value);
}

/**
 * Narrows a value submitted from the client to what its kind can hold.
 *
 * Server Actions take `unknown` from the wire, so this runs before every write —
 * it is what stops a string landing in a number field and reading as `NaN` forever.
 */
export function coerceValue(kind: FieldKind, value: unknown): unknown {
  if (value === null || value === undefined) return null;

  switch (kind) {
    case "number":
    case "progress": {
      if (typeof value === "number") return Number.isFinite(value) ? value : null;
      if (typeof value !== "string") return null;
      // Typed input arrives as a string, and an empty one means "cleared", not zero.
      const trimmed = value.trim();
      if (!trimmed) return null;
      const parsed = Number(trimmed.replace(/,/g, ""));
      return Number.isFinite(parsed) ? parsed : null;
    }

    case "text":
      return typeof value === "string" ? value.slice(0, MAX_TEXT_LENGTH) : null;

    case "date":
      return asDateString(value);

    case "checkbox":
      return typeof value === "boolean" ? value : null;

    case "list":
      return Array.isArray(value)
        ? value
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.slice(0, MAX_TEXT_LENGTH))
            .slice(0, MAX_LIST_ITEMS)
        : null;

    // A group holds rows, not a reading. Anything sent for its value is dropped
    // rather than stored, so a client cannot smuggle a blob into a column
    // nothing reads.
    case "group":
      return null;
  }
}

/** Narrows a config blob the same way, so a bad target can never reach the bar. */
export function coerceConfig(kind: FieldKind, config: unknown): unknown {
  const record = asRecord(config);

  switch (kind) {
    case "number":
      return stripUndefined({
        prefix: asShortString(record.prefix),
        suffix: asShortString(record.suffix),
        decimals: clampDecimals(asFiniteNumber(record.decimals)),
      });

    case "progress":
      return stripUndefined({
        target: positiveOr(asFiniteNumber(record.target), 100),
        suffix: asShortString(record.suffix),
        // Only a real `true` survives. Anything else means "not inverted", so a
        // truthy string out of a jsonb blob cannot silently flip the colours.
        invert: record.invert === true ? true : undefined,
      });

    default:
      return {};
  }
}

export const MAX_TEXT_LENGTH = 500;
export const MAX_LIST_ITEMS = 50;
export const MAX_LABEL_LENGTH = 120;

/** 0–1, clamped. Over-target reads as full rather than overflowing the track. */
export function progressFraction(field: Extract<DashboardField, { kind: "progress" }>): number {
  if (field.value === null) return 0;
  return Math.max(0, Math.min(1, field.value / field.config.target));
}

/** Where the thresholds sit. Two thirds is "nearly there", one third "barely started". */
const TONE_HIGH = 2 / 3;
const TONE_LOW = 1 / 3;

export type ProgressTone = "low" | "mid" | "high";

/**
 * Severity as a colour, so a bar is readable without reading the number.
 *
 * `high` always means the good end, never the full end — `invert` swaps which is
 * which. That indirection is the whole point: the caller paints `high` green
 * without needing to know whether the field counts up to something good or down
 * from something bad.
 */
export function progressTone(fraction: number, invert = false): ProgressTone {
  const good = invert ? 1 - fraction : fraction;
  if (good >= TONE_HIGH) return "high";
  if (good >= TONE_LOW) return "mid";
  return "low";
}

/**
 * The value as one scannable line.
 *
 * Every kind formats to a single string so a field reads the same in the dashboard
 * and in the glance-sized pause-menu tab. `null` is "—" everywhere: an empty field
 * should look deliberately empty rather than broken.
 */
export function formatValue(field: DashboardField, now: Date): string {
  switch (field.kind) {
    case "number": {
      if (field.value === null) return EMPTY;
      const { prefix = "", suffix = "", decimals } = field.config;
      return `${prefix}${formatNumber(field.value, decimals)}${suffix ? ` ${suffix}` : ""}`;
    }

    case "progress": {
      const suffix = field.config.suffix ? ` ${field.config.suffix}` : "";
      const target = formatNumber(field.config.target);
      if (field.value === null) return `${EMPTY} / ${target}${suffix}`;
      return `${formatNumber(field.value)} / ${target}${suffix}`;
    }

    case "text":
      return field.value || EMPTY;

    case "date":
      return field.value ? formatRelativeDate(field.value, now) : EMPTY;

    case "checkbox":
      if (field.value === null) return EMPTY;
      return field.value ? "Done" : "Not done";

    case "list": {
      const items = field.value ?? [];
      if (items.length === 0) return EMPTY;
      return items.join(", ");
    }

    // A group has no reading of its own, so the honest one-line summary is how
    // much it holds. The glance has no room to expand it, and listing the
    // children's values there would misattribute them to the group's label.
    case "group": {
      const count = field.children.length;
      if (count === 0) return EMPTY;
      return `${count} ${count === 1 ? "field" : "fields"}`;
    }
  }
}

const EMPTY = "—";

/** Thousands separators, and a fixed decimal count only when one was configured. */
export function formatNumber(value: number, decimals?: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals ?? 0,
    maximumFractionDigits: decimals ?? 2,
  });
}

/**
 * A date as its age — "3 days ago", not "2026-08-08".
 *
 * This is the point of the date kind. "Last called Dad" is only useful as a number
 * of days; the calendar date makes you do the subtraction yourself, which is exactly
 * the work a status surface exists to remove.
 *
 * Compared by calendar day rather than by elapsed hours, so something logged last
 * night still reads "yesterday" this morning instead of "1 day ago" at 23 hours and
 * "2 days ago" at 25.
 */
export function formatRelativeDate(iso: string, now: Date): string {
  const then = parseDateOnly(iso);
  if (!then) return EMPTY;

  const days = Math.round((startOfDay(now).getTime() - then.getTime()) / DAY_MS);

  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days === -1) return "Tomorrow";
  if (days < 0) return `In ${describeSpan(-days)}`;
  return `${describeSpan(days)} ago`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function describeSpan(days: number): string {
  if (days < 7) return `${days} days`;
  if (days < 30) {
    const weeks = Math.round(days / 7);
    return `${weeks} ${weeks === 1 ? "week" : "weeks"}`;
  }
  if (days < 365) {
    const months = Math.round(days / 30);
    return `${months} ${months === 1 ? "month" : "months"}`;
  }
  const years = Math.round((days / 365) * 10) / 10;
  return `${years} ${years === 1 ? "year" : "years"}`;
}

/** Local midnight. Dates are calendar days here, never instants. */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * `YYYY-MM-DD` in the local calendar.
 *
 * Built component-wise rather than via `new Date(iso)`, which parses a bare date as
 * UTC midnight and lands on the previous day for anyone west of Greenwich.
 *
 * The read-back check is what rejects an impossible date: `new Date(2026, 12, 40)`
 * does not return `NaN`, it rolls over into February 2027 — so month 13 day 40 would
 * otherwise be stored as a real date nobody typed.
 */
function parseDateOnly(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));

  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    return null;
  }

  return date;
}

/** Stored as `YYYY-MM-DD`: a dashboard date is a day, not a moment. */
function asDateString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return parseDateOnly(value) ? match[0] : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asShortString(value: unknown): string | undefined {
  const text = asString(value)?.trim();
  return text ? text.slice(0, 16) : undefined;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveOr(value: number | null, fallback: number): number {
  return value !== null && value > 0 ? value : fallback;
}

function clampDecimals(value: number | null): number | undefined {
  if (value === null) return undefined;
  return Math.max(0, Math.min(4, Math.round(value)));
}

/** jsonb keeps explicit nulls, so unset config keys are dropped rather than stored. */
function stripUndefined<T extends Record<string, unknown>>(record: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
