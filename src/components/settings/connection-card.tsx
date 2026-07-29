"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";

import { disconnectGoogle } from "@/server/actions/google";
import type { ConnectionStatus } from "@/server/queries/connections";

export function ConnectionCard({ connection }: { connection: ConnectionStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const syncNow = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const response = await fetch("/api/sync/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: connection.connectionId }),
      });
      const result = await response.json();

      if (!response.ok) {
        setMessage(
          result.error === "revoked"
            ? "Google revoked access. Reconnect to keep syncing."
            : "Sync failed. Try again.",
        );
      } else {
        // A healthy incremental sync almost always finds nothing, and
        // "Imported 0, removed 0" reads like a failure rather than the
        // all-clear it is.
        setMessage(
          result.imported === 0 && result.cancelled === 0
            ? "Already up to date."
            : `Imported ${result.imported}, removed ${result.cancelled}.`,
        );
        router.refresh();
      }
    } catch {
      setMessage("Sync failed. Try again.");
    } finally {
      setSyncing(false);
    }
  };

  const disconnect = () => {
    // Imported blocks keep their bodies, so this is recoverable — but it does
    // throw away the refresh token, so it is worth one confirmation.
    if (!window.confirm(`Disconnect ${connection.email}?`)) return;
    startTransition(async () => {
      await disconnectGoogle(connection.connectionId);
      router.refresh();
    });
  };

  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{connection.email}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {connection.calendarId === "primary" ? "Primary calendar" : connection.calendarId} ·{" "}
            {connection.importedCount} event{connection.importedCount === 1 ? "" : "s"} imported
            {connection.lastSyncedAt
              ? ` · synced ${formatDistanceToNow(connection.lastSyncedAt, { addSuffix: true })}`
              : " · never synced"}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={syncNow}
            disabled={syncing || connection.revoked}
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium disabled:opacity-50 dark:border-zinc-800"
          >
            {syncing ? "Syncing…" : "Sync now"}
          </button>
          <button
            type="button"
            onClick={disconnect}
            disabled={pending}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-red-600 disabled:opacity-50 dark:text-red-400"
          >
            Disconnect
          </button>
        </div>
      </div>

      {connection.revoked ? (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Google revoked this grant. Connect again to resume syncing — your existing blocks and
          their notes are untouched.
        </p>
      ) : null}

      {message ? <p className="mt-3 text-xs text-zinc-500">{message}</p> : null}
    </div>
  );
}
