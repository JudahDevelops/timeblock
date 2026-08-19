ALTER TABLE "dashboard_fields" ALTER COLUMN "grid_h" SET DEFAULT 2;--> statement-breakpoint
-- The other half of the granularity change. 0009 doubled the horizontal axis;
-- this does the vertical, by halving the row height in the client and doubling
-- every stored `grid_y` and `grid_h` to match.
--
-- Geometry is preserved exactly. A field's height is `h * (CELL_HEIGHT + GAP) -
-- GAP`, so the gap sits inside the row: the row had to halve, not the cell.
-- 44 + 8 is 52, exactly half of the 104 the grid stepped by before, which is why
-- doubling `h` here lands every card on the pixel it already occupied.
--
-- NOT idempotent. Running it twice doubles the heights again.
UPDATE "dashboard_fields" SET "grid_y" = "grid_y" * 2, "grid_h" = "grid_h" * 2;
