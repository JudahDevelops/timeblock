import Link from "next/link";

import { calendarPath } from "@/lib/date";

/**
 * A calendar URL that names a view or a date we cannot parse.
 *
 * Mostly reached by hand-editing the address bar or by following an old link.
 * The way out is always the same, so it is the only thing offered.
 */
export default function AppNotFound() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-sm space-y-4 text-center">
        <h1 className="text-lg font-semibold tracking-tight">No such page</h1>
        <p className="text-ink-muted text-sm">
          That date or view doesn&apos;t exist. Try a URL like{" "}
          <code className="text-ink-faint font-mono text-xs">/calendar/week/2026-07-29</code>.
        </p>
        <Link
          href={calendarPath("week", new Date())}
          className="bg-ink text-surface inline-block rounded-md px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-90"
        >
          Back to this week
        </Link>
      </div>
    </div>
  );
}
