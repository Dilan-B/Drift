-- Adds screen_time.spent_minutes + friend-read RLS.
-- Mirrors supabase/admin/schema_v7_screen_time_spent.sql, minus the
-- verification SELECTs that file ends with (those are for a human running it
-- in the SQL editor, not for a migration).

create table if not exists public.screen_time (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  date       date        not null,
  minutes    integer     not null default 0,
  unlocks    integer     not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

-- Nullable and NOT defaulted to 0 on purpose: NULL means "has not reported
-- today", which the leaderboard must tell apart from a real zero, or anyone who
-- never opens Drift tops the board.
alter table public.screen_time
  add column if not exists spent_minutes integer;

comment on column public.screen_time.minutes is
  'Screen time EARNED on this local day, in minutes.';
comment on column public.screen_time.spent_minutes is
  'Screen time actually CONSUMED on this local day, in minutes. NULL = not reported; distinct from 0.';

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

alter table public.screen_time enable row level security;

-- Read: yourself, plus anyone you have an ACCEPTED friendship with. Without the
-- second clause the friends leaderboard returns an empty set and renders as if
-- nobody used their phone. Pending requests deliberately excluded.
drop policy if exists screen_time_select_own_or_friend on public.screen_time;
create policy screen_time_select_own_or_friend
  on public.screen_time for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.user_id = auth.uid() and f.friend_id = screen_time.user_id)
          or (f.friend_id = auth.uid() and f.user_id = screen_time.user_id))
    )
  );

drop policy if exists screen_time_insert_own on public.screen_time;
create policy screen_time_insert_own
  on public.screen_time for insert
  with check (user_id = auth.uid());

drop policy if exists screen_time_update_own on public.screen_time;
create policy screen_time_update_own
  on public.screen_time for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index if not exists screen_time_date_user_idx
  on public.screen_time (date, user_id);

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

notify pgrst, 'reload schema';
