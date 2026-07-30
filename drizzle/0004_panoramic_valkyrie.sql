CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"emoji" text,
	"body" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"body_text" text,
	"body_rev" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body_text, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pages_search_idx" ON "pages" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "pages_user_idx" ON "pages" USING btree ("user_id");