-- =============================================================================
-- schema_v24 — health monitor
--
-- WHY: OpenAI shut down gpt-4.1-nano on 2026-10-23 and every task verification
-- failed for 17 days before anyone noticed. Nothing watched for it. This adds
-- the database half of a monitor; the other half is the `health-check` edge
-- function, which reads these objects and emails alerts via Resend.
--
-- Pieces:
--   1. pg_net, so pg_cron can call the edge function.
--   2. ops_alert_state: per-alert memory (is it firing, when did we last email)
--      so an ongoing outage emails every 6h instead of every hour.
--   3. A Vault secret the cron job sends and the function checks. It is
--      generated here and never leaves the database except to that function.
--   4. health_stats(hours): verification outcome counts from ai_check_usage.
--   5. An hourly cron job.
--
-- Cost: pg_cron + pg_net are free; ~720 function invocations a month.
-- Safe to re-run.
-- =============================================================================

create extension if not exists pg_net with schema extensions;
-- ---------------------------------------------------------------------------
-- STEP 2. Alert state. Service role only: RLS on with no policies means
-- anon/authenticated see nothing; the edge function uses the service role.
-- Rows are upserted, never deleted.
-- ---------------------------------------------------------------------------
create table if not exists public.ops_alert_state (
  key          text primary key,
  firing       boolean not null default false,
  last_sent_at timestamptz,
  last_run_at  timestamptz,
  note         text,
  updated_at   timestamptz not null default now()
);
alter table public.ops_alert_state enable row level security;
revoke all on public.ops_alert_state from anon, authenticated;
-- ---------------------------------------------------------------------------
-- STEP 3. Shared secret between the cron job and the function.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'health_check_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'health_check_secret',
      'Sent by the drift_health_check cron job; checked by the health-check edge function.');
  end if;
end $$;
create or replace function public.health_check_secret()
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'health_check_secret' limit 1;
$$;
revoke all on function public.health_check_secret() from public, anon, authenticated;
grant execute on function public.health_check_secret() to service_role;
-- ---------------------------------------------------------------------------
-- STEP 4. Verification outcomes over the last p_hours.
--
-- ai_check_usage gets one row per verify-task submission (schema_v6). An "AI
-- error" is a row that reached the model step and got no verdict: verified is
-- NULL and proof_kind is set, excluding 'gated' (too early, by design) and
-- '*_question' (a follow-up question, also no verdict by design). Rows with
-- proof_kind NULL are rate-limit ledger rows written before the model step.
-- ---------------------------------------------------------------------------
create or replace function public.health_stats(p_hours int)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'passed',    count(*) filter (where verified is true),
    'rejected',  count(*) filter (where verified is false),
    'ai_errors', count(*) filter (where verified is null and proof_kind is not null
                                    and proof_kind <> 'gated' and proof_kind not like '%\_question'),
    'gated',     count(*) filter (where proof_kind = 'gated'),
    'last_verdict_at', (select max(created_at) from public.ai_check_usage where verified is not null)
  )
  from public.ai_check_usage
  where created_at > now() - make_interval(hours => p_hours);
$$;
revoke all on function public.health_stats(int) from public, anon, authenticated;
grant execute on function public.health_stats(int) to service_role;
-- ---------------------------------------------------------------------------
-- STEP 5. Hourly at :07. The function decides internally what is due (canary
-- every 6h, deprecation page daily, summary on Mondays).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'drift_health_check') then
    perform cron.unschedule('drift_health_check');
  end if;
  perform cron.schedule('drift_health_check', '7 * * * *', $job$
    select net.http_post(
      url     := 'https://kxsikaymdykepcniozlp.supabase.co/functions/v1/health-check',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'x-health-secret', public.health_check_secret()),
      body    := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $job$);
end $$;
