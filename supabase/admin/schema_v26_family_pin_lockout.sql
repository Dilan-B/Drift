-- ────────────────────────────────────────────────────────────
-- schema_v26_family_pin_lockout.sql
--
-- Brute-force protection for the parent PIN.
--
-- The family-pin edge function compared a guess against family_pins.pin_hash
-- with no attempt counter. The person guessing is the child, who already holds
-- a valid session, and a correct guess flips their own blocking mode
-- (family_members.app_policy.mode). A 4-digit PIN is 10,000 guesses, which a
-- script gets through in minutes.
--
-- Now: 5 wrong guesses lock the family's PIN. The first lock is 15 minutes,
-- and each lock after that doubles the wait, up to 24 hours. A correct PIN, or
-- the parent setting a new one, clears the counter. Past the first few locks
-- the rate is a handful of guesses a day, so the 10,000 space takes years.
--
-- The check runs in one function holding a row lock, for the same reason as
-- redeem_cohort_code (v16): two parallel guesses in TypeScript could both read
-- failed_count = 4 and both be allowed through.
--
-- SECURITY: security definer, revoked from anon/authenticated. It trusts its
-- arguments, so only the service role (the edge function, after checking the
-- caller belongs to the family) may call it.
--
-- DEPENDS ON schema_v14_app_requests.sql. Safe to re-run.
-- Applied as supabase/migrations/20261119000001_family_pin_lockout.sql.
-- ────────────────────────────────────────────────────────────

alter table public.family_pins
  add column if not exists failed_count int not null default 0,
  add column if not exists lockouts     int not null default 0,
  add column if not exists locked_until timestamptz;

comment on column public.family_pins.failed_count is
  'Wrong guesses since the last correct PIN or lock. Reset to 0 when a lock starts.';
comment on column public.family_pins.lockouts is
  'Locks since the last correct PIN. Each one doubles the next lock (15 min base, 24 h cap).';
comment on column public.family_pins.locked_until is
  'While in the future, every guess is refused without being compared.';

create or replace function public.check_family_pin(p_family_id uuid, p_candidate text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  max_fails constant int := 5;
  r         public.family_pins%rowtype;
  v_until   timestamptz;
begin
  select * into r from public.family_pins where family_id = p_family_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_pin');
  end if;

  -- Refuse outright while locked. The guess is not compared, so a lock cannot
  -- be used to test PINs for free.
  if r.locked_until is not null and r.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', r.locked_until);
  end if;

  if r.pin_hash = p_candidate then
    update public.family_pins
       set failed_count = 0, lockouts = 0, locked_until = null
     where family_id = p_family_id;
    return jsonb_build_object('ok', true);
  end if;

  if r.failed_count + 1 >= max_fails then
    v_until := now() + least(interval '15 minutes' * power(2, least(r.lockouts, 10)),
                             interval '24 hours');
    update public.family_pins
       set failed_count = 0, lockouts = least(r.lockouts + 1, 20), locked_until = v_until
     where family_id = p_family_id;
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', v_until);
  end if;

  update public.family_pins
     set failed_count = r.failed_count + 1
   where family_id = p_family_id;
  return jsonb_build_object('ok', false, 'reason', 'wrong_pin',
                            'attempts_left', max_fails - (r.failed_count + 1));
end;
$fn$;

revoke all on function public.check_family_pin(uuid, text) from public, anon, authenticated;
grant execute on function public.check_family_pin(uuid, text) to service_role;

-- Verify.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'family_pins'
      and column_name in ('failed_count', 'lockouts', 'locked_until')) as new_columns_expect_3,
  (select count(*) from pg_proc where proname = 'check_family_pin') as fn_expect_1;
