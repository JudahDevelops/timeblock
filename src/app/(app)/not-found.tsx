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
        <p className="text-sm text-zinc-500">
          That date or view doesn&apos;t exist. Try a URL like{" "}
          <code className="font-mono text-xs text-zinc-400">/calendar/week/2026-07-29</code>.
        </p>
        <Link
          href={calendarPath("week", new Date())}
          className="inline-block rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-zinc-50 transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Back to this week
        </Link>
      </div>
    </div>
  );
}
