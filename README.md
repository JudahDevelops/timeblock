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

| Concern   | Choice                                                          |
| --------- | --------------------------------------------------------------- |
| Framework | Next.js 16, App Router, React 19, TypeScript strict             |
| Editor    | BlockNote (pinned exact — 0.x semver)                           |
| Database  | Supabase Postgres + Drizzle ORM                                 |
| Auth      | Supabase Auth, email and password                               |
| Styling   | Tailwind v4                                                     |
| State     | React + URL params · TanStack Query for search and event bodies |

## Getting started

```bash
cp .env.example .env.local   # fill in Supabase credentials
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
2. **Supabase Auth** — under Authentication → Sign In / Providers, make sure
   **Email** is enabled. Set Authentication → URL Configuration → Site URL to the
   deployed address and add `${NEXT_PUBLIC_APP_URL}/auth/callback` (and
   `http://localhost:3000/auth/callback`) to the redirect allow-list.
3. **Email confirmation** — Supabase's built-in mailer only delivers to members of
   your Supabase organisation and is heavily rate-limited. For outside testers,
   either turn **Confirm email** off (sign-up then signs you straight in) or
   configure custom SMTP under Authentication → Emails.

## Scripts

| Command                           | Does                                     |
| --------------------------------- | ---------------------------------------- |
| `npm run dev`                     | Dev server                               |
| `npm run typecheck`               | `tsc --noEmit`                           |
| `npm run lint` / `npm run format` | ESLint / Prettier                        |
| `npm run test`                    | Vitest                                   |
| `npm run db:generate`             | Emit a migration from `src/db/schema.ts` |
| `npm run db:rls`                  | Apply `drizzle/rls.sql`                  |
| `npm run db:studio`               | Drizzle Studio                           |

## Architecture notes

- **The block body is ours.** A BlockNote document stored as jsonb in Postgres,
  with a derived plaintext column feeding full-text search.
- **Every read and write scopes on the session user.** RLS is the backstop, and
  REST grants are revoked outright (`drizzle/rls.sql`).

## Status

The grid (day/3-day/week/month), the block editor with autosave, full-text
search, standalone pages and dashboards, with email-and-password accounts.

Google Calendar sync was removed so the app can be opened up to testers without a
Google Cloud verification. Migration `0011_remove_google_sync` drops its tables and
unschedules its pg_cron jobs; previously imported events are kept as ordinary blocks.
