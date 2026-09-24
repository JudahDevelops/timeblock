# Plan 005: The browser's Supabase key cannot write any table directly

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2f44196..HEAD -- drizzle/rls.sql src/db/schema.ts`
> If a new table was added to `schema.ts` since this plan was written, include
> it in Step 2 too.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW — the app never talks to tables through Supabase's REST API; it uses Drizzle over `DATABASE_URL`
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `2f44196`, 2026-09-24

## Why this matters

Every table lives in `public`, so Supabase's REST API exposes it to anyone
holding the publishable key, and that key ships in the browser bundle.
`drizzle/rls.sql` enables RLS on all nine tables. For six of them it grants the
owner `for all`: select, insert, update and delete of their own rows. The app
never uses those grants. All reads and writes go through server actions and
route handlers, via Drizzle on the direct Postgres connection. So a signed-in user
can bypass every server-side check by calling REST directly: title length
limits, `assertValidRange`, `origin`, `body_rev`, dashboard field kinds. The
worst case is `calendar_connections`. An owner can rewrite `google_account_id`
to point at a **different user's** Google account row (the foreign key accepts
any id). The service-role sync would then read that calendar into the
attacker's events using the victim's refresh token. That needs the victim's
account UUID, which isn't exposed anywhere found, but the grant has no reason to
exist. Revoking it removes the whole class.

## Current state

- `drizzle/rls.sql` — applied with `npm run db:rls` (which runs
  `npx tsx scripts/apply-sql.ts drizzle/rls.sql`). It is idempotent and
  documented as "re-run it after any schema push".
- The owner policies (`for all to authenticated using (auth.uid() = user_id) with check (...)`)
  exist on: `events`, `google_accounts`, `calendar_connections`, `pages`,
  `dashboards`, `dashboard_fields`, `sync_conflicts`.
- The file ends with (lines 87-89):

  ```sql
  revoke all on public.google_accounts from anon, authenticated;
  revoke all on public.event_links from anon, authenticated;
  revoke all on public.sync_jobs from anon, authenticated;
  ```

  So privileges are already revoked on 3 of the 9 tables. The other 6
  (`events`, `calendar_connections`, `pages`, `dashboards`, `dashboard_fields`,
  `sync_conflicts`) keep Supabase's default grants to `anon` and `authenticated`.

- Evidence that no client code uses table REST: `grep -rn "\.from(\"" src` returns
  nothing, and the Supabase clients in `src/lib/supabase/{client,server,middleware}.ts`
  are used only for auth (`getClaims`, sign-in, sign-out).
- The app's own DB access uses `DATABASE_URL` through `src/db/index.ts`
  (postgres-js). That role is not `anon`/`authenticated`, so revoking from those
  roles doesn't affect it.
- `CLAUDE.md` says: "Every read and write scopes on `requireUserId()` explicitly.
  RLS is the backstop, not the primary control." This plan makes the backstop airtight.
- **Never run `npm run db:push`** (it would offer to drop every policy). This
  plan uses only `npm run db:rls`.

## Commands you will need

| Purpose   | Command                                                                                | Expected on success              |
| --------- | -------------------------------------------------------------------------------------- | -------------------------------- |
| Apply RLS | `npm run db:rls`                                                                       | prints `Applied drizzle/rls.sql` |
| Full gate | `npm run format && npm run typecheck && npm run lint && npm run test && npm run build` | all exit 0                       |

## Scope

**In scope**:

- `drizzle/rls.sql`

**Out of scope**:

- Dropping or changing the existing owner policies. Keep them: they are the
  row filter if a grant is ever re-added on purpose.
- `src/**`. No application code changes.
- Any migration under `drizzle/000N_*.sql`.

## Git workflow

- Branch: `advisor/005-revoke-client-table-grants`
- Commit style: plain imperative sentence, e.g. "Take table writes away from the browser's key".
- Do NOT push or open a PR unless the operator instructed it.
- **Applying to the production database is the operator's call.** Commit the
  file change. Run `npm run db:rls` only if the operator told you which database
  `.env.local` points at and that applying there is approved.

## Steps

### Step 1: Confirm nothing in the app uses table REST

**Verify** (all must return no matches):

- `grep -rn "\.from(\"" src`
- `grep -rn "supabase\.\(from\|rpc\)" src`
- `grep -rn "\.rpc(" src`

If any match, STOP.

### Step 2: Revoke the remaining grants

Replace the closing section of `drizzle/rls.sql` (the "Belt and braces"
comment plus its three `revoke` lines) with one section covering every table:

```sql
-- ---------------------------------------------------------------------------
-- No table is reachable over the REST API at all.
--
-- Nothing in the app reads or writes through Supabase's REST layer: every query
-- runs server-side via Drizzle on DATABASE_URL, after `requireUserId()`. The
-- grants Supabase hands `anon` and `authenticated` by default would let a
-- signed-in user skip every server-side check — including pointing their own
-- calendar connection at somebody else's Google account row. The policies
-- above stay as the row filter should a grant ever be reinstated on purpose.
-- ---------------------------------------------------------------------------

revoke all on public.events from anon, authenticated;
revoke all on public.google_accounts from anon, authenticated;
revoke all on public.calendar_connections from anon, authenticated;
revoke all on public.pages from anon, authenticated;
revoke all on public.dashboards from anon, authenticated;
revoke all on public.dashboard_fields from anon, authenticated;
revoke all on public.sync_conflicts from anon, authenticated;
revoke all on public.event_links from anon, authenticated;
revoke all on public.sync_jobs from anon, authenticated;
```

Also update the header comment at the top of the file. It currently says
"Without these policies the anon role can read and write every user's events".
Add one sentence noting that the privileges are revoked at the end of the file
as well.

**Verify**:

- `grep -c "^revoke all on public\." drizzle/rls.sql` → `9`
- `grep -c "enable row level security" drizzle/rls.sql` → `9` (unchanged)
- Every `pgTable("` name in `src/db/schema.ts` appears in a `revoke` line:
  `grep -A1 "pgTable(" src/db/schema.ts | grep -o '"[a-z_]*"' | tr -d '"' | sort -u | while read t; do grep -q "revoke all on public.$t from" drizzle/rls.sql || echo "MISSING $t"; done` → prints nothing

### Step 3: Full gate

**Verify**: `npm run format && npm run typecheck && npm run lint && npm run test && npm run build` → all exit 0.
(`prettier` does not format `.sql`, so it should leave the file untouched.)

### Step 4 (operator-approved only): Apply and check

Only with explicit operator approval (see Git workflow):

1. `npm run db:rls` → `Applied drizzle/rls.sql`
2. Sign in to the app and do a smoke pass: create a block on the calendar, type
   in its body, create a page, add a dashboard field. All must still work.
   Failures here would mean the app was unexpectedly using the REST layer. STOP
   and report.

## Test plan

No unit tests: this is SQL grants. Verification is the grep checks, the full
gate, and (when approved) the smoke pass after applying.

## Done criteria

- [ ] `grep -c "^revoke all on public\." drizzle/rls.sql` → 9
- [ ] The table-coverage loop in Step 2 prints nothing
- [ ] Full gate exits 0
- [ ] `git status` shows only `drizzle/rls.sql` (and `plans/README.md`) modified
- [ ] Report says whether `npm run db:rls` was applied, and to which environment
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1 finds any REST/RPC usage.
- A table in `schema.ts` has no RLS `enable` line either. Report it; that's a
  bigger gap than this plan.
- After applying, any part of the smoke pass fails.

## Maintenance notes

- **Any new table** must get both an `enable row level security` line and a
  `revoke all ... from anon, authenticated` line here. Consider adding that
  rule to the Conventions section of `CLAUDE.md`.
- If a client-side Supabase read (e.g. Realtime) is ever adopted, grant exactly
  `select` on that one table, deliberately, and rely on its owner policy.
- The same file is re-applied after schema changes, so the revoke must stay at
  the end, after policies are created.
