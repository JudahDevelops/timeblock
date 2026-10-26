-- Row Level Security.
--
-- Not optional: every table lives in `public`, so Supabase's REST API exposes
-- it to anyone holding the publishable key — and that key ships in the browser
-- bundle. Without these policies the anon role can read and write every user's
-- events directly, bypassing the app entirely. The `revoke` block at the end of
-- this file goes further and removes the REST privileges outright, on every
-- table, so there is nothing left for a policy to filter in the first place.
--
-- Drizzle does not model RLS, so this is applied separately via
-- `npm run db:rls`. It is idempotent; re-run it after any schema push.

-- ---------------------------------------------------------------------------
-- User-owned tables: a row is visible only to the user whose id it carries.
-- ---------------------------------------------------------------------------

alter table public.events enable row level security;
drop policy if exists events_owner on public.events;
create policy events_owner on public.events
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.pages enable row level security;
drop policy if exists pages_owner on public.pages;
create policy pages_owner on public.pages
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.dashboards enable row level security;
drop policy if exists dashboards_owner on public.dashboards;
create policy dashboards_owner on public.dashboards
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- `dashboard_fields` carries a denormalised `user_id` precisely so this policy can
-- be a column comparison rather than a subquery back to the parent dashboard.
alter table public.dashboard_fields enable row level security;
drop policy if exists dashboard_fields_owner on public.dashboard_fields;
create policy dashboard_fields_owner on public.dashboard_fields
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- No table is reachable over the REST API at all.
--
-- Nothing in the app reads or writes through Supabase's REST layer: every query
-- runs server-side via Drizzle on DATABASE_URL, after `requireUserId()`. The
-- grants Supabase hands `anon` and `authenticated` by default would let a
-- signed-in user skip every server-side check. The policies
-- above stay as the row filter should a grant ever be reinstated on purpose.
-- ---------------------------------------------------------------------------

revoke all on public.events from anon, authenticated;
revoke all on public.pages from anon, authenticated;
revoke all on public.dashboards from anon, authenticated;
revoke all on public.dashboard_fields from anon, authenticated;
