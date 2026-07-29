"use client";

import { useEffect, useState } from "react";

import { minutesSinceMidnight, minutesToY } from "@/lib/calendar/geometry";

export function NowIndicator() {
  const [minutes, setMinutes] = useState<number | null>(null);

  // Set on the client only: rendering "now" during SSR would hydrate stale,
  // and the position depends on the viewer's timezone.
  useEffect(() => {
    const tick = () => setMinutes(minutesSinceMidnight(new Date()));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  if (minutes === null) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
      style={{ top: minutesToY(minutes) }}
      aria-hidden="true"
    >
      <div className="bg-now h-2 w-2 -translate-x-1/2 rounded-full" />
      <div className="bg-now h-px flex-1" />
    </div>
  );
}
