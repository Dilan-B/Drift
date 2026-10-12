-- ────────────────────────────────────────────────────────────
-- schema_v22_loyalty_pricing.sql
--
-- Applied via `supabase db push`. Mirrors
-- supabase/admin/schema_v22_loyalty_pricing.sql minus its verification
-- block, status SELECT and runbook — read that file for the why.
--
-- Adds profiles.sub_paid_since (start of the current unbroken paid run, guarded
-- like the other subscription columns), apply_sub_paid_since() for the
-- RevenueCat webhook, my_loyalty_pricing() for the app, backfills current
-- subscribers from rc_webhook_events, and seeds app_config.loyalty_pricing =
-- 'false'.
-- ────────────────────────────────────────────────────────────

-- STEP 1. The column ---------------------------------------------------------
alter table public.profiles
  add column if not exists sub_paid_since timestamptz;

comment on column public.profiles.sub_paid_since is
  'Start of the current unbroken paid subscription (loyalty pricing, schema_v22). Null when not paying. Written only by revenuecat-webhook via apply_sub_paid_since().';

-- STEP 2. Guard it like the other subscription columns -------------------------
-- Same function as schema_v9 plus one line. A user who could write this could
-- give themselves $2.99 on day one.
create or replace function public.profiles_guard_entitlement_columns()
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

  if new.sub_active            is distinct from old.sub_active
     or new.sub_expires          is distinct from old.sub_expires
     or new.beta_unlocked_at     is distinct from old.beta_unlocked_at
     or new.rc_entitlement_active is distinct from old.rc_entitlement_active
     or new.rc_period_type       is distinct from old.rc_period_type
     or new.rc_product_id        is distinct from old.rc_product_id
     or new.rc_expires_at        is distinct from old.rc_expires_at
     or new.rc_last_event_at     is distinct from old.rc_last_event_at
     or new.sub_paid_since       is distinct from old.sub_paid_since then
    raise exception
      'subscription columns are set by the payment webhook only'
      using errcode = '42501';
  end if;

  return new;
end $$;

-- STEP 3. The webhook's writer --------------------------------------------------
-- Called after the entitlement update has landed (and passed its ordering
-- guard), so events arrive here in order.
--
--   reset to null   EXPIRATION, REFUND, SUBSCRIPTION_PAUSED (access ended), or
--                   CANCELLATION with reason UNSUBSCRIBE (they turned
--                   auto-renew off — "if they ever unsubscribe"). A billing
--                   failure is not unsubscribing: its CANCELLATION is ignored,
--                   and only the EXPIRATION after a failed grace period resets.
--   start if null   any event for an active, PAID period (period_type
--                   'normal'). Trial days are free, so they don't count toward
--                   the next step; the run starts at the first paid renewal.
--                   An UNCANCELLATION after an unsubscribe starts a new run.
create or replace function public.apply_sub_paid_since(
  p_uid uuid, p_type text, p_cancel_reason text, p_period_type text,
  p_active boolean, p_event_at timestamptz
) returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz;
begin
  if p_type in ('EXPIRATION', 'REFUND', 'SUBSCRIPTION_PAUSED')
     or (p_type = 'CANCELLATION' and upper(coalesce(p_cancel_reason, '')) = 'UNSUBSCRIBE') then
    update public.profiles set sub_paid_since = null where id = p_uid;
    return null;
  end if;

  if p_active and lower(coalesce(p_period_type, '')) = 'normal' then
    update public.profiles
       set sub_paid_since = coalesce(sub_paid_since, p_event_at)
     where id = p_uid
    returning sub_paid_since into v_since;
    return v_since;
  end if;

  select sub_paid_since into v_since from public.profiles where id = p_uid;
  return v_since;
end $$;

revoke all on function public.apply_sub_paid_since(uuid, text, text, text, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_sub_paid_since(uuid, text, text, text, boolean, timestamptz) to service_role;

-- STEP 4. The app's reader ------------------------------------------------------
-- Only the caller's own tier. The tier is computed from whole calendar months,
-- the same way the app labels it.
create or replace function public.my_loyalty_pricing()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'paid_since', p.sub_paid_since,
    'product', p.rc_product_id,
    'months', m.months,
    'tier', case when p.sub_paid_since is null then 0 else least(4, m.months / 2) end
  )
  from public.profiles p
  cross join lateral (
    select case when p.sub_paid_since is null then 0
                else (date_part('year',  age(now(), p.sub_paid_since)) * 12
                    + date_part('month', age(now(), p.sub_paid_since)))::int end as months
  ) m
  where p.id = auth.uid();
$$;

revoke all on function public.my_loyalty_pricing() from public, anon;
grant execute on function public.my_loyalty_pricing() to authenticated;

-- STEP 5. Backfill current subscribers ----------------------------------------
-- From the webhook ledger: the earliest PAID event since the user's last
-- access-ending event. Someone who has only been on a trial gets null and
-- starts on their first paid renewal, like everyone after them.
--
-- The guard trigger from STEP 2 rejects this write (a migration runs as
-- neither service_role), so it is switched off for exactly this statement —
-- the same approach schema_v19 takes for its seats backfill.
alter table public.profiles disable trigger profiles_guard_entitlement_columns_trg;

update public.profiles p
   set sub_paid_since = b.since
  from (
    select e.app_user_id::uuid as uid, min(e.received_at) as since
      from public.rc_webhook_events e
     where e.period_type = 'normal'
       and e.type in ('INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE')
       and e.app_user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and e.received_at > coalesce((
             select max(x.received_at) from public.rc_webhook_events x
              where x.app_user_id = e.app_user_id
                and x.type in ('EXPIRATION', 'REFUND', 'SUBSCRIPTION_PAUSED')
           ), '-infinity'::timestamptz)
     group by e.app_user_id
  ) b
 where p.id = b.uid
   and p.sub_active
   and p.sub_paid_since is null;

alter table public.profiles enable trigger profiles_guard_entitlement_columns_trg;

-- STEP 6. The switch (off) -----------------------------------------------------
insert into public.app_config (key, value)
values ('loyalty_pricing', 'false')
on conflict (key) do nothing;
