-- ============================================================================
-- schema_v6_proof_gate.sql
--
-- Paste into the Supabase SQL editor and run top-to-bottom. Safe to re-run.
--
-- WHY
-- ---
-- AI Check could be passed instantly and repeatedly. Two holes:
--
--   1. NO TIME GATE. "Read 20 pages" could be created and verified four
--      seconds later. Nothing in the system knew, or could know, that no time
--      had passed — verify-task received the task TITLE from the client and
--      never looked at the row, so it had no created_at to compare against.
--
--   2. NO RECORD OF THE VERDICT. A passed check wrote nothing to the task row.
--      The same task could be submitted again after a rejection until the
--      model happened to say yes, and a dispute ("the AI said no but I did
--      it") had no artifact to inspect.
--
-- This migration gives the server what it needs to close both:
--   * verify-task now looks the task up by id and enforces
--     elapsed >= max(1 min, min(minutes/2, 120 min)) using the DATABASE's
--     created_at, which the client cannot forge.
--   * the verdict, the proof kind, and the model's plain-text reading of the
--     photo/video are persisted on the row.
--
-- No column here is required for the app to keep running — every one is
-- nullable and backfills as NULL. Old rows simply have no verification record.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- STEP 1. Verification outcome columns on tasks.
--
-- verified_at    — set once, when AI Check passes. Its presence is what stops
--                  a verified task from being re-submitted for more credits.
-- proof_kind     — 'text' | 'photo' | 'video' | 'assisted'. 'assisted' is the
--                  path for tasks a camera genuinely cannot capture (phone a
--                  relative, meditate), which are judged on the written
--                  account alone. Recorded so the lenient path is auditable
--                  rather than invisible.
-- proof_summary  — the model's OBJECTIVE, task-blind reading of the submitted
--                  photo or video frames, in plain text. This is the artifact
--                  that makes a verdict explainable after the fact.
-- verify_attempts— how many times AI Check was run against this task. A high
--                  number on a passed task is the signature of someone
--                  resubmitting until the model relented.
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists verified_at     timestamptz,
  add column if not exists proof_kind      text,
  add column if not exists proof_summary   text,
  add column if not exists verify_attempts integer not null default 0;

comment on column public.tasks.verified_at is
  'When AI Check passed for this task. NULL = never verified. Set by the verify-task edge function only; the client cannot write it (see the RLS policy in STEP 3).';
comment on column public.tasks.proof_kind is
  'How the task was proven: text | photo | video | assisted. "assisted" means the task had no capturable evidence and was judged on the written account.';
comment on column public.tasks.proof_summary is
  'Task-blind plain-text description of the submitted image or video frames, produced by the vision pass before any judging happened. Kept so a disputed verdict can be re-read without the original media, which Drift never stores.';
comment on column public.tasks.verify_attempts is
  'Count of AI Check submissions against this task, including rejections.';


-- ---------------------------------------------------------------------------
-- STEP 2. Constrain proof_kind to the four known values.
--
-- Written as a NOT VALID check so an existing row with junk in the column (of
-- which there are none on a first run) cannot block the migration. Validated
-- immediately after, which takes a lock only long enough to scan.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tasks_proof_kind_check'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_proof_kind_check
      check (proof_kind is null or proof_kind in ('text', 'photo', 'video', 'assisted'))
      not valid;

    alter table public.tasks validate constraint tasks_proof_kind_check;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- STEP 3. Stop the CLIENT from writing the verification columns.
--
-- This is the part that actually makes the gate hold. Without it, anyone with
-- the anon key and their own JWT can
--
--   update tasks set verified_at = now(), done = true where id = '...'
--
-- against their own row — RLS already permits it, because the existing update
-- policy grants the owner full control of the row. The edge function's careful
-- timing check would then be decoration.
--
-- The trigger below runs as the table owner and rejects any write that changes
-- a verification column unless the connection is the service role (which is
-- what the edge function uses). Client updates to title, done, credits, etc.
-- are untouched.
--
-- NOTE: `done` itself stays client-writable on purpose. Free-tier tasks and
-- non-AI tasks are completed locally and offline; locking `done` would break
-- them. The gate protects the AI-verified path, and credits for an aiCheck
-- task are only claimable after verified_at is set.
-- ---------------------------------------------------------------------------
create or replace function public.tasks_guard_verification_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The service role bypasses RLS and is the only identity the edge function
  -- runs as. current_setting is used rather than auth.role() so this still
  -- behaves sanely if called outside a PostgREST request.
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
     or coalesce(current_setting('role', true), '') = 'service_role' then
    return new;
  end if;

  if new.verified_at   is distinct from old.verified_at
     or new.proof_kind    is distinct from old.proof_kind
     or new.proof_summary is distinct from old.proof_summary
     or new.verify_attempts is distinct from old.verify_attempts then
    raise exception
      'verification columns are set by the verify-task function only'
      using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists tasks_guard_verification_columns_trg on public.tasks;
create trigger tasks_guard_verification_columns_trg
  before update on public.tasks
  for each row
  execute function public.tasks_guard_verification_columns();


-- ---------------------------------------------------------------------------
-- STEP 4. Record the proof kind and verdict on the usage ledger too.
--
-- ai_check_usage already exists as the rate-limit ledger (one row per
-- submission). Adding the outcome makes it possible to answer "what is the
-- pass rate, and did the strict rewrite change it" without touching task rows.
-- ---------------------------------------------------------------------------
alter table public.ai_check_usage
  add column if not exists proof_kind text,
  add column if not exists verified   boolean;

comment on column public.ai_check_usage.proof_kind is
  'Proof channel used for this submission: text | photo | video | assisted | gated (rejected before the model ran).';
comment on column public.ai_check_usage.verified is
  'Verdict. NULL for submissions that never reached the model (rate limited, time gated).';


-- ---------------------------------------------------------------------------
-- STEP 5. Index for the lookup verify-task now does on every call.
--
-- The function fetches one task by (id, user_id) before anything else. The
-- primary key already covers id, so this is only worth adding if you see the
-- lookup in slow queries — it is included commented-out rather than creating
-- an index nothing uses.
-- ---------------------------------------------------------------------------
-- create index if not exists tasks_user_verified_idx
--   on public.tasks (user_id, verified_at)
--   where verified_at is not null;


-- ---------------------------------------------------------------------------
-- STEP 6. Make the new columns visible to the API. RUN THIS.
--
-- PostgREST caches the table schema. Until it reloads, any select naming
-- verified_at fails with PGRST204 and the task list stops loading entirely.
-- Supabase usually reloads on DDL but can lag; this forces it and is harmless
-- to repeat.
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
-- STEP 7. Verify.
-- Expect four new task columns, two new ai_check_usage columns, and the
-- trigger.
-- ---------------------------------------------------------------------------
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'tasks' and column_name in
      ('verified_at', 'proof_kind', 'proof_summary', 'verify_attempts'))
    or (table_name = 'ai_check_usage' and column_name in ('proof_kind', 'verified'))
  )
order by table_name, column_name;

select tgname, tgenabled
from pg_trigger
where tgrelid = 'public.tasks'::regclass
  and tgname = 'tasks_guard_verification_columns_trg';


-- ---------------------------------------------------------------------------
-- STEP 8 (optional). Confirm the guard actually bites.
--
-- Run this as an ordinary authenticated user (e.g. from the app, or with the
-- anon key), NOT in the SQL editor — the editor connects as a superuser and
-- will sail straight through. Expect: 42501, 'verification columns are set by
-- the verify-task function only'.
--
--   update public.tasks set verified_at = now() where id = '<your task id>';
-- ---------------------------------------------------------------------------
