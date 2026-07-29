import "server-only";

import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import { syncJobs } from "@/db/schema";
import { GoogleRevokedError } from "@/lib/google/auth";
import { syncConnection } from "@/lib/sync/engine";

/**
 * The durable half of the webhook path.
 *
 * A notification is a one-shot delivery Google will not usefully repeat, so it
 * has to become a row before the response goes out. The sync itself then runs
 * after the response, and if that attempt dies with the function the row is
 * still there for the five-minute cron to find. Losing a ping costs latency,
 * never correctness.
 */

/** Enough retries to ride out a Google blip, few enough to stop shouting. */
const MAX_ATTEMPTS = 5;

const KIND = "incremental_sync" as const;

export type JobOutcome = { ran: number; failed: number };

/**
 * Records that a calendar has changed.
 *
 * Deduped in Postgres rather than here: a partial unique index over pending
 * rows turns a burst of pings into the one job they actually represent, without
 * a read-then-write that two concurrent notifications could both win.
 */
export async function enqueueSync(connectionId: string): Promise<void> {
  await db
    .insert(syncJobs)
    .values({ connectionId, kind: KIND })
    .onConflictDoNothing({
      // Written as raw SQL so it matches `sync_jobs_pending_idx` verbatim.
      // Postgres infers the index from this predicate, and a parameterised
      // version of the same condition is not the same predicate to it.
      target: [syncJobs.connectionId, syncJobs.kind],
      where: sql`state = 'pending'`,
    });
}

/**
 * Runs whatever is waiting, and is safe to call from two places at once.
 *
 * The claim is an update filtered on `state = 'pending'`, so of two runners
 * reaching the same row only one changes it — the webhook's own follow-up and
 * the cron cannot both sync the same connection.
 */
export async function runPendingJobs(limit = 10): Promise<JobOutcome> {
  const now = new Date();

  const due = await db
    .select({ id: syncJobs.id })
    .from(syncJobs)
    .where(and(eq(syncJobs.state, "pending"), lte(syncJobs.runAfter, now)))
    .orderBy(asc(syncJobs.runAfter))
    .limit(limit);

  if (due.length === 0) return { ran: 0, failed: 0 };

  const claimed = await db
    .update(syncJobs)
    .set({ state: "running" })
    .where(
      and(
        inArray(
          syncJobs.id,
          due.map((job) => job.id),
        ),
        eq(syncJobs.state, "pending"),
      ),
    )
    .returning({
      id: syncJobs.id,
      connectionId: syncJobs.connectionId,
      attempts: syncJobs.attempts,
    });

  const outcome: JobOutcome = { ran: 0, failed: 0 };

  for (const job of claimed) {
    try {
      await syncConnection(job.connectionId);
      // The row existed to survive a crash, not to be read later. Keeping every
      // successful sync would grow a table nobody queries by a row every few
      // minutes; failures below are kept precisely because they are worth
      // looking at.
      await db.delete(syncJobs).where(eq(syncJobs.id, job.id));
      outcome.ran++;
    } catch (cause) {
      // A revoked grant is already recorded on the account and will not fix
      // itself with time, so retrying it just fills the log.
      const terminal = cause instanceof GoogleRevokedError || job.attempts + 1 >= MAX_ATTEMPTS;
      await settle(job, cause, terminal);
      outcome.failed++;
    }
  }

  return outcome;
}

async function settle(
  job: { id: string; connectionId: string; attempts: number },
  cause: unknown,
  terminal: boolean,
): Promise<void> {
  const attempts = job.attempts + 1;
  const lastError = cause instanceof Error ? cause.message.slice(0, 500) : String(cause);
  console.error(`Sync job ${job.id} failed (attempt ${attempts})`, cause);

  if (terminal) {
    await db
      .update(syncJobs)
      .set({ state: "failed", attempts, lastError })
      .where(eq(syncJobs.id, job.id));
    return;
  }

  // Requeued as a new row rather than moved back to pending, because a ping
  // that arrived while this was running has already created one — and the
  // index would reject a second. If it did, this insert quietly does nothing,
  // which is the right answer: the retry is already covered.
  await db.transaction(async (tx) => {
    await tx.delete(syncJobs).where(eq(syncJobs.id, job.id));
    await tx
      .insert(syncJobs)
      .values({
        connectionId: job.connectionId,
        kind: KIND,
        attempts,
        lastError,
        runAfter: new Date(Date.now() + backoffMs(attempts)),
      })
      .onConflictDoNothing({
        target: [syncJobs.connectionId, syncJobs.kind],
        where: sql`state = 'pending'`,
      });
  });
}

/** 1, 2, 4, 8 minutes. The cron sweeps every five regardless, so this only
 * has to stop a hard-down Google from being hammered. */
function backoffMs(attempts: number): number {
  return 2 ** (attempts - 1) * 60_000;
}
