CREATE TABLE "dashboard_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dashboard_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"value" jsonb,
	"position" integer DEFAULT 0 NOT NULL,
	"grid_x" integer DEFAULT 0 NOT NULL,
	"grid_y" integer DEFAULT 0 NOT NULL,
	"grid_w" integer DEFAULT 3 NOT NULL,
	"grid_h" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"emoji" text,
	"position" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dashboard_fields" ADD CONSTRAINT "dashboard_fields_dashboard_id_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dashboard_fields_dashboard_idx" ON "dashboard_fields" USING btree ("dashboard_id","position");--> statement-breakpoint
CREATE INDEX "dashboard_fields_user_idx" ON "dashboard_fields" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "dashboards_user_idx" ON "dashboards" USING btree ("user_id","position");