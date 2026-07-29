import Link from "next/link";
import { format } from "date-fns";

import { ConnectionCard } from "@/components/settings/connection-card";
import { calendarPath } from "@/lib/date";
import { requireUserId } from "@/server/auth";
import { getConnections } from "@/server/queries/connections";

/** What the OAuth callback can redirect back with, in words a human can act on. */
const ERRORS: Record<string, string> = {
  declined: "You cancelled the Google prompt. Nothing was connected.",
  state_mismatch: "That sign-in link expired. Try connecting again.",
  exchange_failed: "Google refused the connection. Try again.",
  sync_failed: "Connected, but the first import failed. Use Sync now to retry.",
};

export default async function CalendarSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { connected, error } = await searchParams;
  const connections = await getConnections(await requireUserId());

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Link
          href={calendarPath("week", new Date())}
          className="text-sm text-zinc-500 underline-offset-4 hover:underline"
        >
          ← Calendar
        </Link>

        <h1 className="mt-6 text-xl font-semibold tracking-tight">Google Calendar</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Timeblock reads your primary calendar so meetings show up on the grid. It writes nothing
          back, and the notes you keep inside a block never leave here.
        </p>

        {error ? (
          <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
            {ERRORS[error] ?? "Something went wrong connecting Google."}
          </p>
        ) : connected ? (
          <p className="mt-6 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
            Connected. Your calendar has been imported.
          </p>
        ) : null}

        <div className="mt-8 space-y-3">
          {connections.map((connection) => (
            <ConnectionCard key={connection.connectionId} connection={connection} />
          ))}

          {connections.length === 0 ? (
            <p className="text-sm text-zinc-500">No calendar connected yet.</p>
          ) : null}
        </div>

        {/* A plain link, not a fetch: the OAuth flow is a top-level navigation
            to Google and back, and it has to set a state cookie on the way. */}
        <a
          href="/api/google/oauth/start"
          className="mt-6 inline-flex rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {connections.length === 0 ? "Connect Google Calendar" : "Connect another account"}
        </a>

        {connections.length > 0 ? (
          <p className="mt-8 text-xs text-zinc-400">
            Last checked{" "}
            {connections[0].lastSyncedAt
              ? format(connections[0].lastSyncedAt, "d MMM, HH:mm")
              : "never"}
            . Timeblock re-checks every five minutes.
          </p>
        ) : null}
      </div>
    </div>
  );
}
