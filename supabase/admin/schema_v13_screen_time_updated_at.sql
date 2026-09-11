-- schema_v13_screen_time_updated_at.sql
--
-- FIXES A LIVE BUG: every screen-time sync has been failing.
--
-- Symptom, seen in the client as a warning on every sync:
--     syncScreenTime: record "new" has no field "updated_at"
--
-- Confirmed against the live schema with the PostgREST probe CLAUDE.md
-- prescribes — `?select=updated_at&limit=0` returns 42703
-- "column screen_time.updated_at does not exist" — while `spent_minutes`,
-- `minutes`, `date` and `user_id` all return 200.
--
-- ROOT CAUSE
-- schema_v7 declared the column inside `create table IF NOT EXISTS
-- public.screen_time (...)`. The table already existed from schema_v2, so the
-- whole CREATE was skipped and the column was never added. `spent_minutes`
-- survived only because it got its own explicit
-- `alter table ... add column if not exists` afterwards; `updated_at` never
-- did. The trigger below it was then created unconditionally, so it fires on
-- every UPDATE and throws on a column that isn't there.
--
-- The upsert in syncScreenTime() conflicts on (user_id, date), so the second
-- and every later write of a given day is an UPDATE — which means a user's
-- first sync of the day succeeds and every one after it fails. That is why
-- the friends leaderboard shows stale or missing "screen time today".
--
-- THE LESSON, WHICH IS ALREADY IN CLAUDE.md
-- `create table if not exists` is not a way to add columns to a table that
-- exists. Any column added to an existing table needs its own ALTER, and the
-- migration must be verified against the live schema rather than trusted.
--
-- Safe to re-run. Additive, with a default, so no backfill is needed and no
-- existing row is rewritten.

alter table public.screen_time
  add column if not exists updated_at timestamptz not null default now();

-- Recreate the trigger so it is definitely bound to a table that now has the
-- column. Harmless if it was already correct.
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

-- ── Verification ────────────────────────────────────────────
-- Expect one row naming updated_at.
select column_name, data_type, column_default, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'screen_time'
   and column_name  = 'updated_at';

-- Then re-run the client probe; it must return 200 rather than 42703:
--   curl "<url>/rest/v1/screen_time?select=updated_at&limit=0" \
--     -H "apikey: <anon>" -H "Authorization: Bearer <anon>"
