-- ============================================================================
-- schema_v9_payments.sql
--
-- Paste into the Supabase SQL editor and run top-to-bottom. Safe to re-run.
--
-- Brings paid Pro back: $4.99/month or $29.99/year with a 7-day free trial,
-- no free tier. Prices live in App Store Connect; nothing here depends on them.
--
-- WHY EACH PIECE EXISTS
-- ---------------------
--
-- 1. THE PAYWALL IS CURRENTLY ONE HTTP REQUEST FROM BEING BYPASSED.
--
--    profiles.sub_active is the flag every AI edge function gates on, and
--    profiles has an own-row UPDATE policy (that is how XP and balance sync).
--    So any signed-in user can run
--
--      PATCH /rest/v1/profiles?id=eq.<their id>  {"sub_active": true}
--
--    and hand themselves a subscription. Nothing today stops it. STEP 3 does.
--
-- 2. THE OLD WEBHOOK WROTE COLUMNS THAT DO NOT EXIST.
--
--    supabase/functions/revenuecat-webhook (deleted in 7b07d9e, restored now)
--    updated profiles.rc_entitlement_active / rc_expires_at / rc_period_type /
--    rc_product_id / rc_last_event_at. None of those columns were ever created,
--    so every webhook delivery would have failed the UPDATE and returned 500 —
--    and RevenueCat would have retried forever while entitlements never landed.
--    Worse, the AI functions gate on sub_active, which the webhook never
--    touched, so even a successful write would not have granted anything.
--
--    Fixed by making the webhook write sub_active/sub_expires (the columns that
--    are actually read) and keeping the rc_* columns alongside as diagnostics.
--
-- 3. RevenueCat retries. Without idempotency a retried EXPIRATION can land
--    after a renewal and revoke a paying customer. rc_webhook_events is the
--    dedupe ledger.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- STEP 1. Diagnostic columns for the RevenueCat state.
--
-- sub_active / sub_expires stay the canonical entitlement — everything already
-- reads them. These record WHY, so a support question ("am I on trial?", "when
-- does this lapse?") is answerable without opening the RevenueCat dashboard.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists rc_entitlement_active boolean,
  add column if not exists rc_period_type        text,
  add column if not exists rc_product_id         text,
  add column if not exists rc_expires_at         timestamptz,
  add column if not exists rc_last_event_at      timestamptz;

comment on column public.profiles.sub_active is
  'Canonical entitlement flag. Written ONLY by the revenuecat-webhook function under the service role; client writes are rejected by the trigger in STEP 3.';
comment on column public.profiles.rc_period_type is
  'RevenueCat period_type for the current entitlement: trial | intro | normal. "trial" means inside the 7-day free trial.';


-- ---------------------------------------------------------------------------
-- STEP 2. Webhook idempotency ledger.
--
-- RevenueCat retries on any non-2xx and can redeliver. Replaying an out-of-order
-- EXPIRATION after a RENEWAL would revoke someone who is paying, so every event
-- id is recorded once and repeats are dropped.
-- ---------------------------------------------------------------------------
create table if not exists public.rc_webhook_events (
  id            text primary key,
  app_user_id   text not null,
  type          text,
  product_id    text,
  period_type   text,
  expiration_at timestamptz,
  received_at   timestamptz not null default now()
);

alter table public.rc_webhook_events enable row level security;
-- No policies: service role only. Billing history is not the client's business.

create index if not exists rc_webhook_events_user_idx
  on public.rc_webhook_events (app_user_id, received_at desc);


-- ---------------------------------------------------------------------------
-- STEP 3. THE IMPORTANT ONE — stop the client writing its own entitlement.
--
-- Mirrors the tasks guard from schema_v6/v8. The service role (which is what
-- the webhook and the grant helper run as) passes through; everyone else is
-- rejected if they touch an entitlement column. Ordinary profile updates —
-- username, avatar, total_xp, balance_seconds — are untouched.
-- ---------------------------------------------------------------------------
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
     or new.rc_last_event_at     is distinct from old.rc_last_event_at then
    raise exception
      'subscription columns are set by the payment webhook only'
      using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists profiles_guard_entitlement_columns_trg on public.profiles;
create trigger profiles_guard_entitlement_columns_trg
  before update on public.profiles
  for each row
  execute function public.profiles_guard_entitlement_columns();


-- ---------------------------------------------------------------------------
-- STEP 4. Manual Pro grants — "give any user we want the Pro version".
--
-- pro_overrides already exists with (user_id, granted, note). Adding an
-- optional expiry so a grant can be a loan rather than a gift — useful for
-- press, trials for a specific person, and win-backs.
--
-- The table is deliberately separate from profiles for the same reason as
-- STEP 3: a column on profiles would be self-writable.
-- ---------------------------------------------------------------------------
alter table public.pro_overrides
  add column if not exists expires_at timestamptz,
  add column if not exists granted_at timestamptz not null default now(),
  add column if not exists granted_by text;

comment on column public.pro_overrides.expires_at is
  'NULL = permanent. Otherwise the grant stops counting at this instant; the client re-checks on every foreground.';
comment on column public.pro_overrides.granted_by is
  'Who issued the grant, free text. Fill it in — an unexplained comp is impossible to audit later.';

-- grant_pro() below uses ON CONFLICT (user_id), which requires a unique index
-- on that column. It is almost certainly the primary key already, but a
-- re-grant would fail with 42P10 if it is not, so make it explicit.
create unique index if not exists pro_overrides_user_id_key
  on public.pro_overrides (user_id);

alter table public.pro_overrides enable row level security;

-- The user may read their OWN grant (the client needs it to unlock) and nothing
-- else. No insert/update/delete policy exists, so only the service role writes.
drop policy if exists pro_overrides_select_own on public.pro_overrides;
create policy pro_overrides_select_own
  on public.pro_overrides for select
  using (user_id = auth.uid());


-- ---------------------------------------------------------------------------
-- STEP 5. The grant helper.
--
-- Grant by EMAIL, because that is what you will actually have when someone asks
-- — nobody hands you a UUID. Runs as definer so it can read auth.users, and is
-- revoked from the client roles below so it can only be called from the SQL
-- editor or by the service role.
--
--   select public.grant_pro('someone@example.com', 'press - The Verge', null);
--   select public.grant_pro('tester@example.com', 'beta', now() + interval '90 days');
--   select public.revoke_pro('someone@example.com');
--
-- Returns a human-readable result rather than raising, so a typo in an email
-- tells you what happened instead of aborting a batch.
-- ---------------------------------------------------------------------------
create or replace function public.grant_pro(
  p_email      text,
  p_note       text default null,
  p_expires_at timestamptz default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_uid is null then
    return format('no user with email %s', p_email);
  end if;

  insert into public.pro_overrides (user_id, granted, note, expires_at, granted_at, granted_by)
  values (v_uid, true, p_note, p_expires_at, now(), coalesce(current_setting('request.jwt.claim.email', true), 'sql_editor'))
  on conflict (user_id) do update
    set granted    = true,
        note       = coalesce(excluded.note, public.pro_overrides.note),
        expires_at = excluded.expires_at,
        granted_at = now(),
        granted_by = excluded.granted_by;

  return format('granted pro to %s (%s)%s', p_email, v_uid,
                case when p_expires_at is null then ' — permanent'
                     else ' until ' || p_expires_at::text end);
end $$;

create or replace function public.revoke_pro(p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_uid is null then
    return format('no user with email %s', p_email);
  end if;

  -- Soft: flip the flag rather than deleting the row, so the audit trail of who
  -- was comped and why survives. Consistent with the no-hard-delete rule.
  update public.pro_overrides set granted = false where user_id = v_uid;
  if not found then
    return format('%s had no grant', p_email);
  end if;
  return format('revoked pro for %s', p_email);
end $$;

-- Definer functions are executable by PUBLIC unless revoked. Without this,
-- any signed-in user could call grant_pro() with their own email and comp
-- themselves — which would undo STEP 3 entirely.
revoke all on function public.grant_pro(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.revoke_pro(text)                   from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- STEP 6. Family seats.
--
-- Children never pay. The PARENT buys a seat per child, and picks how many
-- children they are paying for when they set the family up.
--
-- `seats` is what they bought. It is set from the purchased product tier by the
-- webhook, never by the client — otherwise a parent could type "9" and get
-- eight free children.
--
-- IMPORTANT APP STORE CONSTRAINT, recorded here because it drives the whole
-- design: an auto-renewable subscription CANNOT use StoreKit quantity. Quantity
-- is consumables only. So "per child" has to be modelled as separate products
-- at tiered price points inside ONE subscription group:
--
--     drift_family_1 .. drift_family_5   (1..5 children)
--
-- Apple then handles upgrade, downgrade and proration between tiers for free,
-- because they share a group. A parent adding a child is a plan change, not a
-- second purchase.
-- ---------------------------------------------------------------------------
alter table public.families
  add column if not exists seats integer not null default 1;

comment on column public.families.seats is
  'Number of children the parent has paid for. Set from the purchased product tier by revenuecat-webhook under the service role. Children beyond this count are not entitled.';

-- Same reasoning as the profiles guard: families.parent_id = auth.uid() means a
-- parent can update their own family row, so without this they could simply
-- PATCH seats to 99.
create or replace function public.families_guard_seats()
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
  if new.seats is distinct from old.seats then
    raise exception 'family seats are set by the payment webhook only'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists families_guard_seats_trg on public.families;
create trigger families_guard_seats_trg
  before update on public.families
  for each row execute function public.families_guard_seats();


-- ---------------------------------------------------------------------------
-- STEP 7. One place to ask "is this user Pro?".
--
-- Three sources were being OR'd by hand in four different edge functions, which
-- is exactly how they drift apart. Now four, once children are included, which
-- makes doing it by hand worse still.
--
-- Split in two deliberately:
--   has_own_entitlement() answers "did THIS account pay / get comped"
--   is_pro()              adds "or is this a child of someone who did"
--
-- The split is what stops a cycle: a child resolves to its parent's OWN
-- entitlement, never back through is_pro(), so malformed data (a family whose
-- parent is somehow also a child) cannot recurse forever.
-- ---------------------------------------------------------------------------
create or replace function public.has_own_entitlement(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((
      select p.sub_active and (p.sub_expires is null or p.sub_expires > now())
      from public.profiles p where p.id = p_uid
    ), false)
    or coalesce((
      select o.granted and (o.expires_at is null or o.expires_at > now())
      from public.pro_overrides o where o.user_id = p_uid
    ), false)
    or coalesce((
      select p.beta_unlocked_at is not null
      from public.profiles p where p.id = p_uid
    ), false);
$$;

create or replace function public.is_pro(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
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
        ) <= f.seats
      from public.family_members m
      join public.families f on f.id = m.family_id
      where m.user_id = p_uid
        and m.role = 'child'
        and m.removed_at is null
        and f.deleted_at is null
      limit 1
    ), false);
$$;

grant execute on function public.is_pro(uuid)              to authenticated, service_role;
grant execute on function public.has_own_entitlement(uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- STEP 8. Reload the API schema. RUN THIS.
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
-- STEP 9. Verify.
-- ---------------------------------------------------------------------------
select column_name from information_schema.columns
where table_schema='public' and table_name='profiles'
  and column_name like 'rc\_%' order by column_name;

select tgname from pg_trigger
where tgrelid='public.profiles'::regclass
  and tgname='profiles_guard_entitlement_columns_trg';

select proname from pg_proc
where pronamespace='public'::regnamespace
  and proname in ('grant_pro','revoke_pro','is_pro','has_own_entitlement') order by proname;

select column_name from information_schema.columns
where table_schema='public' and table_name='families' and column_name='seats';


-- ---------------------------------------------------------------------------
-- STEP 10. Confirm the paywall actually holds.
--
-- Run as an ordinary signed-in user (from the app, or with the anon key and a
-- real JWT) — NOT here, the SQL editor is superuser and will sail through.
-- Expect: 42501, 'subscription columns are set by the payment webhook only'.
--
--   update public.profiles set sub_active = true where id = auth.uid();
-- ---------------------------------------------------------------------------
