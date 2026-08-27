-- ────────────────────────────────────────────────────────────
-- Fix: ai_check_usage is missing an INSERT policy.
--
-- schema_v2 created ai_check_usage with RLS ON and only a SELECT policy
-- ("users read own usage"). The verify-task edge function runs as the calling
-- USER (anon key + their JWT) and logs each AI Check by inserting a row — but
-- with no INSERT policy, RLS rejects it:
--     42501  new row violates row-level security policy for table "ai_check_usage"
--     403    POST /rest/v1/ai_check_usage
-- The insert is fire-and-forget so the check still returns, but it errors on
-- every call (log spam) and the per-user AI-Check rate limit never records
-- anything (counts stay 0). This adds the missing policy.
--
-- Safe to run anytime. Idempotent.
-- ────────────────────────────────────────────────────────────

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'ai_check_usage' and policyname = 'users insert own usage'
  ) then
    create policy "users insert own usage" on public.ai_check_usage
      for insert with check (auth.uid() = user_id);
  end if;
end $$;

-- Verify.
select policyname, cmd
from pg_policies
where tablename = 'ai_check_usage'
order by policyname;
