-- ────────────────────────────────────────────────────────────
-- schema_v17_participant_ids.sql
--
-- Study participant IDs, collected at code redemption.
--
-- The Johns Hopkins pilot reports per participant, keyed on the study's own
-- participant ID, never on a name or email. The ID is entered once, when the
-- participant redeems their cohort code, so it is tied to exactly the account
-- that holds the study grant. Asking at general signup would collect it from
-- everyone, and most users are not in a study.
--
-- Safe to re-run. Applied as supabase/migrations/20260919000001_participant_ids.sql.
-- ────────────────────────────────────────────────────────────

-- ── 1. PER-CODE ID REQUIREMENT ──────────────────────────────
--
-- A regex rather than a boolean, so each study's format can be enforced
-- without a code change: when the researchers confirm what their IDs look
-- like, update this column on their code. null = the code does not ask.
alter table public.redeem_codes
  add column if not exists participant_id_format text;

alter table public.redeem_code_uses
  add column if not exists participant_id text;

-- One participant ID per code. Two accounts claiming the same ID would merge
-- two people in the report, or let one person hold two seats.
create unique index if not exists redeem_code_uses_participant_unique
  on public.redeem_code_uses (code, participant_id)
  where participant_id is not null and removed_at is null;


-- ── 2. REDEMPTION, NOW WITH AN ID ───────────────────────────
--
-- Replaces the two-argument version from v16. The old signature is dropped
-- rather than overloaded: with both present, a call naming only p_uid and
-- p_code is ambiguous. The default keeps the deployed edge function working
-- between this migration and its redeploy.
drop function if exists public.redeem_cohort_code(uuid, text);

create or replace function public.redeem_cohort_code(
  p_uid uuid, p_code text, p_participant_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code    public.redeem_codes%rowtype;
  v_expires timestamptz;
  -- Upper-cased so 'jhu-007' and 'JHU-007' are one participant, not two.
  v_pid     text := nullif(upper(trim(coalesce(p_participant_id, ''))), '');
begin
  if p_uid is null then
    return jsonb_build_object('error', 'no_user');
  end if;

  -- The row lock serializes every redemption of this code, which is what makes
  -- the pre-checks below (already redeemed, ID taken) race-free.
  select * into v_code
  from public.redeem_codes
  where code = upper(trim(p_code))
  for update;

  if not found then
    return jsonb_build_object('error', 'invalid_code');
  end if;
  if v_code.deleted_at is not null or not v_code.active then
    return jsonb_build_object('error', 'code_inactive');
  end if;
  if v_code.expires_at is not null and v_code.expires_at <= now() then
    return jsonb_build_object('error', 'code_expired');
  end if;

  -- Before the seat and ID checks: a retry after a flaky network must read as
  -- success, even if the retry did not resend the ID.
  if exists (
    select 1 from public.redeem_code_uses
    where code = v_code.code and user_id = p_uid and removed_at is null
  ) then
    return jsonb_build_object('error', 'already_redeemed');
  end if;

  if v_code.max_uses is not null and v_code.uses >= v_code.max_uses then
    return jsonb_build_object('error', 'code_exhausted');
  end if;
  if not v_code.grants_pro then
    return jsonb_build_object('error', 'code_grants_nothing');
  end if;

  if v_code.participant_id_format is not null then
    if v_pid is null then
      return jsonb_build_object('error', 'participant_id_required');
    end if;
    if v_pid !~ v_code.participant_id_format then
      return jsonb_build_object('error', 'participant_id_invalid');
    end if;
    if exists (
      select 1 from public.redeem_code_uses
      where code = v_code.code and participant_id = v_pid and removed_at is null
    ) then
      return jsonb_build_object('error', 'participant_id_taken');
    end if;
  else
    -- Codes that do not ask never store one, even if a client sends it.
    v_pid := null;
  end if;

  begin
    insert into public.redeem_code_uses (code, user_id, participant_id)
    values (v_code.code, p_uid, v_pid);
  exception when unique_violation then
    return jsonb_build_object('error', 'already_redeemed');
  end;

  update public.redeem_codes set uses = uses + 1 where code = v_code.code;

  v_expires := case
    when v_code.grant_days is null then null
    else now() + make_interval(days => v_code.grant_days)
  end;

  insert into public.pro_overrides (user_id, granted, note, expires_at, granted_at, granted_by)
  values (
    p_uid, true,
    coalesce(v_code.cohort, v_code.note),
    v_expires, now(), 'redeem:' || v_code.code
  )
  on conflict (user_id) do update
    set granted    = true,
        -- Never shorten an existing grant (see v16).
        expires_at = case
          when public.pro_overrides.expires_at is null then null
          when excluded.expires_at is null             then null
          else greatest(public.pro_overrides.expires_at, excluded.expires_at)
        end,
        note       = coalesce(excluded.note, public.pro_overrides.note),
        granted_at = now(),
        granted_by = excluded.granted_by;

  return jsonb_build_object(
    'ok',         true,
    'cohort',     v_code.cohort,
    'expires_at', v_expires
  );
end $$;

-- Load-bearing: p_uid is a parameter, so this must stay service-role only.
revoke all on function public.redeem_cohort_code(uuid, text, text) from public, anon, authenticated;


-- ── 3. PER-PARTICIPANT FUNNEL ───────────────────────────────
--
-- What the study asked for, one row per participant ID and nothing that
-- identifies the person: no user_id, name or email leaves this function.
--
--   redeemed    used their code (the row exists)
--   authorized  answered Apple's Screen Time prompt with approval
--   activated   blocked at least one app, category or site
--   engaged     completed at least one task
--
-- authorized and activated count whenever they happened: they are setup
-- states, and a teen may grant Screen Time access and pick apps during
-- onboarding, before the paywall where the code gets redeemed. Usage
-- (tasks, days opened) counts only from redemption onward, so activity from
-- before someone joined the study does not leak into it.
create or replace function public.cohort_participants(p_cohort text)
returns table (
  participant_id   text,
  code             text,
  redeemed_at      timestamptz,
  authorized       boolean,
  activated        boolean,
  engaged          boolean,
  tasks_completed  bigint,
  days_opened      bigint,
  last_opened      timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.participant_id,
    u.code,
    u.redeemed_at,
    exists (
      select 1 from public.analytics_events e
      where e.user_id = u.user_id
        and e.event_name = 'screen_time_authorized'
        and e.properties->>'status' = 'approved'
    ) as authorized,
    exists (
      select 1 from public.analytics_events e
      where e.user_id = u.user_id
        and e.event_name = 'blocked_apps_selected'
        and coalesce((e.properties->>'apps')::int, 0)
          + coalesce((e.properties->>'categories')::int, 0)
          + coalesce((e.properties->>'web')::int, 0) > 0
    ) as activated,
    exists (
      select 1 from public.tasks t
      where t.user_id = u.user_id and t.deleted_at is null
        and t.done and t.completed_at >= u.redeemed_at
    ) as engaged,
    (select count(*) from public.tasks t
      where t.user_id = u.user_id and t.deleted_at is null
        and t.done and t.completed_at >= u.redeemed_at) as tasks_completed,
    (select count(distinct e.created_at::date) from public.analytics_events e
      where e.user_id = u.user_id and e.created_at >= u.redeemed_at
        and e.event_name = 'app_opened') as days_opened,
    (select max(e.created_at) from public.analytics_events e
      where e.user_id = u.user_id and e.event_name = 'app_opened') as last_opened
  from public.redeem_code_uses u
  join public.redeem_codes c on c.code = u.code
  where c.cohort = p_cohort
    and u.removed_at is null
    and u.participant_id is not null
  order by u.participant_id;
$$;

revoke all on function public.cohort_participants(text) from public, anon, authenticated;

notify pgrst, 'reload schema';


-- ── RUNBOOK ─────────────────────────────────────────────────
--
-- Require IDs on a code (letters, numbers and dashes, up to 32). Tighten the
-- pattern once the study confirms its format, e.g. '^JHU-[0-9]{3}$':
--
--   update public.redeem_codes
--      set participant_id_format = '^[A-Za-z0-9-]{1,32}$'
--    where code = '<code>';
--
-- Report for the researchers:
--
--   select * from public.cohort_participants('jhu-wellbeing-2026');


-- ── VERIFY ──────────────────────────────────────────────────
select
  exists (select 1 from information_schema.columns
          where table_name = 'redeem_codes' and column_name = 'participant_id_format') as has_format_col,
  exists (select 1 from information_schema.columns
          where table_name = 'redeem_code_uses' and column_name = 'participant_id') as has_pid_col,
  (select count(*) from pg_proc where proname = 'redeem_cohort_code') as redeem_fn_versions,  -- expect 1
  exists (select 1 from pg_proc where proname = 'cohort_participants') as has_report_fn;
