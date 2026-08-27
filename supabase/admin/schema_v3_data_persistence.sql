-- ────────────────────────────────────────────────────────────
-- Drift schema v3 — Full data persistence + soft-delete policy
--
-- Run in Supabase SQL Editor. Fully idempotent — safe to run repeatedly.
--
-- Principles enforced by this schema:
--  1. No hard deletes anywhere — every row gets a `deleted_at` column.
--     Even when "removed," rows stay for audit/recovery.
--  2. Server is source of truth for all user state (tasks, credits, XP,
--     blocked apps). Client AsyncStorage is a cache only.
--  3. Append-only `credit_ledger` records every credit change so we can
--     replay the balance and audit anomalies.
--  4. RLS enforced on every table; users only see/edit their own rows.
-- ────────────────────────────────────────────────────────────


-- ── 1. TASKS ──────────────────────────────────────────────────
-- One row per task ever created. `deleted_at` flags removed tasks.
-- `completed_at` flags finished tasks. Both can coexist (deleted-after-done).
create table if not exists public.tasks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users on delete cascade not null,
  title         text not null,
  category      text not null default 'life',
  minutes       int  not null default 0,
  credits       int  not null default 0,
  xp            int  not null default 0,
  done          boolean not null default false,
  ai_check      boolean not null default false,
  ai_valued     boolean not null default false,
  ai_reasoning  text,
  task_date     date not null default current_date,  -- which day this counts for
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz                          -- soft delete
);

alter table public.tasks enable row level security;

-- Recreate policies idempotently so we can tighten them with deleted_at filter
do $$ begin
  drop policy if exists "tasks: own select" on public.tasks;
  drop policy if exists "tasks: own insert" on public.tasks;
  drop policy if exists "tasks: own update" on public.tasks;
end $$;

-- Soft-deleted rows are hidden from SELECT (use admin role to inspect)
create policy "tasks: own select" on public.tasks
  for select using (auth.uid() = user_id and deleted_at is null);

create policy "tasks: own insert" on public.tasks
  for insert with check (auth.uid() = user_id);

-- UPDATEs allowed on own rows (this includes soft-deleting by setting deleted_at)
create policy "tasks: own update" on public.tasks
  for update using (auth.uid() = user_id);

-- NOTE: no DELETE policy. Hard deletes are blocked at the RLS layer.

create index if not exists tasks_user_active
  on public.tasks (user_id, task_date desc)
  where deleted_at is null;

create index if not exists tasks_user_done
  on public.tasks (user_id, completed_at desc)
  where done = true and deleted_at is null;


-- ── 2. CREDIT LEDGER ──────────────────────────────────────────
-- Immutable append-only log of every credit change. The current balance
-- is `sum(delta)` for active rows. We never UPDATE or DELETE rows here.
create table if not exists public.credit_ledger (
  id          bigserial primary key,
  user_id     uuid references auth.users on delete cascade not null,
  delta       int  not null,                              -- positive=earned, negative=spent
  reason      text not null,                              -- 'task_complete', 'drift_in', 'spend', 'admin'
  ref_id      uuid,                                       -- e.g. task id, session id
  balance_after int,                                      -- snapshot for fast reads
  created_at  timestamptz not null default now()
);

alter table public.credit_ledger enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='credit_ledger' and policyname='ledger: own select')
  then create policy "ledger: own select" on public.credit_ledger for select using (auth.uid() = user_id); end if;

  if not exists (select 1 from pg_policies where tablename='credit_ledger' and policyname='ledger: own insert')
  then create policy "ledger: own insert" on public.credit_ledger for insert with check (auth.uid() = user_id); end if;

  -- NO update, NO delete policies — the ledger is append-only by design.
end $$;

create index if not exists ledger_user_time on public.credit_ledger (user_id, created_at desc);


-- ── 3. BLOCKED APPS ───────────────────────────────────────────
-- Per-user blocked app list. Soft-delete via `removed_at`.
create table if not exists public.blocked_apps (
  id          bigserial primary key,
  user_id     uuid references auth.users on delete cascade not null,
  app_id      text not null,                             -- our internal id (e.g. 'instagram')
  app_name    text not null,
  added_at    timestamptz not null default now(),
  removed_at  timestamptz                                -- soft delete
);

alter table public.blocked_apps enable row level security;

do $$ begin
  drop policy if exists "blocked: own select" on public.blocked_apps;
  drop policy if exists "blocked: own insert" on public.blocked_apps;
  drop policy if exists "blocked: own update" on public.blocked_apps;
end $$;

create policy "blocked: own select" on public.blocked_apps
  for select using (auth.uid() = user_id and removed_at is null);

create policy "blocked: own insert" on public.blocked_apps
  for insert with check (auth.uid() = user_id);

create policy "blocked: own update" on public.blocked_apps
  for update using (auth.uid() = user_id);

-- No DELETE — soft-delete only.

create unique index if not exists blocked_apps_user_app_active
  on public.blocked_apps (user_id, app_id) where removed_at is null;

create index if not exists blocked_apps_user_all on public.blocked_apps (user_id, added_at desc);


-- ── 4. PROFILES — add soft-delete + XP totals ────────────────
alter table public.profiles
  add column if not exists total_xp        int not null default 0,
  add column if not exists balance_seconds int not null default 0,  -- live screen-time
  add column if not exists deleted_at      timestamptz;

create index if not exists profiles_active on public.profiles (id) where deleted_at is null;

-- Restrict which columns are readable by other users (anti-snooping).
-- Sensitive columns (sub_active, sub_expires, stripe_customer_id, balance_seconds,
-- total_xp where appropriate) should NOT be readable by other authenticated users.
-- The `public_profile` view exposes only safe columns; client lookups
-- (friend-add, friend list, etc.) should query this view, not the table directly.
create or replace view public.public_profile as
  select id, username, avatar_seed, full_name
  from public.profiles
  where deleted_at is null;

-- Allow public read on the view (still RLS-bounded by the base table)
grant select on public.public_profile to anon, authenticated;


-- ── 5. FRIENDSHIPS — add soft-delete + history-preserving status ──
alter table public.friendships
  add column if not exists removed_at timestamptz,
  add column if not exists status_changed_at timestamptz default now();

-- Allow 'removed' as a status (extends the existing CHECK if any)
-- Drop the existing CHECK constraint by name pattern, then re-add with new options.
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.friendships'::regclass and contype = 'c'
  loop
    execute format('alter table public.friendships drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.friendships
  add constraint friendships_status_check
  check (status in ('pending','accepted','declined','removed'));


-- ── 6. CHALLENGES — add soft-delete columns ──────────────────
alter table public.challenges
  add column if not exists cancelled_at timestamptz,
  add column if not exists deleted_at   timestamptz;

-- Allow 'cancelled' status alongside existing values.
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.challenges'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.challenges drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.challenges
  add constraint challenges_status_check
  check (status in ('pending','active','completed','declined','cancelled'));


-- ── 7. SCREEN TIME (already exists — make sure soft-delete is there) ──
alter table public.screen_time
  add column if not exists deleted_at timestamptz;


-- ── 8. BLOCK ALL HARD DELETES on user-data tables ────────────
-- Even if a future bug or migration tries .delete(), this trigger turns it
-- into a soft delete (or rejects it outright on the ledger).
create or replace function public.prevent_hard_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'Hard deletes are not allowed on % — use a soft-delete column (deleted_at / removed_at / cancelled_at).', tg_table_name;
end; $$;

do $$
declare
  t text;
  guarded text[] := array['tasks', 'credit_ledger', 'blocked_apps', 'challenges', 'friendships', 'screen_time', 'ai_check_usage', 'trial_ip_log'];
begin
  foreach t in array guarded loop
    execute format('drop trigger if exists no_hard_delete on public.%I', t);
    execute format('create trigger no_hard_delete before delete on public.%I for each row execute function public.prevent_hard_delete()', t);
  end loop;
end $$;


-- ── 9. Updated-at maintenance trigger (small helper) ──────────
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();


-- ── 10. Verify ────────────────────────────────────────────────
select 'schema_v3_data_persistence applied' as status;
