import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
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

/** Encrypted-at-rest token blob. Never leaves the server. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/**
 * A block of time. The `body` is the whole point of this product: a BlockNote
 * document that lives only here. Google never receives it (see `event_links`).
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
     * Where this event came from. Google-origin events are read-only until the
     * connection's `direction` allows writes.
     */
    origin: text("origin", { enum: ["local", "google"] })
      .notNull()
      .default("local"),

    /**
     * Set on instances of a recurring series.
     *
     * There is no RRULE column to go with it: `singleEvents: true` means Google
     * expands recurrence for us and never sends the series master, so an
     * instance is the only form a repeating event takes here.
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

    /** 30-day tombstone so a 410 full-resync cannot resurrect a deletion. */
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
 * A connected Google identity. Separate from Supabase Auth on purpose:
 * Supabase returns `provider_token`/`provider_refresh_token` once at sign-in
 * and never persists them, so we run our own OAuth flow and own the refresh
 * token ourselves.
 */
export const googleAccounts = pgTable(
  "google_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    googleSub: text("google_sub").notNull().unique(),
    email: text("email").notNull(),

    refreshTokenEnc: bytea("refresh_token_enc").notNull(),
    accessTokenEnc: bytea("access_token_enc"),
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }),

    scopes: text("scopes").array().notNull(),
    /** Set when Google returns `invalid_grant`; surfaces a reconnect banner. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("google_accounts_user_idx").on(t.userId)],
);

/** One row per Google calendar we sync, holding that calendar's sync cursor. */
export const calendarConnections = pgTable(
  "calendar_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    googleAccountId: uuid("google_account_id")
      .notNull()
      .references(() => googleAccounts.id, { onDelete: "cascade" }),
    gcalCalendarId: text("gcal_calendar_id").notNull(),

    /** Opaque cursor from `events.list`. Null forces a full sync. */
    syncToken: text("sync_token"),
    lastFullSyncAt: timestamp("last_full_sync_at", { withTimezone: true }),
    /** Staleness alarm: if this goes quiet, a watch channel probably died. */
    lastInboundOkAt: timestamp("last_inbound_ok_at", { withTimezone: true }),

    channelId: uuid("channel_id"),
    channelResourceId: text("channel_resource_id"),
    /** Shared secret echoed back by Google. The webhook's ONLY authentication. */
    channelToken: text("channel_token"),
    channelExpiration: timestamp("channel_expiration", { withTimezone: true }),

    direction: text("direction", { enum: ["read", "write", "both"] })
      .notNull()
      .default("read"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("calendar_connections_user_idx").on(t.userId),
    index("calendar_connections_channel_idx").on(t.channelId),
    // Reconnecting the same Google account must update the one row that holds
    // its sync cursor, not start a second that re-imports everything.
    uniqueIndex("calendar_connections_account_calendar_idx").on(
      t.googleAccountId,
      t.gcalCalendarId,
    ),
  ],
);

/**
 * Maps a local event to its Google counterpart. Deliberately keyed by the
 * Google pair so a lost local row can still be reconciled during a full
 * resync — this is what stops a 410 from destroying block bodies.
 */
export const eventLinks = pgTable(
  "event_links",
  {
    gcalCalendarId: text("gcal_calendar_id").notNull(),
    gcalEventId: text("gcal_event_id").notNull(),
    localEventId: uuid("local_event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),

    gcalEtag: text("gcal_etag"),
    gcalUpdated: timestamp("gcal_updated", { withTimezone: true }),
    /**
     * Hash of the stub description we last wrote. If Google's description
     * hashes differently, a human edited it there and we append rather than
     * overwrite.
     */
    gcalDescriptionHash: text("gcal_description_hash"),

    lastPushedAt: timestamp("last_pushed_at", { withTimezone: true }),
    lastPulledAt: timestamp("last_pulled_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.gcalCalendarId, t.gcalEventId] }),
    index("event_links_local_idx").on(t.localEventId),
    // Detects a calendar-to-calendar move, which Google reports as
    // "cancelled in A" + "created in B" with the same event id.
    index("event_links_gcal_event_idx").on(t.gcalEventId),
  ],
);

/** Durable work queue. Webhooks enqueue here and return 200 immediately. */
export const syncJobs = pgTable(
  "sync_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => calendarConnections.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["full_sync", "incremental_sync", "push", "renew_channel"],
    }).notNull(),
    state: text("state", { enum: ["pending", "running", "done", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /** Checkpointed `pageToken` etc., so a long sync can self-requeue. */
    payload: jsonb("payload")
      .notNull()
      .default(sql`'{}'::jsonb`),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sync_jobs_claim_idx").on(t.state, t.runAfter),
    // A burst of webhook pings is one calendar changing, not twenty. Enforcing
    // that in the index makes enqueueing a single `on conflict do nothing`
    // insert, which a check-then-write could not do without racing itself.
    uniqueIndex("sync_jobs_pending_idx")
      .on(t.connectionId, t.kind)
      .where(sql`state = 'pending'`),
  ],
);

/** Audit trail for every last-write-wins resolution, so we can prove correctness. */
export const syncConflicts = pgTable(
  "sync_conflicts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    localEventId: uuid("local_event_id").references(() => events.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    localValue: text("local_value"),
    remoteValue: text("remote_value"),
    resolvedAs: text("resolved_as", { enum: ["local", "remote"] }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sync_conflicts_event_idx").on(t.localEventId)],
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
export type GoogleAccount = typeof googleAccounts.$inferSelect;
export type CalendarConnection = typeof calendarConnections.$inferSelect;
export type EventLink = typeof eventLinks.$inferSelect;
export type SyncJob = typeof syncJobs.$inferSelect;
export type Page = typeof pages.$inferSelect;
export type NewPage = typeof pages.$inferInsert;
export type Dashboard = typeof dashboards.$inferSelect;
export type NewDashboard = typeof dashboards.$inferInsert;
export type DashboardFieldRow = typeof dashboardFields.$inferSelect;
