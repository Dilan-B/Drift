-- ────────────────────────────────────────────────────────────
-- schema_v16_cohort_codes.sql
--
-- Applied via `supabase db push`. Mirrors
-- supabase/admin/schema_v16_cohort_codes.sql minus its trailing verification
-- block, status SELECT, and SQL-editor runbook (those are for a human in the
-- editor, not for a migration).
--
-- Cohort-scoped redemption codes: a code belongs to a named cohort and grants
-- access for a per-code duration, including permanently. Grants land in
-- pro_overrides so has_own_entitlement() picks them up with no change to
-- entitlement resolution.
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
-- in rateLimited(), but that is client-side and a code worth 250 permanent
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

notify pgrst, 'reload schema';
