ALTER TABLE "dashboard_fields" ALTER COLUMN "grid_w" SET DEFAULT 6;--> statement-breakpoint
-- The grid went from 12 columns to 24. Every stored box is expressed in columns,
-- so without this each existing field would render at half its intended width,
-- hard against the left edge — and `updateFieldLayout` re-clamps server-side, so
-- the first drag on an un-migrated dashboard would write that in permanently.
--
-- Doubling is exact: 24 is twice 12, so there is nothing to round. Heights are
-- untouched, this being a horizontal change only.
--
-- NOT idempotent. Running it twice doubles the widths again.
UPDATE "dashboard_fields" SET "grid_x" = "grid_x" * 2, "grid_w" = "grid_w" * 2;
