-- ────────────────────────────────────────────────────────────
-- Drift schema v5 — Beta tester access
-- Self-contained. Safe to run multiple times. Does not depend on
-- grant_premium.sql or any earlier schema file having been run first.
-- ────────────────────────────────────────────────────────────


-- ── 0. Pre-reqs the rest of this file needs ──────────────────
-- These might already exist if you ran grant_premium.sql / schema_v2.sql;
-- the "if not exists" / "or replace" make this safe.

create table if not exists public.dev_emails (
  email      text primary key,
  note       text,
  created_at timestamptz default now()
);
alter table public.dev_emails enable row level security;
-- No policies — service-role only. Clients can never read this.

create or replace function public.is_dev_user(uid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from auth.users u
    join public.dev_emails d on lower(u.email) = lower(d.email)
    where u.id = uid
  );
$$;


-- ── 1. Beta unlock column + index ────────────────────────────
alter table public.profiles
  add column if not exists beta_unlocked_at timestamptz;

create index if not exists profiles_beta_active
  on public.profiles (id) where beta_unlocked_at is not null;


-- ── 2. is_beta_user helper ───────────────────────────────────
create or replace function public.is_beta_user(uid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = uid and beta_unlocked_at is not null
  );
$$;


-- ── 3. Rate-limit log for beta redemption attempts ───────────
create table if not exists public.beta_redeem_attempts (
  id          bigserial primary key,
  user_id     uuid references auth.users on delete cascade not null,
  success     boolean not null,
  ip_hash     text,
  created_at  timestamptz not null default now()
);

alter table public.beta_redeem_attempts enable row level security;
-- No policies — service-role only.

create index if not exists beta_attempts_user_time
  on public.beta_redeem_attempts (user_id, created_at desc);


-- ── 4. can_user_ai RPC — privacy-safe peer check ─────────────
-- Friends shouldn't see each other's raw sub_active / sub_expires fields.
-- This RPC returns just a single boolean: "can THIS uid use AI features?"
-- All three access paths (paid sub, beta, dev) are checked.

create or replace function public.can_user_ai(uid uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  sub_ok  boolean := false;
  beta_ok boolean := false;
begin
  select
    coalesce(p.sub_active and (p.sub_expires is null or p.sub_expires > now()), false),
    coalesce(p.beta_unlocked_at is not null, false)
  into sub_ok, beta_ok
  from public.profiles p
  where p.id = uid;

  return coalesce(sub_ok, false)
      or coalesce(beta_ok, false)
      or public.is_dev_user(uid);
end;
$$;

grant execute on function public.can_user_ai(uuid) to anon, authenticated;


-- ── 5. Verify everything got created ─────────────────────────
do $$
declare
  missing text := '';
begin
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='beta_redeem_attempts')
    then missing := missing || 'beta_redeem_attempts table, '; end if;
  if not exists (select 1 from pg_proc where proname='is_beta_user')
    then missing := missing || 'is_beta_user(), '; end if;
  if not exists (select 1 from pg_proc where proname='can_user_ai')
    then missing := missing || 'can_user_ai(), '; end if;
  if not exists (select 1 from pg_proc where proname='is_dev_user')
    then missing := missing || 'is_dev_user(), '; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='beta_unlocked_at')
    then missing := missing || 'profiles.beta_unlocked_at column, '; end if;

  if length(missing) > 0 then
    raise exception 'Missing after schema_v5 ran: %', missing;
  end if;
end $$;

select 'schema_v5_beta_access applied successfully' as status;
