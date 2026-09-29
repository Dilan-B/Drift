-- ────────────────────────────────────────────────────────────
-- schema_v19_family_seats.sql
--
-- Family seats come only from what was actually bought (or granted).
--
-- THE HOLE THIS CLOSES
-- families.seats defaulted to 1, and revenuecat-webhook only wrote seats for a
-- family product (or a revoke). So every family started with a free child
-- seat that nothing ever took away: a parent on the $4.99 solo plan — or
-- unlocked by any code or grant — covered one child for free, $3 under the
-- $7.99 one-kid family plan.
--
-- NOW
--   * families.seats defaults to 0. The webhook writes the purchased product's
--     seat count on EVERY event (0 for solo products), not only family ones.
--   * Grants can cover children explicitly: pro_overrides.seats, filled from
--     redeem_codes.grant_seats when a code is redeemed. A code or grant that
--     doesn't say so covers the parent only.
--   * public.family_seats(family) = the larger of the paid seats and the
--     parent's live grant seats. is_pro() and join-family both use it, so
--     there is one definition of "how many children this family covers".
--   * join-family refuses when that is 0, instead of letting a child join a
--     family that covers nobody.
--
-- BACKFILL: seats are recomputed from each parent's stored RevenueCat product
-- (only an active drift_family_N counts). Before zeroing, any seat a family
-- was relying on through a live grant is moved onto that grant, so no child
-- currently covered by a grant loses access.
--
-- Safe to re-run. Applied as supabase/migrations/20260929000001_family_seats.sql.
-- ────────────────────────────────────────────────────────────

alter table public.pro_overrides
  add column if not exists seats int not null default 0;
comment on column public.pro_overrides.seats is
  'Child seats this grant covers for a parent (0 = the parent only). Filled from redeem_codes.grant_seats on redemption, or set by hand.';

alter table public.redeem_codes
  add column if not exists grant_seats int not null default 0;
comment on column public.redeem_codes.grant_seats is
  'Child seats each redemption of this code covers (0 = the redeemer only).';

alter table public.families alter column seats set default 0;

-- The one definition of how many children a family covers.
create or replace function public.family_seats(p_family uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    coalesce(f.seats, 0),
    coalesce((
      select o.seats from public.pro_overrides o
      where o.user_id = f.parent_id
        and o.granted
        and (o.expires_at is null or o.expires_at > now())
    ), 0)
  )
  from public.families f
  where f.id = p_family;
$$;
revoke all on function public.family_seats(uuid) from public, anon, authenticated;
grant execute on function public.family_seats(uuid) to service_role;

create or replace function public.is_pro(p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    public.has_own_entitlement(p_uid)
    -- Child: entitled through the parent, if the parent is paying AND this
    -- child is within the seats they bought.
    --
    -- "Within seats" is by join order (joined_at, then id to break ties), so
    -- it is deterministic and stable: adding a fourth child to a three-seat
    -- plan locks out the NEW child, never one who was already using the app.
    -- Downgrading a plan does the same thing from the other end.
    or coalesce((
      select
        public.has_own_entitlement(f.parent_id)
        and (
          select count(*)
          from public.family_members m2
          where m2.family_id = f.id
            and m2.role = 'child'
            and m2.removed_at is null
            and (m2.joined_at, m2.id) <= (m.joined_at, m.id)
        ) <= public.family_seats(f.id)
      from public.family_members m
      join public.families f on f.id = m.family_id
      where m.user_id = p_uid
        and m.role = 'child'
        and m.removed_at is null
        and f.deleted_at is null
      limit 1
    ), false);
$function$;

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
        -- Never shrink the child seats an earlier grant gave.
        seats      = greatest(public.pro_overrides.seats, excluded.seats),
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
end $function$;

-- ── Backfill ─────────────────────────────────────────────────
-- 1. Keep any grant-covered seat on the grant itself.
update public.pro_overrides o
   set seats = greatest(o.seats, f.seats)
  from public.families f
 where f.parent_id = o.user_id
   and f.deleted_at is null
   and o.granted
   and (o.expires_at is null or o.expires_at > now());

-- 2. Paid seats from the stored product. The guard trigger only lets the
--    service role touch seats; a migration runs as the owner, so it is lifted
--    for exactly this statement.
alter table public.families disable trigger families_guard_seats_trg;
update public.families f
   set seats = case
     when p.sub_active and p.rc_product_id ~ '^drift_family_[0-9]+$'
       then least(20, substring(p.rc_product_id from '[0-9]+$')::int)
     else 0
   end
  from public.profiles p
 where p.id = f.parent_id;
alter table public.families enable trigger families_guard_seats_trg;

-- ── Verify (SQL editor) ───────────────────────────────────────
-- select f.id, f.seats, public.family_seats(f.id) as effective,
--        (select count(*) from public.family_members m
--          where m.family_id = f.id and m.role = 'child' and m.removed_at is null) as kids
--   from public.families f where f.deleted_at is null;
