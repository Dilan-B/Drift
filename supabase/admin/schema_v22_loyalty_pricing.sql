-- ────────────────────────────────────────────────────────────
-- Drift schema v22 — Loyalty pricing (monthly Pro gets cheaper the longer
-- you stay)
--
-- Drift Pro monthly starts at $4.99. Every 2 months of UNBROKEN paid
-- subscription the price steps down 50¢, to a floor of $2.99:
--
--     months paid   0–1    2–3    4–5    6–7    8+
--     price        4.99   4.49   3.99   3.49   2.99
--     tier           0      1      2      3      4
--
-- Unsubscribing (turning auto-renew off) or lapsing resets it: a resubscriber
-- starts again at $4.99.
--
-- ── How the price actually changes ──────────────────────────────────────────
-- Apple does not let an app change one subscriber's price. The two ways to
-- charge a long-standing customer less are a cheaper product in the same
-- subscription group, or a PROMOTIONAL OFFER on the existing product. A
-- cheaper product would be listed in iOS Settings > Subscriptions for anyone
-- to switch to on day one, so this uses promotional offers, which only the
-- app can present. They are configured in App Store Connect on
-- com.drift.pro.month (pay as you go, monthly):
--
--     loyalty_449  $4.49 × 2 months      loyalty_349  $3.49 × 2 months
--     loyalty_399  $3.99 × 2 months      loyalty_299  $2.99 × 12 months
--
-- The subscriber confirms each step with one tap on Apple's sheet (Apple's
-- rule, not ours), and it takes effect at their next renewal. The app offers
-- the step when they become eligible (loyaltyPricing.js).
-- RevenueCat signs the offer, which needs the In-App Purchase subscription
-- key uploaded in its dashboard.
--
-- ── What this file adds ─────────────────────────────────────────────────────
--   profiles.sub_paid_since  start of the current unbroken PAID run (trial
--                            days don't count). Written only by the
--                            revenuecat-webhook through apply_sub_paid_since(),
--                            guarded like every other subscription column.
--   my_loyalty_pricing()     the caller's tier, for the app.
--   app_config.loyalty_pricing = 'false'   the switch. Nothing is offered
--                            until it is 'true' AND the offers exist in App
--                            Store Connect — the app checks both.
--
-- DEPENDS ON schema_v9_payments.sql (guard trigger), schema_v11_app_config.sql.
-- Idempotent. Run in the Supabase SQL Editor.
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

-- Verify
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'profiles'
                    and column_name = 'sub_paid_since')
    then raise exception 'sub_paid_since missing'; end if;
  if not exists (select 1 from public.app_config where key = 'loyalty_pricing')
    then raise exception 'loyalty_pricing row missing'; end if;
end $$;

select count(*) filter (where sub_paid_since is not null) as paying_runs_tracked,
       count(*) filter (where sub_active) as active_subs
  from public.profiles;

-- ────────────────────────────────────────────────────────────
-- TURN IT ON, once the four offers exist on com.drift.pro.month in App Store
-- Connect and the subscription key is uploaded to RevenueCat:
--   update public.app_config set value = 'true', updated_at = now()
--   where key = 'loyalty_pricing';
--
-- Who is on which step:
--   select least(4, ((date_part('year', age(now(), sub_paid_since)) * 12
--                   + date_part('month', age(now(), sub_paid_since)))::int) / 2) as tier,
--          count(*)
--     from public.profiles where sub_paid_since is not null group by 1 order by 1;
-- ────────────────────────────────────────────────────────────
