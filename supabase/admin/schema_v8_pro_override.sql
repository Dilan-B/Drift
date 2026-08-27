-- ────────────────────────────────────────────────────────────
-- Drift schema v8 — Backend Pro override
--
-- A manually-granted Pro flag that works alongside RevenueCat. The app treats
-- a user as Pro if EITHER their RevenueCat "Pro" entitlement is active OR they
-- have a granted row here (see useSubscription.js -> proAccess = rcPro || override).
--
-- Why a dedicated table (not a column on profiles): profiles' RLS lets users
-- UPDATE their own row, so a pro_override column there would let anyone grant
-- themselves Pro. This table is READ-ONLY to the user (they can see only their
-- own row) and WRITABLE only by the service role (you, from the SQL editor).
--
-- Idempotent. Run in the Supabase SQL Editor.
-- ────────────────────────────────────────────────────────────

-- 1. Override table
create table if not exists public.pro_overrides (
  user_id    uuid primary key references auth.users on delete cascade,
  granted    boolean not null default true,
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pro_overrides enable row level security;

-- Table-level privilege. A table created in the SQL editor does NOT
-- automatically grant SELECT to the authenticated role, so without this the
-- client read fails (permission denied) and the override silently reads as
-- false — i.e. "I granted Pro but still don't have it". RLS below still scopes
-- which ROWS are visible; this just allows the role to query the table at all.
grant select on public.pro_overrides to authenticated;

-- 2. Policies: a user may READ their own row; nobody (except service role,
--    which bypasses RLS) may insert/update/delete. No write policies = no
--    client writes, so users can't grant themselves Pro.
drop policy if exists "read own pro override" on public.pro_overrides;
create policy "read own pro override"
  on public.pro_overrides for select
  using (auth.uid() = user_id);

-- 3. Server-side helper (for edge functions that gate Pro features server-side).
create or replace function public.has_pro_override(uid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.pro_overrides
    where user_id = uid and granted = true
  );
$$;

-- 4. Verify
do $$
begin
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='pro_overrides')
    then raise exception 'pro_overrides table missing'; end if;
end $$;

select 'schema_v8_pro_override applied — ' || count(*)::text || ' overrides' as status
from public.pro_overrides;

-- ────────────────────────────────────────────────────────────
-- GRANT / REVOKE PRO  (run these one-off as needed)
-- ────────────────────────────────────────────────────────────

-- Grant Pro by USER ID:
--   insert into public.pro_overrides (user_id, note) values
--     ('00000000-0000-0000-0000-000000000000', 'comp / tester')
--   on conflict (user_id) do update set granted = true, note = excluded.note, updated_at = now();

-- Grant Pro by EMAIL (looks up the auth.users id for you):
--   insert into public.pro_overrides (user_id, note)
--   select id, 'comp / tester' from auth.users where lower(email) = lower('person@example.com')
--   on conflict (user_id) do update set granted = true, updated_at = now();

-- Revoke (soft — keeps the row, flips the flag):
--   update public.pro_overrides set granted = false, updated_at = now()
--   where user_id = (select id from auth.users where lower(email) = lower('person@example.com'));

-- Revoke (hard — removes the row):
--   delete from public.pro_overrides
--   where user_id = (select id from auth.users where lower(email) = lower('person@example.com'));
