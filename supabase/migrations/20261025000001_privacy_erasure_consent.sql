-- ────────────────────────────────────────────────────────────
-- schema_v23_privacy.sql
--
-- Applied via `supabase db push`. Mirrors supabase/admin/schema_v23_privacy.sql
-- minus its verification SELECT — read that file for the why.
--
-- Adds erase_account() (sanctioned hard delete for erasure requests), parental
-- consent columns on families + parental_consent_events, and the nightly
-- purge_expired_data() retention job.
-- ────────────────────────────────────────────────────────────
-- ── 1. Let sanctioned erasure through the no-hard-delete guard ──
create or replace function public.prevent_hard_delete() returns trigger
language plpgsql as $$
begin
  -- Set only by erase_account() / purge_expired_data(), transaction-local.
  if coalesce(current_setting('drift.erasure', true), '') = 'on' then
    return old;
  end if;
  raise exception 'Hard deletes are not allowed on % — use a soft-delete column (deleted_at / removed_at / cancelled_at).', tg_table_name;
end; $$;


-- ── 2. erase_account(uid) ─────────────────────────────────────
-- Removes every row that identifies or describes the user, and returns the ids
-- erased: the user, plus — for a parent — each child in their families, since
-- consent for those children ends with the parent's account. The caller
-- (delete-account / family-privacy) then removes storage objects and
-- soft-deletes each returned auth user.
--
-- Kept on purpose:
--   * the profiles row, scrubbed — auth.users is soft-deleted, not removed, and
--     other tables still reference profiles(id).
--   * trial_ip_log / *_attempts ip hashes are deleted with the user id; nothing
--     else is retained.
--   * rc_webhook_events — subscription transaction records. Apple holds the
--     payment data; we keep the event log for billing disputes and tax, and it
--     carries only the opaque app_user_id.
create or replace function public.erase_account(p_uid uuid)
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  kid uuid;
  fam uuid;
  anon text := 'deleted_' || substr(replace(p_uid::text, '-', ''), 1, 18);
begin
  if p_uid is null then return; end if;
  perform set_config('drift.erasure', 'on', true);

  -- Parent: erase every child first, then the families themselves.
  for fam in select id from public.families where parent_id = p_uid loop
    for kid in
      select user_id from public.family_members
       where family_id = fam and role = 'child'
    loop
      return query select * from public.erase_account(kid);
    end loop;
    delete from public.family_pins where family_id = fam;
    update public.families
       set active = false, deleted_at = coalesce(deleted_at, now()),
           consent_at = null, consent_version = null, consent_method = null
     where id = fam;
  end loop;

  delete from public.family_members        where user_id = p_uid;
  delete from public.app_requests          where child_id = p_uid;
  delete from public.tasks                 where user_id = p_uid;
  delete from public.credit_ledger         where user_id = p_uid;
  delete from public.blocked_apps          where user_id = p_uid;
  delete from public.screen_time           where user_id = p_uid;
  delete from public.ai_check_usage        where user_id = p_uid;
  delete from public.friendships           where user_id = p_uid or friend_id = p_uid;
  delete from public.challenges            where challenger_id = p_uid or challenged_id = p_uid;
  delete from public.analytics_events      where user_id = p_uid;
  delete from public.push_tokens           where user_id = p_uid;
  delete from public.email_hashes          where user_id = p_uid;
  delete from public.onboarding_responses  where user_id = p_uid;
  delete from public.referral_events       where referrer_id = p_uid or referred_id = p_uid;
  delete from public.pro_overrides         where user_id = p_uid;
  delete from public.redeem_code_uses      where user_id = p_uid;
  delete from public.redeem_code_attempts  where user_id = p_uid;
  delete from public.beta_redeem_attempts  where user_id = p_uid;
  delete from public.trial_ip_log          where user_id = p_uid;
  update public.webhook_events set user_id = null where user_id = p_uid;
  -- feedback only exists on some environments.
  if to_regclass('public.feedback') is not null then
    execute 'delete from public.feedback where user_id = $1' using p_uid;
  end if;

  update public.profiles set
    username    = anon,
    full_name   = null,
    avatar_url  = null,
    avatar_seed = 'deleted',
    -- Subscription columns are left alone: profiles_guard_entitlement_columns
    -- rejects anyone but the webhook (purge_expired_data runs as postgres), and
    -- the account can't sign in again anyway. The Apple subscription itself
    -- is the user's to cancel — the delete dialog tells them so.
    stripe_customer_id = null,
    balance_seconds = 0,
    total_xp    = 0,
    updated_at  = now()
  where id = p_uid;

  return next p_uid;
end; $$;

revoke all on function public.erase_account(uuid) from public, anon, authenticated;
grant execute on function public.erase_account(uuid) to service_role;


-- ── 3. Parental consent ───────────────────────────────────────
alter table public.families
  add column if not exists consent_at      timestamptz,
  add column if not exists consent_version text,
  add column if not exists consent_method  text;

comment on column public.families.consent_at is
  'When the parent gave verifiable parental consent (COPPA). Null = no child may join. Written only by the family-privacy edge function.';

-- Append-only audit trail of every grant and withdrawal.
create table if not exists public.parental_consent_events (
  id              uuid primary key default gen_random_uuid(),
  family_id       uuid not null references public.families on delete cascade,
  parent_id       uuid not null references auth.users on delete cascade,
  action          text not null check (action in ('grant', 'withdraw', 'delete_child')),
  notice_version  text,
  method          text,
  child_id        uuid,
  created_at      timestamptz not null default now()
);
alter table public.parental_consent_events enable row level security;

drop policy if exists "consent events: parent read" on public.parental_consent_events;
create policy "consent events: parent read" on public.parental_consent_events
  for select using (parent_id = auth.uid());
-- No insert/update/delete policies: only the service role writes here.


-- ── 4. Retention schedule ────────────────────────────────────
-- Must match "How long we keep data" in PRIVACY_POLICY.md / docs/privacy.html.
--   analytics_events   395 days (13 months)
--   ai_check_usage     90 days  (only today's rows matter for the free-tier cap)
--   push_tokens        270 days without a refresh (the app re-registers on launch)
--   child accounts     18 months with no task activity → erased
create or replace function public.purge_expired_data()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  kid uuid;
  n integer := 0;
begin
  perform set_config('drift.erasure', 'on', true);

  delete from public.analytics_events where created_at < now() - interval '395 days';
  delete from public.ai_check_usage   where created_at < now() - interval '90 days';
  delete from public.push_tokens      where updated_at < now() - interval '270 days';

  for kid in
    select fm.user_id
      from public.family_members fm
     where fm.role = 'child'
       and fm.joined_at < now() - interval '18 months'
       and not exists (
         select 1 from public.tasks t
          where t.user_id = fm.user_id
            and greatest(t.created_at, t.updated_at) > now() - interval '18 months')
  loop
    perform public.erase_account(kid);
    n := n + 1;
  end loop;
  return n;
end; $$;

revoke all on function public.purge_expired_data() from public, anon, authenticated;
grant execute on function public.purge_expired_data() to service_role;

-- Nightly at 04:17 UTC. pg_cron may be unavailable on a local stack; don't fail
-- the migration over it.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'drift_purge_expired_data';
  perform cron.schedule('drift_purge_expired_data', '17 4 * * *', 'select public.purge_expired_data()');
exception when others then
  raise notice 'pg_cron not available (%); schedule purge_expired_data() manually', sqlerrm;
end $$;

-- ── 5. No analytics on children's accounts ──────────────────
-- The parental notice promises it. The client stops tracking for child
-- accounts too; this makes it true even for an old build.
drop policy if exists "Users can insert own events" on public.analytics_events;
create policy "Users can insert own events"
  on public.analytics_events
  for insert
  with check (
    auth.uid() = user_id
    and not exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.account_type = 'child'
    )
  );
delete from public.analytics_events e
 using public.profiles p
 where p.id = e.user_id and p.account_type = 'child';

-- ── 6. Push language ─────────────────────────────────────────
-- Server-sent pushes (send-scheduled-pushes) go out in the language the device
-- uses. The app writes this when it registers its token on launch.
alter table public.push_tokens
  add column if not exists locale text not null default 'en';

