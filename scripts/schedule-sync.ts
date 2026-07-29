/**
 * Schedules the two sync entrypoints from Postgres instead of from Vercel.
 *
 * Vercel's Hobby plan caps cron at one run per day and fires it anywhere inside
 * the chosen hour. That is fatal here rather than merely slow: watch channels
 * are renewed when they fall within `RENEW_BEFORE_MS` (24h) of expiry, so a
 * daily job that drifts by an hour can step straight over the window and let a
 * channel die silently. pg_cron has no such cap, runs on the free tier, and
 * lives in infrastructure this project already depends on.
 *
 *   npm run db:cron
 *
 * Idempotent — re-run it after rotating CRON_SECRET or changing the domain.
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
const secret = process.env.CRON_SECRET;
const appUrl = process.env.NEXT_PUBLIC_APP_URL;

if (!url || !secret || !appUrl) {
  console.error("DATABASE_URL, CRON_SECRET and NEXT_PUBLIC_APP_URL must all be set.");
  process.exit(1);
}

// Postgres is reaching out over the public internet, so it can only ever hit a
// deployed origin. Scheduling against localhost would silently queue failures.
if (/localhost|127\.0\.0\.1/.test(appUrl)) {
  console.error(`NEXT_PUBLIC_APP_URL is ${appUrl}. Point it at the deployed domain first.`);
  process.exit(1);
}

/**
 * Generous on purpose. pg_net defaults to a 2s timeout, which a full resync
 * blows through — and a timeout here aborts the request rather than letting it
 * finish, so the run would be cut off partway.
 */
const TIMEOUT_MS = 60_000;

const jobs = [
  { name: "timeblock-sync", schedule: "*/5 * * * *", path: "/api/sync/run" },
  { name: "timeblock-renew-channels", schedule: "0 * * * *", path: "/api/sync/renew-channels" },
];

const sql = postgres(url, { prepare: false, max: 1 });

async function main() {
  try {
    await sql.unsafe("create extension if not exists pg_cron");
    await sql.unsafe("create extension if not exists pg_net");

    for (const job of jobs) {
      // `cron.unschedule(name)` throws when the job is absent, so the job table
      // is consulted first and this stays safe to re-run.
      await sql`select cron.unschedule(jobid) from cron.job where jobname = ${job.name}`;

      // Built server-side through `format('%L', ...)`: the secret and the URL
      // are parameters right up to the point Postgres quotes them into the
      // command text, so neither can break out of the literal.
      //
      // The casts are not decoration. `format` takes `VARIADIC "any"`, which
      // gives the planner nothing to infer a bare parameter's type from, and it
      // gives up with `could not determine data type of parameter`.
      await sql`
        select cron.schedule(
          ${job.name},
          ${job.schedule},
          format(
            'select net.http_get(url := %L, headers := %L::jsonb, timeout_milliseconds := %s)',
            ${appUrl + job.path}::text,
            ${JSON.stringify({ Authorization: `Bearer ${secret}` })}::text,
            ${TIMEOUT_MS}::int
          )
        )
      `;
    }

    const scheduled = await sql`
      select jobname, schedule, active from cron.job where jobname like 'timeblock-%' order by jobname
    `;
    console.table(scheduled);
    console.log(`Scheduled against ${appUrl}`);
  } catch (error) {
    console.error("Failed to schedule:", error);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

void main();
