-- Row Level Security.
--
-- Not optional: every table lives in `public`, so Supabase's REST API exposes
-- it to anyone holding the publishable key — and that key ships in the browser
-- bundle. Without these policies the anon role can read and write every user's
-- events directly, bypassing the app entirely.
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

alter table public.google_accounts enable row level security;
drop policy if exists google_accounts_owner on public.google_accounts;
create policy google_accounts_owner on public.google_accounts
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.calendar_connections enable row level security;
drop policy if exists calendar_connections_owner on public.calendar_connections;
create policy calendar_connections_owner on public.calendar_connections
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

alter table public.sync_conflicts enable row level security;
drop policy if exists sync_conflicts_owner on public.sync_conflicts;
create policy sync_conflicts_owner on public.sync_conflicts
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Machinery tables: no user_id of their own, and no client ever needs them.
-- RLS on with zero policies = deny all, except the service role, which bypasses
-- RLS by design. That is exactly the intent.
-- ---------------------------------------------------------------------------

alter table public.event_links enable row level security;
alter table public.sync_jobs enable row level security;

-- ---------------------------------------------------------------------------
-- Belt and braces: refresh tokens must never be reachable over the REST API,
-- whatever happens to the policies above.
-- ---------------------------------------------------------------------------

revoke all on public.google_accounts from anon, authenticated;
revoke all on public.event_links from anon, authenticated;
revoke all on public.sync_jobs from anon, authenticated;
