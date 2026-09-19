-- ────────────────────────────────────────────────────────────
-- Drift schema v16 — Cohort redemption codes
--
-- Extends v10's redeem_codes so a code can belong to a NAMED COHORT (a research
-- programme, a school, a partner) and grant access for a per-code duration —
-- 50 days for the Johns Hopkins digital-wellbeing study, or null for a cohort
-- whose access should never expire.
--
-- Three things v10 could not do:
--   1. Say which cohort a redemption belongs to, so we can report participation
--      back to a research team.
--   2. Vary how long the granted access lasts per code. v10 always wrote a
--      pro_override with whatever expires_at the edge function passed, which
--      was always null.
--   3. Survive concurrency. The edge function increments `uses` with a
--      read-modify-write, so two people redeeming the last seat of a capped
--      code both read uses = max_uses - 1 and both succeed. redeem_cohort_code()
--      below takes a row lock and closes that.
--
-- The grant still lands in pro_overrides, deliberately. has_own_entitlement()
-- (v9 STEP 7) already ORs that table in, so nothing about entitlement
-- resolution changes and every existing gate — including children inheriting
-- through is_pro() — keeps working with no edge-function deploy.
--
-- DEPENDS ON schema_v10_redeem_codes.sql and schema_v9_payments.sql. Run both first.
-- Idempotent. Run in the Supabase SQL Editor.
-- ────────────────────────────────────────────────────────────

-- ── 1. COHORT + GRANT DURATION on the codes table ───────────
--
-- expires_at and grant_days answer different questions and are deliberately
-- separate: expires_at is when the CODE stops being redeemable, grant_days is
-- how long the ACCESS it hands out lasts, counted from each redemption. A study
-- code is typically open for a recruitment window and grants a fixed span, so a
-- participant joining on the last day still gets their full run.
alter table public.redeem_codes
  add column if not exists cohort     text,
  add column if not exists grant_days int,          -- null = permanent grant
  add column if not exists deleted_at timestamptz;

-- Partial index mirrors the soft-delete filter, matching tasks_user_active.
create index if not exists redeem_codes_cohort_active
  on public.redeem_codes (cohort) where deleted_at is null;


-- ── 2. SOFT DELETE on both tables ───────────────────────────
--
-- Neither table had one. A hard delete of a redeem_code_uses row would silently
-- restore a spent redemption — the composite PK is the only thing stopping a
-- second grant, so losing the row loses the lock.
alter table public.redeem_code_uses
  add column if not exists removed_at timestamptz;

do $$ begin
  drop trigger if exists no_hard_delete on public.redeem_codes;
  create trigger no_hard_delete before delete on public.redeem_codes
    for each row execute function public.prevent_hard_delete();

  drop trigger if exists no_hard_delete on public.redeem_code_uses;
  create trigger no_hard_delete before delete on public.redeem_code_uses
    for each row execute function public.prevent_hard_delete();
end $$;


-- ── 3. ATTEMPT LOG (brute-force limit) ──────────────────────
--
-- redeem-code had no server-side rate limit at all. supabase.js wraps the call
-- in rateLimited(), but that is client-side and a code worth dozens of
-- grants is worth scripting against directly. Mirrors beta_redeem_attempts
-- (schema_v5), which exists for exactly this reason on the beta path.
create table if not exists public.redeem_code_attempts (
  id         bigserial primary key,
  user_id    uuid references auth.users on delete cascade not null,
  code       text,                                -- what they tried, for forensics
  success    boolean not null,
  ip_hash    text,
  created_at timestamptz not null default now()
);
alter table public.redeem_code_attempts enable row level security;
-- No policies → service role only.

create index if not exists redeem_code_attempts_user_time
  on public.redeem_code_attempts (user_id, created_at desc);
create index if not exists redeem_code_attempts_ip_time
  on public.redeem_code_attempts (ip_hash, created_at desc);


-- ── 4. THE IMPORTANT ONE — atomic redemption ────────────────
--
-- Everything the edge function used to do in TypeScript, done in one
-- transaction under a row lock.
--
-- Returns jsonb with either {ok:true, ...} or {error:'<reason>'} rather than
-- raising, following apply_referral_code() — a bad code is an expected outcome
-- the client renders as copy, not an exception.
create or replace function public.redeem_cohort_code(p_uid uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code    public.redeem_codes%rowtype;
  v_expires timestamptz;
begin
  if p_uid is null then
    return jsonb_build_object('error', 'no_user');
  end if;

  -- FOR UPDATE is the whole point of doing this in SQL. Without the lock, two
  -- concurrent redemptions of a code with one seat left both pass the
  -- max_uses check and both grant.
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
  if v_code.max_uses is not null and v_code.uses >= v_code.max_uses then
    return jsonb_build_object('error', 'code_exhausted');
  end if;
  if not v_code.grants_pro then
    return jsonb_build_object('error', 'code_grants_nothing');
  end if;

  -- The composite PK is the anti-double-grant lock. Catch the violation rather
  -- than pre-checking, so a race between the check and the insert cannot slip
  -- a second redemption through.
  begin
    insert into public.redeem_code_uses (code, user_id) values (v_code.code, p_uid);
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
        -- NEVER shorten an existing grant. null (permanent) wins outright,
        -- otherwise the later date does. grant_pro() overwrites expires_at
        -- unconditionally, so without this a study participant holding a
        -- permanent grant who redeemed any dated code afterwards would
        -- silently lose their non-expiring access.
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

-- p_uid is a PARAMETER, so anyone able to call this could grant Pro to any user
-- id they like. Definer functions are executable by PUBLIC unless revoked, so
-- this revoke is load-bearing, not hygiene. Service role only — the edge
-- function passes the uid it got from a verified JWT.
revoke all on function public.redeem_cohort_code(uuid, text) from public, anon, authenticated;


-- ── 5. COHORT REPORTING ─────────────────────────────────────
--
-- Counts from redeem_code_uses rather than redeem_codes.uses. The denormalized
-- counter is what the pre-v16 read-modify-write could undercount, so the two
-- can legitimately disagree on codes that were live before this shipped; the
-- use rows are the truth.
create or replace function public.cohort_report(p_cohort text default null)
returns table (
  cohort         text,
  code           text,
  max_uses       int,
  redeemed       bigint,
  first_redeemed timestamptz,
  last_redeemed  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.cohort,
    c.code,
    c.max_uses,
    count(u.user_id)      as redeemed,
    min(u.redeemed_at)    as first_redeemed,
    max(u.redeemed_at)    as last_redeemed
  from public.redeem_codes c
  left join public.redeem_code_uses u
    on u.code = c.code and u.removed_at is null
  where c.deleted_at is null
    and c.cohort is not null
    and (p_cohort is null or c.cohort = p_cohort)
  group by c.cohort, c.code, c.max_uses
  order by c.cohort, c.code;
$$;

revoke all on function public.cohort_report(text) from public, anon, authenticated;


-- ── 6. Verify ───────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='redeem_codes' and column_name='cohort')
    then raise exception 'redeem_codes.cohort missing'; end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='redeem_codes' and column_name='grant_days')
    then raise exception 'redeem_codes.grant_days missing'; end if;
  if not exists (select 1 from pg_proc where proname='redeem_cohort_code')
    then raise exception 'redeem_cohort_code() missing'; end if;
  if not exists (select 1 from pg_proc where proname='cohort_report')
    then raise exception 'cohort_report() missing'; end if;
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='redeem_code_attempts')
    then raise exception 'redeem_code_attempts table missing'; end if;
  if not exists (select 1 from pg_proc where proname='has_own_entitlement')
    then raise exception 'has_own_entitlement() missing — run schema_v9_payments.sql first'; end if;
end $$;

notify pgrst, 'reload schema';

select 'schema_v16_cohort_codes applied — '
       || count(*) filter (where cohort is not null)::text || ' cohort codes' as status
from public.redeem_codes;

-- ────────────────────────────────────────────────────────────
-- CREATE / MANAGE COHORT CODES  (run as needed in the SQL editor)
-- ────────────────────────────────────────────────────────────
-- Use real entropy in cohort codes. A guessable one like 'DILANFRIEND' is fine
-- for friends; a code that grants free access to dozens of people is worth
-- brute-forcing, and the edge function's rate limit is the only other thing in
-- the way.
--
-- The JHU study — 45 teens plus 5 spare (50 seats), 50 days of access from the moment each
-- participant redeems, code open for the recruitment window:
--   insert into public.redeem_codes (code, cohort, max_uses, grant_days, expires_at, note)
--   values ('<generate one>', 'jhu-wellbeing-2026', 50, 50,
--           now() + interval '120 days', 'JHU teen study — 50 days')
--   on conflict (code) do update
--     set cohort = excluded.cohort, max_uses = excluded.max_uses,
--         grant_days = excluded.grant_days, expires_at = excluded.expires_at,
--         active = true;
--
-- grant_days counts from REDEMPTION, not from when the code was created, so a
-- participant who joins late still gets their full 50 days. Access lapses on
-- its own — has_own_entitlement() checks pro_overrides.expires_at, so there is
-- no cleanup job to run and nothing to remember to switch off.
--
-- A cohort with permanent access instead (grant_days left null):
--   insert into public.redeem_codes (code, cohort, max_uses, note)
--   values ('<generate one>', 'acme-pilot-2026', 40, 'Acme pilot — permanent');
--
-- Extend a cohort that has already redeemed, if the study runs long. This
-- moves everyone on that code, including people already past their 50 days:
--   update public.pro_overrides set expires_at = expires_at + interval '30 days'
--   where granted_by = 'redeem:<the code>';
--
-- How many redeemed, for the research team:
--   select * from public.cohort_report('jhu-wellbeing-2026');
--
-- Every cohort at once:
--   select * from public.cohort_report();
--
-- Who redeemed, with when:
--   select c.cohort, u.user_id, u.redeemed_at
--   from public.redeem_code_uses u
--   join public.redeem_codes c on c.code = u.code
--   where c.cohort = 'jhu-wellbeing-2026' and u.removed_at is null
--   order by u.redeemed_at;
--
-- Close a cohort to new redemptions (existing grants survive):
--   update public.redeem_codes set active = false where cohort = 'jhu-wellbeing-2026';
--
-- Retire a code entirely (soft):
--   update public.redeem_codes set deleted_at = now() where code = 'JHU-7K2M-QX41';
