CREATE TABLE "calendar_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"google_account_id" uuid NOT NULL,
	"gcal_calendar_id" text NOT NULL,
	"sync_token" text,
	"last_full_sync_at" timestamp with time zone,
	"last_inbound_ok_at" timestamp with time zone,
	"channel_id" uuid,
	"channel_resource_id" text,
	"channel_token" text,
	"channel_expiration" timestamp with time zone,
	"direction" text DEFAULT 'read' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_links" (
	"gcal_calendar_id" text NOT NULL,
	"gcal_event_id" text NOT NULL,
	"local_event_id" uuid NOT NULL,
	"gcal_etag" text,
	"gcal_updated" timestamp with time zone,
	"gcal_description_hash" text,
	"last_pushed_at" timestamp with time zone,
	"last_pulled_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "event_links_gcal_calendar_id_gcal_event_id_pk" PRIMARY KEY("gcal_calendar_id","gcal_event_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"tz" text NOT NULL,
	"origin" text DEFAULT 'local' NOT NULL,
	"recurrence" text[],
	"recurring_event_id" text,
	"original_start_time" timestamp with time zone,
	"body" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"body_text" text,
	"body_rev" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body_text, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"google_sub" text NOT NULL,
	"email" text NOT NULL,
	"refresh_token_enc" "bytea" NOT NULL,
	"access_token_enc" "bytea",
	"access_expires_at" timestamp with time zone,
	"scopes" text[] NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_accounts_google_sub_unique" UNIQUE("google_sub")
);
--> statement-breakpoint
CREATE TABLE "sync_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"local_event_id" uuid,
	"field" text NOT NULL,
	"local_value" text,
	"remote_value" text,
	"resolved_as" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_google_account_id_google_accounts_id_fk" FOREIGN KEY ("google_account_id") REFERENCES "public"."google_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_links" ADD CONSTRAINT "event_links_local_event_id_events_id_fk" FOREIGN KEY ("local_event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_local_event_id_events_id_fk" FOREIGN KEY ("local_event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_connection_id_calendar_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_connections_user_idx" ON "calendar_connections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "calendar_connections_channel_idx" ON "calendar_connections" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "event_links_local_idx" ON "event_links" USING btree ("local_event_id");--> statement-breakpoint
CREATE INDEX "event_links_gcal_event_idx" ON "event_links" USING btree ("gcal_event_id");--> statement-breakpoint
CREATE INDEX "events_search_idx" ON "events" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "events_user_range_idx" ON "events" USING btree ("user_id","starts_at");--> statement-breakpoint
CREATE INDEX "events_recurring_idx" ON "events" USING btree ("recurring_event_id");--> statement-breakpoint
CREATE INDEX "google_accounts_user_idx" ON "google_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sync_conflicts_event_idx" ON "sync_conflicts" USING btree ("local_event_id");--> statement-breakpoint
CREATE INDEX "sync_jobs_claim_idx" ON "sync_jobs" USING btree ("state","run_after");