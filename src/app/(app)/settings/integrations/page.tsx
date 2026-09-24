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
  account_in_use: "That Google account is already connected to a different Timeblock account.",
};

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { connected, error } = await searchParams;
  const connections = await getConnections(await requireUserId());

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* Prose, not a drag surface — account emails and error text are worth
          being able to copy, so this opts back out of the global lock. */}
      <div className="mx-auto max-w-2xl px-6 py-10 select-text">
        <Link
          href={calendarPath("week", new Date())}
          className="text-ink-muted text-sm underline-offset-4 hover:underline"
        >
          ← Calendar
        </Link>

        <h1 className="mt-6 text-xl font-semibold tracking-tight">Integrations</h1>
        <p className="text-ink-muted mt-1 text-sm">
          Google Calendar is the only one so far. Timeblock reads your primary calendar so meetings
          show up on the grid, and the notes you keep inside a block never leave here.
        </p>

        {error ? (
          <p className="bg-danger-surface text-danger mt-6 rounded-lg px-4 py-3 text-sm">
            {ERRORS[error] ?? "Something went wrong connecting Google."}
          </p>
        ) : connected ? (
          <p className="bg-ok-surface text-ok mt-6 rounded-lg px-4 py-3 text-sm">
            Connected. Your calendar has been imported.
          </p>
        ) : null}

        <div className="mt-8 space-y-3">
          {connections.map((connection) => (
            <ConnectionCard key={connection.connectionId} connection={connection} />
          ))}

          {connections.length === 0 ? (
            <p className="text-ink-muted text-sm">No calendar connected yet.</p>
          ) : null}
        </div>

        {/* A plain link, not a fetch: the OAuth flow is a top-level navigation
            to Google and back, and it has to set a state cookie on the way. */}
        <a
          href="/api/google/oauth/start"
          className="bg-ink text-surface mt-6 inline-flex rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
        >
          {connections.length === 0 ? "Connect Google Calendar" : "Connect another account"}
        </a>

        {connections.length > 0 ? (
          <p className="text-ink-faint mt-8 text-xs">
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
