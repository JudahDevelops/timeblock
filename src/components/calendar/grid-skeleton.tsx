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
              className="absolute right-2 -translate-y-1/2 text-[11px] text-zinc-400 tabular-nums"
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
                className="absolute inset-x-0 border-t border-zinc-100 dark:border-zinc-900"
                style={{ top: minutesToY(hour * 60) }}
              />
            ))}
          </div>

          {Array.from({ length: columns }, (_, i) => (
            <div
              key={i}
              className="flex-1 border-r border-zinc-200 last:border-r-0 dark:border-zinc-800"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
