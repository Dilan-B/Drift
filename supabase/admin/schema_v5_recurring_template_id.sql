-- ============================================================================
-- schema_v5_recurring_template_id.sql
--
-- Paste into the Supabase SQL editor and run top-to-bottom. Safe to re-run.
--
-- WHY
-- ---
-- "One instance per recurring template per day" is currently enforced only on
-- the client: `recurringTemplateId` is a client-only field (no column existed
-- for it), and the dedup guard lives in AsyncStorage. Neither survives a server
-- round-trip reliably, so the app re-materializes every recurring task on every
-- launch. Live rows confirm it: 3 duplicate pairs on 2026-07-16 alone, one per
-- app launch, every day.
--
-- This moves the invariant into the database, where it cannot be lost:
--   1. tasks.recurring_template_id  — persists the template link server-side
--   2. a UNIQUE index               — makes a duplicate insert impossible
--
-- The unique index deliberately does NOT exclude soft-deleted rows. A tombstoned
-- instance must keep blocking re-creation for that day, otherwise deleting a
-- recurring task just resurrects it on the next sync (the exact bug seen on
-- 2026-07-14, where NJIT internship was recreated 3x in 80 seconds).
--
-- STEP 3 is destructive-ish (soft-delete only, never a hard DELETE — per the
-- no-hard-delete policy in DATA_MODEL.md). Read its comment before running.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- STEP 1. Add the column.
-- Nullable: manually-created (non-recurring) tasks legitimately have no
-- template, and every task that already exists predates this column.
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists recurring_template_id uuid;

comment on column public.tasks.recurring_template_id is
  'Client-generated id of the recurring template that produced this task. NULL for one-off tasks. Paired with the unique index below to enforce one instance per template per day.';


-- ---------------------------------------------------------------------------
-- STEP 2. Clean up the existing duplicates BEFORE adding the constraint.
--
-- Soft-delete (never DELETE) every live duplicate, keeping the EARLIEST row per
-- (user, title, category, task_date). Ties are broken by created_at then id so
-- the result is deterministic.
--
-- Completed rows are excluded from the cleanup: they carry real earned credits
-- and ledger entries, and collapsing them would silently rewrite your history.
--
-- DRY RUN FIRST — this select shows exactly what STEP 2b would tombstone.
-- Run it, read the list, and only then run 2b.
-- ---------------------------------------------------------------------------

-- STEP 2a — DRY RUN (read-only)
with ranked as (
  select
    id, user_id, title, task_date, created_at,
    row_number() over (
      partition by user_id, title, category, task_date
      order by created_at, id
    ) as rn
  from public.tasks
  where deleted_at is null
    and done = false
)
select id, title, task_date, created_at, rn
from ranked
where rn > 1
order by task_date desc, title, created_at;


-- STEP 2b — APPLY (soft-delete only). Uncomment and run once you've read 2a.
--
-- with ranked as (
--   select
--     id,
--     row_number() over (
--       partition by user_id, title, category, task_date
--       order by created_at, id
--     ) as rn
--   from public.tasks
--   where deleted_at is null
--     and done = false
-- )
-- update public.tasks t
-- set deleted_at = now()
-- from ranked r
-- where t.id = r.id
--   and r.rn > 1;


-- ---------------------------------------------------------------------------
-- STEP 3. The constraint that actually fixes the bug.
--
-- After this exists, a second insert for the same (user, template, day) fails
-- with a unique violation instead of silently creating a duplicate — no matter
-- what the client's in-memory or AsyncStorage guard does.
--
-- Partial (WHERE recurring_template_id is not null) so one-off tasks are
-- unaffected and can still be added freely, including several with the same
-- title on the same day.
--
-- NOTE: this will fail if STEP 2b hasn't cleared existing duplicates that
-- already carry a template id. Since recurring_template_id starts NULL for all
-- historical rows, that won't bite on the first run.
-- ---------------------------------------------------------------------------
create unique index if not exists tasks_one_instance_per_template_per_day
  on public.tasks (user_id, recurring_template_id, task_date)
  where recurring_template_id is not null;


-- ---------------------------------------------------------------------------
-- STEP 3b. Make the new column visible to the API. RUN THIS.
--
-- The client talks to Postgres through PostgREST, which caches the table schema.
-- Until it reloads, every insert naming recurring_template_id fails with
-- PGRST204 ("Could not find the 'recurring_template_id' column of 'tasks' in the
-- schema cache") — which would break ALL task creation, not just recurring ones.
--
-- Supabase normally reloads automatically on DDL, but it can lag. This forces it
-- and is harmless to run again.
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
-- STEP 4. Verify.
-- Expect: the column exists, and the unique index is listed.
-- ---------------------------------------------------------------------------
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'tasks'
  and column_name = 'recurring_template_id';

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'tasks'
  and indexname = 'tasks_one_instance_per_template_per_day';
