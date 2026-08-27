-- ────────────────────────────────────────────────────────────
-- Drift schema v10 — Custom Pro redemption codes
--
-- Lets you hand out your OWN codes (e.g. "DILANFRIEND") that grant free Pro.
-- The redeem-code edge function validates a code and writes pro_overrides
-- (so it rides on the same override the app already reads). Both tables are
-- service-role only — clients never read or write them directly.
--
-- DEPENDS ON schema_v8_pro_override.sql (pro_overrides table). Run that first.
-- Idempotent. Run in the Supabase SQL Editor.
-- ────────────────────────────────────────────────────────────

-- 1. The codes themselves.
create table if not exists public.redeem_codes (
  code        text primary key,                  -- store UPPERCASE
  grants_pro  boolean     not null default true,
  max_uses    int,                               -- null = unlimited
  uses        int         not null default 0,
  expires_at  timestamptz,                       -- null = never expires
  active      boolean     not null default true,
  note        text,
  created_at  timestamptz not null default now()
);
alter table public.redeem_codes enable row level security;
-- No policies → only the service role (edge function) can touch it.

-- 2. One redemption per user per code (PK doubles as the anti-double-grant lock).
create table if not exists public.redeem_code_uses (
  code        text        not null,
  user_id     uuid        not null references auth.users on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (code, user_id)
);
alter table public.redeem_code_uses enable row level security;
-- No policies → service role only.

-- 3. Verify
do $$
begin
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='redeem_codes')
    then raise exception 'redeem_codes table missing'; end if;
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='pro_overrides')
    then raise exception 'pro_overrides missing — run schema_v8_pro_override.sql first'; end if;
end $$;

select 'schema_v10_redeem_codes applied — ' || count(*)::text || ' codes' as status
from public.redeem_codes;

-- ────────────────────────────────────────────────────────────
-- CREATE / MANAGE CODES  (run as needed in the SQL editor)
-- ────────────────────────────────────────────────────────────
-- A reusable code, 50 redemptions, no expiry:
--   insert into public.redeem_codes (code, max_uses, note) values
--     ('DILANFRIEND', 50, 'friends & family')
--   on conflict (code) do update set max_uses = excluded.max_uses, active = true;
--
-- A single-use code that expires:
--   insert into public.redeem_codes (code, max_uses, expires_at, note) values
--     ('VIP-7XQ2', 1, now() + interval '30 days', 'press');
--
-- An unlimited code (max_uses left null):
--   insert into public.redeem_codes (code, note) values ('LAUNCH', 'launch promo');
--
-- Disable a code (keeps history):
--   update public.redeem_codes set active = false where code = 'DILANFRIEND';
--
-- See who redeemed what:
--   select * from public.redeem_code_uses order by redeemed_at desc;
