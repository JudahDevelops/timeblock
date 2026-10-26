import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * Postgres `tsvector`. Drizzle has no built-in type for it, and we only ever
 * read/write it through generated columns and `to_tsquery`, so an opaque
 * custom type is enough.
 */
const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

/**
 * A block of time. The `body` is the whole point of this product: a BlockNote
 * document that lives only here.
 */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),

    title: text("title").notNull().default(""),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    allDay: boolean("all_day").notNull().default(false),
    /** IANA zone the event was authored in, e.g. "Africa/Lagos". */
    tz: text("tz").notNull(),

    /**
     * Where this event came from. Google sync has been removed and its rows
     * converted to "local", so nothing writes "google" any more; the UI still
     * treats such a row as read-only if one ever appears.
     */
    origin: text("origin", { enum: ["local", "google"] })
      .notNull()
      .default("local"),

    /**
     * Set on instances of a recurring series.
     *
     * Only ever written by the removed Google import, which expanded recurrence
     * into single instances. There is no RRULE column to go with it.
     */
    recurringEventId: text("recurring_event_id"),
    originalStartTime: timestamp("original_start_time", { withTimezone: true }),

    /** BlockNote `Block[]`. Canonical, local-only. */
    body: jsonb("body")
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Plaintext rendering of `body`, derived server-side. Feeds search. */
    bodyText: text("body_text"),
    /** Optimistic concurrency guard for autosave. */
    bodyRev: integer("body_rev").notNull().default(0),

    /**
     * Pins the status window's cursor to one checklist item, overriding the
     * default of "first unchecked".
     *
     * Holds a BlockNote block id, which is why there is no foreign key to point
     * it at: checklist items live inside `body`'s jsonb, not in a table. The id
     * is stable across edits, but it can still go stale — the item can be
     * deleted, or the whole checklist replaced — so every read falls back rather
     * than trusting it. Null means "follow the default", which is also what a
     * cleared override writes back.
     */
    cursorItemId: text("cursor_item_id"),

    /** Soft-delete tombstone. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),

    searchTsv: tsvector("search_tsv").generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body_text, ''))`,
    ),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("events_search_idx").using("gin", t.searchTsv),
    index("events_user_range_idx").on(t.userId, t.startsAt),
    index("events_recurring_idx").on(t.recurringEventId),
  ],
);

/**
 * A standalone page — not tied to any time slot. The user's Notion-style
 * scratchpad: a title, an optional emoji, and a BlockNote document.
 */
export const pages = pgTable(
  "pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),

    title: text("title").notNull().default(""),
    /** A single emoji displayed beside the title, like Notion page icons. */
    emoji: text("emoji"),

    /** BlockNote `Block[]`. Same format as event bodies. */
    body: jsonb("body")
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Plaintext rendering of `body`, derived server-side. Feeds search. */
    bodyText: text("body_text"),
    /** Optimistic concurrency guard for autosave. */
    bodyRev: integer("body_rev").notNull().default(0),

    /** Soft delete, same tombstone approach as events. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),

    searchTsv: tsvector("search_tsv").generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body_text, ''))`,
    ),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pages_search_idx").using("gin", t.searchTsv),
    index("pages_user_idx").on(t.userId),
  ],
);

/**
 * A user-defined tracker. Deliberately knows nothing about time or calendars:
 * this is the "how am I doing generally" surface, where events are the "what is
 * happening now" one. Money, exercise and people are all just dashboards.
 */
export const dashboards = pgTable(
  "dashboards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),

    name: text("name").notNull().default(""),
    /** A single emoji beside the name, matching how `pages` are labelled. */
    emoji: text("emoji"),

    /** Manual ordering, which is also the tab order in the pause menu. */
    position: integer("position").notNull().default(0),

    deletedAt: timestamp("deleted_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("dashboards_user_idx").on(t.userId, t.position)],
);

/**
 * One field on a dashboard.
 *
 * `kind` is the union tag from `src/lib/dashboard/field.ts`, stored as free text
 * rather than a pg enum so adding a type is a code change and not a migration that
 * has to lock the table.
 *
 * `config` and `value` are separate columns for the same reason they are separate
 * in the type: editing a target must not rewrite the reading, and clearing a
 * reading must not lose the unit.
 *
 * The `grid_*` columns are written from day one even though phase 2a renders a
 * single ordered column. Carrying them now makes the free-form grid a rendering
 * change later rather than a migration against live data.
 */
export const dashboardFields = pgTable(
  "dashboard_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dashboardId: uuid("dashboard_id")
      .notNull()
      .references(() => dashboards.id, { onDelete: "cascade" }),
    /** Denormalised from the parent so every query can scope on it directly. */
    userId: uuid("user_id").notNull(),

    /**
     * The `group` field this one sits inside, or null at the top level.
     *
     * Self-referencing, and deliberately only one level deep — nothing enforces
     * that in the column, but a group is not offered inside a group, so the tree
     * stays two ranks tall. That keeps rendering and the layout engine
     * non-recursive; deeper nesting later is a behaviour change, not a migration.
     *
     * `onDelete: "cascade"` because a child has nowhere to live once its group is
     * gone — leaving it behind would strand it invisibly outside every surface.
     */
    parentId: uuid("parent_id").references((): AnyPgColumn => dashboardFields.id, {
      onDelete: "cascade",
    }),

    label: text("label").notNull().default(""),
    kind: text("kind").notNull(),

    /** Per-kind settings: unit, prefix, target. Never the reading itself. */
    config: jsonb("config")
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** The current reading. Shape depends on `kind`; parsed at the boundary. */
    value: jsonb("value"),

    position: integer("position").notNull().default(0),

    gridX: integer("grid_x").notNull().default(0),
    gridY: integer("grid_y").notNull().default(0),
    gridW: integer("grid_w").notNull().default(6),
    gridH: integer("grid_h").notNull().default(2),

    /**
     * How large the value is drawn: s | m | l | xl.
     *
     * Its own column rather than a key in `config`, which holds per-kind
     * settings — this means the same thing for every kind, and keeping it out
     * means resizing a field never rewrites its unit or target. Text rather
     * than an enum so a new size is a deploy, not a migration; `parseField`
     * is the boundary that rejects anything unrecognised.
     */
    scale: text("scale").notNull().default("m"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("dashboard_fields_dashboard_idx").on(t.dashboardId, t.position),
    index("dashboard_fields_user_idx").on(t.userId),
    /** Grouping children under their parent is a per-render lookup. */
    index("dashboard_fields_parent_idx").on(t.parentId),
  ],
);

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type Page = typeof pages.$inferSelect;
export type NewPage = typeof pages.$inferInsert;
export type Dashboard = typeof dashboards.$inferSelect;
export type NewDashboard = typeof dashboards.$inferInsert;
export type DashboardFieldRow = typeof dashboardFields.$inferSelect;
