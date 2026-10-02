-- schema_v20_grant_revival.sql
--
-- redeem_cohort_code() must not revive a revoked grant.
--
-- Its upsert keeps the longer of the old and new expiry, with null (permanent)
-- winning outright, and keeps the larger seat count. That rule was written to
-- protect a grant the user still holds. But revoke_pro() only sets granted =
-- false and leaves expires_at null, so a user whose permanent grant had been
-- revoked who then redeemed any dated code (a 30-day promo) came back
-- PERMANENT, with whatever child seats the revoked grant carried.
--
-- Now an existing row only counts when it is live: granted and not past its
-- expiry. Otherwise the new code's terms apply as if there were no row.
-- Everything else in the function is unchanged from schema_v19, and
-- CREATE OR REPLACE keeps v16's service-role-only grants.
--
-- DEPENDS ON schema_v19_family_seats.sql. Idempotent.

create or replace function public.redeem_cohort_code(p_uid uuid, p_code text, p_participant_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  insert into public.pro_overrides (user_id, granted, note, expires_at, granted_at, granted_by, seats)
  values (
    p_uid, true,
    coalesce(v_code.cohort, v_code.note),
    v_expires, now(), 'redeem:' || v_code.code,
    coalesce(v_code.grant_seats, 0)
  )
  on conflict (user_id) do update
    set granted    = true,
        -- "Never shorten / never shrink" protects a grant the user still
        -- HOLDS. A revoked (granted = false) or lapsed row is not one: it used
        -- to keep its null expiry, so redeeming any 30-day code after a revoke
        -- quietly handed back permanent access (and the old child seats).
        seats      = case
          when public.pro_overrides.granted
               and (public.pro_overrides.expires_at is null
                    or public.pro_overrides.expires_at > now())
            then greatest(public.pro_overrides.seats, excluded.seats)
          else excluded.seats
        end,
        expires_at = case
          when not public.pro_overrides.granted
               or public.pro_overrides.expires_at <= now()  then excluded.expires_at
          when public.pro_overrides.expires_at is null      then null
          when excluded.expires_at is null                  then null
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
end $function$;

-- ── Verify ───────────────────────────────────────────────────
select 'schema_v20_grant_revival applied' as status
where exists (select 1 from pg_proc where proname = 'redeem_cohort_code'
              and prosrc like '%not public.pro_overrides.granted%');
