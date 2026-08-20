-- ============================================================================
-- schema_v8_retroactive_and_followup.sql
--
-- Paste into the Supabase SQL editor and run top-to-bottom. Safe to re-run.
-- Requires schema_v6_proof_gate.sql to have been run first (this extends the
-- trigger that file installs).
--
-- WHY
-- ---
-- Two problems with the proof gate as shipped in v6.
--
-- 1. IT ASSUMES YOU LOG BEFORE YOU START.
--
--    The gate anchors on tasks.created_at, so it only makes sense for
--    create -> do -> prove. But "washed the dishes, now let me log it" is a
--    completely normal way to use Drift, and that user is told to wait fifteen
--    minutes to prove something already finished. That reads as broken, not
--    strict.
--
--    logged_retroactively records, AT CREATION, that the work is already done.
--    It opens the gate immediately and in exchange the verifier demands
--    stronger evidence. The reason this isn't just a bypass: the flag is set
--    before the user knows whether they'll struggle to prove the task, and it
--    costs them the lenient rubric. It's a commitment, not an escape hatch —
--    which is also why STEP 3 makes it immutable after insert.
--
-- 2. A REJECTION WAS A DEAD END.
--
--    An honest user whose photo was ambiguous got a flat no and lost the
--    credits, with four attempts to guess what would satisfy the model. The
--    verifier can now ask ONE specific question instead — "what page did you
--    stop on?" — and judge the answer. pending_question holds it between the
--    two requests.
--
--    Stored server-side rather than round-tripped through the client on
--    purpose: a client that could choose its own question would just ask
--    itself something trivial.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- STEP 1. The columns.
--
-- logged_retroactively — set at INSERT only. NULL/false on every existing row,
--                        which is correct: they all followed the normal flow.
-- pending_question     — the follow-up the verifier is waiting on, or NULL.
--                        Cleared as soon as it is answered.
-- pending_question_at  — when it was asked. Lets a stale question expire rather
--                        than sitting on the row forever; a question asked
--                        yesterday is not one the user still remembers the
--                        context for.
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists logged_retroactively boolean not null default false,
  add column if not exists pending_question     text,
  add column if not exists pending_question_at  timestamptz;

comment on column public.tasks.logged_retroactively is
  'The user declared at creation that this task was already complete. Skips the elapsed-time gate and raises the evidence bar instead. Write-once: settable at INSERT, rejected on UPDATE (see the trigger below).';
comment on column public.tasks.pending_question is
  'A single clarifying question the verifier asked instead of rejecting outright. NULL when nothing is outstanding. Set and cleared by the verify-task function only.';
comment on column public.tasks.pending_question_at is
  'When pending_question was asked. Questions older than the expiry in verify-task are ignored.';


-- ---------------------------------------------------------------------------
-- STEP 2. Keep the follow-up columns out of client hands.
--
-- Same reasoning as the verification columns in v6: a user who can write
-- pending_question can hand the judge a question of their own choosing, and a
-- user who can clear it can dodge being asked. Both are set by the edge
-- function under the service role.
--
-- This REPLACES the v6 function rather than adding a second trigger, so the
-- two guards stay in one place and can't disagree about what "service role"
-- means.
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

  if new.verified_at        is distinct from old.verified_at
     or new.proof_kind         is distinct from old.proof_kind
     or new.proof_summary      is distinct from old.proof_summary
     or new.verify_attempts    is distinct from old.verify_attempts
     or new.pending_question   is distinct from old.pending_question
     or new.pending_question_at is distinct from old.pending_question_at then
    raise exception
      'verification columns are set by the verify-task function only'
      using errcode = '42501';
  end if;

  -- Write-once. Declaring "I already did this" AFTER the fact would let anyone
  -- retire the time gate on a task that was going to fail it — which is the
  -- exact hole the gate exists to close.
  if new.logged_retroactively is distinct from old.logged_retroactively then
    raise exception
      'logged_retroactively is fixed when the task is created'
      using errcode = '42501';
  end if;

  return new;
end $$;

-- The trigger itself is unchanged from v6; recreated only so a fresh database
-- that skipped v6 still ends up with it attached.
drop trigger if exists tasks_guard_verification_columns_trg on public.tasks;
create trigger tasks_guard_verification_columns_trg
  before update on public.tasks
  for each row
  execute function public.tasks_guard_verification_columns();


-- ---------------------------------------------------------------------------
-- STEP 3. Make the new columns visible to the API. RUN THIS.
--
-- insertTask names logged_retroactively on every task create. Until PostgREST
-- reloads its schema cache that insert fails with PGRST204 — which would break
-- ALL task creation, not just retroactive ones. The client has a retry that
-- drops the column, but don't lean on it.
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
-- STEP 4. Verify.
-- ---------------------------------------------------------------------------
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'tasks'
  and column_name in ('logged_retroactively', 'pending_question', 'pending_question_at')
order by column_name;


-- ---------------------------------------------------------------------------
-- STEP 5 (optional). Confirm the write-once guard bites.
--
-- Run as an ordinary authenticated user, NOT in the SQL editor — the editor
-- connects as a superuser and sails straight through.
-- Expect: 42501, 'logged_retroactively is fixed when the task is created'.
--
--   update public.tasks set logged_retroactively = true where id = '<task id>';
-- ---------------------------------------------------------------------------
