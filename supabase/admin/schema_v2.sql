-- ────────────────────────────────────────────────────────────
-- Drift schema additions — fully idempotent and self-contained.
-- Safe to run multiple times. Run in Supabase SQL Editor.
-- ────────────────────────────────────────────────────────────

-- ── 0. Base tables (create if missing — covers fresh projects) ──

-- profiles: one row per user (auth.users is managed by Supabase Auth)
create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  username     text unique,
  full_name    text,
  avatar_seed  text default 'drift',
  install_date timestamptz default now(),
  sub_active   boolean default false,
  sub_expires  timestamptz,
  updated_at   timestamptz default now()
);
alter table public.profiles enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='profiles' and policyname='Users can read all profiles')
  then create policy "Users can read all profiles"  on public.profiles for select using (true);  end if;

  if not exists (select 1 from pg_policies where tablename='profiles' and policyname='Users can update own profile')
  then create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id); end if;

  if not exists (select 1 from pg_policies where tablename='profiles' and policyname='Users can insert own profile')
  then create policy "Users can insert own profile" on public.profiles for insert with check (auth.uid() = id); end if;
end $$;

-- AI usage log (for rate limiting)
create table if not exists public.ai_check_usage (
  id         bigserial primary key,
  user_id    uuid references auth.users not null,
  created_at timestamptz default now() not null
);
alter table public.ai_check_usage enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='ai_check_usage' and policyname='users read own usage')
  then create policy "users read own usage" on public.ai_check_usage for select using (auth.uid() = user_id); end if;
end $$;

-- Screen time per day
create table if not exists public.screen_time (
  id      bigserial primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  date    date not null default current_date,
  minutes int  not null default 0,
  unlocks int  not null default 0,
  unique (user_id, date)
);
alter table public.screen_time enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='screen_time' and policyname='Users can read all screen time')
  then create policy "Users can read all screen time"  on public.screen_time for select using (true); end if;

  if not exists (select 1 from pg_policies where tablename='screen_time' and policyname='Users can upsert own screen time')
  then create policy "Users can upsert own screen time" on public.screen_time for all using (auth.uid() = user_id); end if;
end $$;

-- Friendships
create table if not exists public.friendships (
  id         bigserial primary key,
  user_id    uuid references public.profiles(id) on delete cascade not null,
  friend_id  uuid references public.profiles(id) on delete cascade not null,
  status     text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz default now(),
  unique (user_id, friend_id)
);
alter table public.friendships enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='friendships' and policyname='Users can manage own friendships')
  then create policy "Users can manage own friendships" on public.friendships for all
       using (auth.uid() = user_id or auth.uid() = friend_id); end if;
end $$;

-- ── 1. Make sure profiles has every column we depend on ──
-- Pre-existing projects may be missing columns; add anything missing.
alter table public.profiles
  add column if not exists username           text,
  add column if not exists full_name          text,
  add column if not exists avatar_seed        text default 'drift',
  add column if not exists install_date       timestamptz default now(),
  add column if not exists updated_at         timestamptz default now(),
  add column if not exists stripe_customer_id text,
  add column if not exists sub_active         boolean default false,
  add column if not exists sub_expires        timestamptz,
  add column if not exists trial_claimed_at   timestamptz;

-- Username must be unique (idempotent — error if dupes already exist)
do $$ begin
  if not exists (
    select 1 from pg_indexes where indexname = 'profiles_username_key'
  ) then
    begin
      create unique index profiles_username_key on public.profiles (username);
    exception when others then
      raise notice 'Could not create unique index on profiles.username: %', sqlerrm;
    end;
  end if;
end $$;

-- ── 2. IP hash log for trial-abuse detection ──
create table if not exists public.trial_ip_log (
  id         bigserial primary key,
  ip_hash    text not null,
  user_id    uuid references auth.users on delete cascade,
  created_at timestamptz default now() not null
);
alter table public.trial_ip_log enable row level security;
-- No policies → no client access. Only service-role (edge functions) can read/write.

-- ── 3. Auto-create profile on signup (trigger) ──
-- Defensive: never blocks the auth signup, retries on username collision.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uname text;
  tries int := 0;
begin
  -- Retry up to 5 times on the rare username collision
  loop
    uname := 'drifter' || lower(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    begin
      insert into public.profiles (id, username, full_name)
      values (
        new.id,
        uname,
        coalesce(new.raw_user_meta_data->>'full_name', '')
      )
      on conflict (id) do nothing;
      exit;  -- success
    exception
      when unique_violation then
        tries := tries + 1;
        if tries >= 5 then exit; end if;
      when others then
        -- Any other error: log + give up but DO NOT block the signup
        raise warning 'handle_new_user failed for %: %', new.id, sqlerrm;
        exit;
    end;
  end loop;

  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 4. Performance indexes for hot paths ──
create index if not exists profiles_sub_active     on public.profiles    (sub_active)  where sub_active = true;
create index if not exists screen_time_user_date   on public.screen_time (user_id, date desc);
create index if not exists ai_usage_user_recent    on public.ai_check_usage (user_id, created_at desc);
create index if not exists friendships_user_status on public.friendships (user_id, status);
create index if not exists friendships_friend_stat on public.friendships (friend_id, status);
create index if not exists trial_ip_log_hash_time  on public.trial_ip_log (ip_hash, created_at desc);
create index if not exists trial_ip_log_user       on public.trial_ip_log (user_id);

-- ── Done ──
select 'schema_v2.sql complete' as status;
