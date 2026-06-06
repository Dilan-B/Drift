-- Drift profile + challenge feature updates
-- Run in Supabase SQL Editor for existing projects.
--
-- This file intentionally does not modify Supabase Storage policies. Storage
-- policy DDL can deadlock with active Storage/API reads in Supabase's hosted
-- environment. Run supabase/avatar_storage_setup.sql separately, or create the
-- avatars bucket from the Supabase dashboard.

set lock_timeout = '5s';
set statement_timeout = '60s';

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'avatar_url'
  ) then
    alter table public.profiles add column avatar_url text;
  end if;
end $$;

create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username));

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'challenges'
      and column_name = 'title'
  ) then
    alter table public.challenges add column title text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'challenges'
      and column_name = 'description'
  ) then
    alter table public.challenges add column description text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'challenges'
      and column_name = 'duration_mins'
  ) then
    alter table public.challenges add column duration_mins int;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'challenges'
      and column_name = 'ai_required'
  ) then
    alter table public.challenges add column ai_required boolean default false;
  end if;
end $$;

create index if not exists challenges_challenged_status_idx
  on public.challenges (challenged_id, status, created_at desc);

create index if not exists challenges_challenger_status_idx
  on public.challenges (challenger_id, status, created_at desc);
