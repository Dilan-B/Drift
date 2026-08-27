-- ────────────────────────────────────────────────────────────
-- Drift schema v11 — Remote app config (force-update gate)
--
-- Public, non-sensitive key/value rows the client reads on launch. Used to
-- require a minimum app version (mandatory update) and to point the update
-- button at the App Store.
--
-- Idempotent. Run in the Supabase SQL Editor.
-- ────────────────────────────────────────────────────────────

create table if not exists public.app_config (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;

-- Read-only to everyone (anon + authenticated). Writes only via service role.
grant select on public.app_config to anon, authenticated;
drop policy if exists "read app config" on public.app_config;
create policy "read app config"
  on public.app_config for select
  using (true);

-- Seed / update the keys the client looks for:
--   min_ios_version  → installed versions older than this are force-updated
--   ios_store_url    → where the "Update now" button sends users
insert into public.app_config (key, value) values
  ('min_ios_version', '1.0.0'),
  ('ios_store_url',   'https://apps.apple.com/app/idYOUR_APP_ID')
on conflict (key) do update set value = excluded.value, updated_at = now();

select * from public.app_config;

-- ────────────────────────────────────────────────────────────
-- To FORCE an update later, bump the minimum (clients on older builds get the
-- blocking screen on next launch/foreground):
--   update public.app_config set value = '1.2.0', updated_at = now()
--   where key = 'min_ios_version';
-- Set the real store URL once the app is live:
--   update public.app_config set value = 'https://apps.apple.com/app/id123456789'
--   where key = 'ios_store_url';
-- ────────────────────────────────────────────────────────────
