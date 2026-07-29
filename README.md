# Timeblock

A calendar where every block of time is a page you work inside.

The calendar is the primary interface — a vertical hourly grid you time-block your
day on. But every event opens into a full block editor: nested to-do lists,
headings, rich text, checklists, standalone collapsible toggles, arbitrary
nesting. The plan and the execution live in the same place.

## Why this exists

The market splits in two and the halves never meet. Tools with a real hourly
time-grid (Notion Calendar, Sunsama, Akiflow, Motion, Morgen) give events a
plain or lightly-rich notes field. Tools with a real block editor (Notion, Tana,
Craft) have no hourly grid — Notion's own calendar view is still month/week
boxes. Routine.co is the closest thing to this concept, but its collapsing is
bound to headings: no standalone toggles, no arbitrary nesting.

## Stack

| Concern   | Choice                                                                 |
| --------- | ---------------------------------------------------------------------- |
| Framework | Next.js 16, App Router, React 19, TypeScript strict                    |
| Editor    | BlockNote (pinned exact — 0.x semver)                                  |
| Database  | Supabase Postgres + Drizzle ORM                                        |
| Auth      | Supabase Auth (app identity) + own Google OAuth flow (calendar access) |
| Sync      | Google Calendar API, two-way                                           |
| Styling   | Tailwind v4                                                            |
| State     | React + URL params · TanStack Query for search and event bodies        |

## Getting started

```bash
cp .env.example .env.local   # fill in Supabase + Google credentials
npm install
npm run db:generate                                # emit a migration
npx tsx scripts/apply-sql.ts drizzle/000N_name.sql # apply it
npm run db:rls                                     # apply RLS policies
npm run dev
```

**Never `db:push`.** RLS lives in `drizzle/rls.sql`, which drizzle-kit cannot see, so
push reads it as drift and offers to disable row-level security and drop every policy.

### Required setup

1. **Supabase project** — copy the URL, anon key, service role key, and the
   session-pooler `DATABASE_URL`.
2. **Google Cloud project** — enable the Calendar API, create an OAuth client
   with redirect URI `${NEXT_PUBLIC_APP_URL}/api/google/oauth/callback`. Domain
   verification is required before push notifications will work.
3. **Secrets** — `openssl rand -base64 32` for `TOKEN_ENCRYPTION_KEY`,
   `openssl rand -hex 32` for `CRON_SECRET`.
4. **Schedules** — after the first deploy, point `NEXT_PUBLIC_APP_URL` at the real
   domain and run `npm run db:cron`. See below.

### Scheduling

The two scheduled entrypoints are driven by **pg_cron inside Supabase**, not by the
host's cron. Vercel's Hobby plan allows one run per day and fires it anywhere inside
the chosen hour, which is fatal rather than merely slow: watch channels are renewed
when they come within 24h of expiry, so a daily job that drifts by an hour steps over
the window and lets a channel die silently.

```bash
npm run db:cron   # installs pg_cron + pg_net and (re)schedules both jobs
```

| Job                        | Schedule      | Target                     |
| -------------------------- | ------------- | -------------------------- |
| `timeblock-sync`           | `*/5 * * * *` | `/api/sync/run`            |
| `timeblock-renew-channels` | `0 * * * *`   | `/api/sync/renew-channels` |

Each fires `net.http_get` with `Authorization: Bearer $CRON_SECRET`. The script is
idempotent — re-run it after rotating the secret or changing the domain. It refuses
to run against localhost. Responses land in `net._http_response` for six hours,
which is where to look when a run seems to have gone missing.

## Scripts

| Command                           | Does                                     |
| --------------------------------- | ---------------------------------------- |
| `npm run dev`                     | Dev server                               |
| `npm run typecheck`               | `tsc --noEmit`                           |
| `npm run lint` / `npm run format` | ESLint / Prettier                        |
| `npm run test`                    | Vitest                                   |
| `npm run db:generate`             | Emit a migration from `src/db/schema.ts` |
| `npm run db:rls`                  | Apply `drizzle/rls.sql`                  |
| `npm run db:cron`                 | Schedule the sync jobs via pg_cron       |
| `npm run db:studio`               | Drizzle Studio                           |

## Architecture notes

- **The block body is ours.** Google's `description` field is limited HTML and
  would destroy nesting. Google receives a truncated stub plus a deep link;
  the real document never leaves Postgres and is **never parsed back**.
- **Two OAuth concerns, deliberately separate.** Supabase Auth handles app
  identity. Calendar access uses our own OAuth flow, because Supabase returns
  `provider_refresh_token` only once at sign-in and never persists it.
- **A 410 from Google does not mean wipe local rows.** Full resync reconciles
  through `event_links`, so block bodies survive.
- **Watch channels expire (~7 days).** Renewed hourly by pg_cron; read the
  expiration Google returns rather than hardcoding it.
- **Recurrence is Google's job.** `singleEvents: true` means every occurrence
  arrives as its own event carrying a `recurringEventId`; the series master is
  never sent, so there is no RRULE to expand and no column to store one in.
  Instances render with a repeat glyph and are held back from outbound writes.

## Status

All ten phases complete: the grid (day/3-day/week/month), the block editor with
autosave, full-text search, Google read and incremental sync, outbound writes, push
notifications, conflict resolution, and recurring-instance display.

Push notifications only work on a deployed HTTPS domain verified in Search Console —
locally, every connection falls back to the five-minute poll.
