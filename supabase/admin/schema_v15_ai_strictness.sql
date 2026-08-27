-- ────────────────────────────────────────────────────────────
-- Drift schema v15 — AI Checker strictness
--
-- Adds a per-user strictness setting for the AI Checker (verify-task edge
-- function). Set once during onboarding, editable later from the Profile
-- screen. Server-authoritative: verify-task reads this column directly by
-- user id rather than trusting a client-supplied value.
--
-- Idempotent. Run in the Supabase SQL Editor.
-- ────────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists ai_check_strictness text not null default 'medium';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_ai_check_strictness_check'
  ) then
    alter table public.profiles
      add constraint profiles_ai_check_strictness_check
      check (ai_check_strictness in ('easy', 'medium', 'hard'));
  end if;
end $$;

-- Verify
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'ai_check_strictness'
  ) then raise exception 'ai_check_strictness column missing'; end if;
end $$;

select 'schema_v15_ai_strictness applied — ' || count(*)::text || ' profiles' as status
from public.profiles;
