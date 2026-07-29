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

    /** RRULE strings, stored verbatim as Google returns them. */
    recurrence: text("recurrence").array(),
    /** Set on instances of a recurring series. */
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

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type GoogleAccount = typeof googleAccounts.$inferSelect;
export type CalendarConnection = typeof calendarConnections.$inferSelect;
export type EventLink = typeof eventLinks.$inferSelect;
export type SyncJob = typeof syncJobs.$inferSelect;
