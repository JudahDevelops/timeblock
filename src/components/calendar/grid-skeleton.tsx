import { DAY_HEIGHT, GUTTER_WIDTH, HOURS, minutesToY } from "@/lib/calendar/geometry";

/**
 * The grid without its events. Rendered while the day's rows are still in
 * flight so navigation paints immediately instead of waiting on the database.
 */
export function GridSkeleton({ columns }: { columns: number }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex" style={{ height: DAY_HEIGHT }}>
        <div className="relative shrink-0" style={{ width: GUTTER_WIDTH }}>
          {HOURS.map((hour) => (
            <div
              key={hour}
              className="text-ink-faint absolute right-2 -translate-y-1/2 text-[11px] tabular-nums"
              style={{ top: minutesToY(hour * 60) }}
            >
              {hour === 0 ? "" : `${hour.toString().padStart(2, "0")}:00`}
            </div>
          ))}
        </div>

        <div className="relative flex flex-1">
          <div className="pointer-events-none absolute inset-0">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="border-line absolute inset-x-0 border-t"
                style={{ top: minutesToY(hour * 60) }}
              />
            ))}
          </div>

          {Array.from({ length: columns }, (_, i) => (
            <div key={i} className="border-line flex-1 border-r last:border-r-0" />
          ))}
        </div>
      </div>
    </div>
  );
}
