-- ────────────────────────────────────────────────────────────
-- Drift schema v9 — Pre-signup onboarding responses (analytics)
--
-- Captures the questionnaire answers a user gives before signing up (phone
-- usage, wake time, distractions, age, goals, daily tasks, difficulty). One
-- row per user, written by the client right after signup; you read all of them
-- with the service role (SQL editor) for analytics.
--
-- Idempotent. Run in the Supabase SQL Editor.
-- ────────────────────────────────────────────────────────────

create table if not exists public.onboarding_responses (
  user_id      uuid primary key references auth.users on delete cascade,
  usage        text,        -- "1-2" | "2-4" | "4-6" | "6+"
  wakeup       text,        -- "5-6" | "6-7" | "7-8" | "8+"
  age          text,        -- "under18" | "18-24" | "25-34" | "35+"
  difficulty   text,        -- "easy" | "medium" | "hard" | "committed"
  distractions text[] default '{}',  -- social, news, youtube, tiktok, games, messages
  goals        text[] default '{}',  -- cut, mornings, focus, addiction
  tasks        text[] default '{}',  -- make_bed, workout, read, ...
  answers      jsonb not null default '{}'::jsonb,  -- raw answers object
  created_at   timestamptz not null default now()
);

alter table public.onboarding_responses enable row level security;

-- Client (authenticated role) needs table-level access; RLS below scopes rows.
grant select, insert, update on public.onboarding_responses to authenticated;

-- A user may write and read ONLY their own row. (You, via the service role in
-- the SQL editor, bypass RLS and can read everyone's for analytics.)
drop policy if exists "insert own onboarding" on public.onboarding_responses;
create policy "insert own onboarding"
  on public.onboarding_responses for insert
  with check (auth.uid() = user_id);

drop policy if exists "update own onboarding" on public.onboarding_responses;
create policy "update own onboarding"
  on public.onboarding_responses for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "read own onboarding" on public.onboarding_responses;
create policy "read own onboarding"
  on public.onboarding_responses for select
  using (auth.uid() = user_id);

-- Verify
do $$
begin
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='onboarding_responses')
    then raise exception 'onboarding_responses table missing'; end if;
end $$;

select 'schema_v9_onboarding applied — ' || count(*)::text || ' responses' as status
from public.onboarding_responses;

-- ────────────────────────────────────────────────────────────
-- ANALYTICS QUERIES (run as needed in the SQL editor)
-- ────────────────────────────────────────────────────────────
-- Phone-usage distribution:
--   select usage, count(*) from public.onboarding_responses group by usage order by 2 desc;
-- Most-wanted goals:
--   select g, count(*) from public.onboarding_responses, unnest(goals) g group by g order by 2 desc;
-- Most-picked starter tasks:
--   select t, count(*) from public.onboarding_responses, unnest(tasks) t group by t order by 2 desc;
-- Difficulty split:
--   select difficulty, count(*) from public.onboarding_responses group by difficulty order by 2 desc;
