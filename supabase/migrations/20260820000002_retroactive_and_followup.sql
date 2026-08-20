-- Adds tasks.logged_retroactively + the follow-up-question columns, and
-- extends the v6 write guard to cover them.
-- Mirrors supabase/admin/schema_v8_retroactive_and_followup.sql, minus the
-- verification SELECTs.

alter table public.tasks
  add column if not exists logged_retroactively boolean not null default false,
  add column if not exists pending_question     text,
  add column if not exists pending_question_at  timestamptz;

comment on column public.tasks.logged_retroactively is
  'User declared at creation that this task was already complete. Skips the elapsed-time gate and raises the evidence bar instead. Write-once: settable at INSERT, rejected on UPDATE.';
comment on column public.tasks.pending_question is
  'A single clarifying question the verifier asked instead of rejecting. NULL when nothing is outstanding. Set/cleared by verify-task only.';
comment on column public.tasks.pending_question_at is
  'When pending_question was asked. Older than the TTL in verify-task = ignored.';

-- REPLACES the v6 function rather than adding a second trigger, so both guards
-- live in one place and cannot disagree about what "service role" means.
create or replace function public.tasks_guard_verification_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
     or coalesce(current_setting('role', true), '') = 'service_role' then
    return new;
  end if;

  if new.verified_at          is distinct from old.verified_at
     or new.proof_kind          is distinct from old.proof_kind
     or new.proof_summary       is distinct from old.proof_summary
     or new.verify_attempts     is distinct from old.verify_attempts
     or new.pending_question    is distinct from old.pending_question
     or new.pending_question_at is distinct from old.pending_question_at then
    raise exception
      'verification columns are set by the verify-task function only'
      using errcode = '42501';
  end if;

  -- Write-once. Declaring "I already did this" after the fact would retire the
  -- time gate on a task about to fail it.
  if new.logged_retroactively is distinct from old.logged_retroactively then
    raise exception
      'logged_retroactively is fixed when the task is created'
      using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists tasks_guard_verification_columns_trg on public.tasks;
create trigger tasks_guard_verification_columns_trg
  before update on public.tasks
  for each row
  execute function public.tasks_guard_verification_columns();

notify pgrst, 'reload schema';
