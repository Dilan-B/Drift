-- ============================================================================
-- schema_v7_screen_time_spent.sql
--
-- Paste into the Supabase SQL editor and run top-to-bottom. Safe to re-run.
--
-- WHY
-- ---
-- The friends grove has always shown every friend as "0 minutes today". Not a
-- rendering bug: `syncScreenTime()` existed in supabase.js and was never called
-- from anywhere, so no client ever wrote a screen_time row. The grid then read
-- the missing row as zero and drew everyone as thriving.
--
-- Fixing the caller exposed a second problem: screen_time.minutes means time
-- EARNED, and the thing worth comparing between friends is time SPENT. A
-- leaderboard built on `minutes` rewards whoever banked the most credits, which
-- is close to the opposite of the point.
--
-- This adds spent_minutes alongside it, so the two questions stop sharing a
-- column.
--
-- The table itself is created if missing — it exists on the live project but
-- was never checked in, so a fresh environment had nothing to migrate.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- STEP 1. The table, for environments that don't have it yet.
-- One row per user per LOCAL day. The client computes the date from the user's
-- own clock, not UTC — see syncScreenTime(). A UTC date here put an evening's
-- usage on tomorrow's row for everyone west of Greenwich, so "today" on the
-- leaderboard reset mid-afternoon.
-- ---------------------------------------------------------------------------
create table if not exists public.screen_time (
  user_id  uuid        not null references auth.users(id) on delete cascade,
  date     date        not null,
  minutes  integer     not null default 0,
  unlocks  integer     not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);


-- ---------------------------------------------------------------------------
-- STEP 2. The new column.
-- Nullable, and deliberately NOT defaulted to 0. NULL means "this user has not
-- reported today", which the leaderboard has to be able to tell apart from a
-- genuine zero — otherwise anyone who never opens the app tops the board with
-- a perfect score.
-- ---------------------------------------------------------------------------
alter table public.screen_time
  add column if not exists spent_minutes integer;

comment on column public.screen_time.minutes is
  'Screen time EARNED on this local day, in minutes.';
comment on column public.screen_time.spent_minutes is
  'Screen time actually CONSUMED on this local day, in minutes. NULL = the user has not reported for this day; distinct from 0, which is a real score of zero.';


-- ---------------------------------------------------------------------------
-- STEP 3. Sanity bounds.
-- A day has 1440 minutes. Anything past that is a clock jump, a timezone
-- change, or a bug in the drain tick, and it would silently poison the
-- leaderboard rankings for everyone who can see that user.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'screen_time_spent_minutes_sane'
      and conrelid = 'public.screen_time'::regclass
  ) then
    alter table public.screen_time
      add constraint screen_time_spent_minutes_sane
      check (spent_minutes is null or (spent_minutes >= 0 and spent_minutes <= 1440))
      not valid;
    alter table public.screen_time validate constraint screen_time_spent_minutes_sane;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- STEP 4. RLS.
--
-- Two different rules, and the difference is the whole feature:
--   * WRITE — you may only ever write your own row.
--   * READ  — you, plus anyone you have an ACCEPTED friendship with. Without
--             the second, the friends leaderboard returns an empty set for
--             every friend and silently renders as if nobody has used their
--             phone today.
--
-- The read policy is scoped to accepted friendships only. A pending request
-- must not leak a day's usage to someone you haven't confirmed.
-- ---------------------------------------------------------------------------
alter table public.screen_time enable row level security;

drop policy if exists screen_time_select_own_or_friend on public.screen_time;
create policy screen_time_select_own_or_friend
  on public.screen_time
  for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and (
          (f.user_id = auth.uid()   and f.friend_id = screen_time.user_id)
          or
          (f.friend_id = auth.uid() and f.user_id   = screen_time.user_id)
        )
    )
  );

drop policy if exists screen_time_insert_own on public.screen_time;
create policy screen_time_insert_own
  on public.screen_time
  for insert
  with check (user_id = auth.uid());

drop policy if exists screen_time_update_own on public.screen_time;
create policy screen_time_update_own
  on public.screen_time
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No delete policy. Usage history is append/update only, consistent with the
-- soft-delete-everything rule in DATA_MODEL.md.


-- ---------------------------------------------------------------------------
-- STEP 5. Index for the friend lookup.
-- getFriendsWithScreenTime() filters an embedded screen_time by a single date
-- across a handful of user ids, so date leads.
-- ---------------------------------------------------------------------------
create index if not exists screen_time_date_user_idx
  on public.screen_time (date, user_id);


-- ---------------------------------------------------------------------------
-- STEP 6. Keep updated_at honest.
-- ---------------------------------------------------------------------------
create or replace function public.screen_time_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists screen_time_touch_updated_at_trg on public.screen_time;
create trigger screen_time_touch_updated_at_trg
  before update on public.screen_time
  for each row execute function public.screen_time_touch_updated_at();


-- ---------------------------------------------------------------------------
-- STEP 7. Make it visible to the API. RUN THIS.
--
-- The client selects spent_minutes inside an embedded resource. Until PostgREST
-- reloads, that select fails with PGRST204 — and because it is an embed, the
-- failure takes the whole friends list down with it, not just the number. The
-- client has a fallback path for exactly this window, but don't rely on it.
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
-- STEP 8. Verify.
-- ---------------------------------------------------------------------------
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'screen_time'
order by ordinal_position;

select policyname, cmd
from pg_policies
where schemaname = 'public' and tablename = 'screen_time'
order by policyname;
