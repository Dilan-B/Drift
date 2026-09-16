-- ────────────────────────────────────────────────────────────
-- Drift schema v12 — force-update BY BUILD NUMBER
--
-- Why this exists
-- ───────────────
-- The force-update gate compared MARKETING versions only, in all three of its
-- forms: the App Store lookup, and app_config.min_ios_version. Every submission
-- inside one release shares a marketing version — builds 118 through 123 are
-- all "1.1.7" — so isVersionOutdated("1.1.7", "1.1.7") is false and a user on
-- build 118 was never asked to update to 123. That is the whole TestFlight and
-- staged-rollout population, i.e. exactly the people the gate exists for.
--
-- Apple's lookup API cannot fix this from the other side: it returns `version`
-- and exposes no build number at all, so the automatic check is structurally
-- incapable of telling two builds of one release apart. The minimum has to be
-- published by us, here.
--
-- The two keys
-- ────────────
--   min_ios_build          → integer. Installs with CFBundleVersion strictly
--                            below this are force-updated.
--   min_ios_build_version  → the marketing version min_ios_build APPLIES TO.
--                            The client ignores min_ios_build entirely unless
--                            this equals the installed version.
--
-- The pin is load-bearing, not decoration. An unscoped min_ios_build survives
-- the next release: leave it at 124 and the day 1.1.8 starts numbering its
-- builds from anything lower, every 1.1.8 install force-updates itself to a
-- version that does not exist. ForceUpdateModal has no dismiss, so that is a
-- total lockout — the same failure mode as the app.json-behind-App-Store
-- incident of 2026-07-29. Pinning means a stale row simply stops applying.
--
-- Both keys are read by the client through getAppConfig(); a missing,
-- unpinned or unparseable value fails OPEN (nobody is blocked).
--
-- Idempotent. Run in the Supabase SQL Editor.
-- ────────────────────────────────────────────────────────────

-- The table itself ships in schema_v11_app_config.sql. Recreated here only so
-- this file is safe to run standalone.
create table if not exists public.app_config (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;

grant select on public.app_config to anon, authenticated;
drop policy if exists "read app config" on public.app_config;
create policy "read app config"
  on public.app_config for select
  using (true);

-- Seeded INERT on purpose: build 0 blocks nobody, and the version pin is left
-- empty so the gate stays off until someone deliberately turns it on below.
insert into public.app_config (key, value) values
  ('min_ios_build',         '0'),
  ('min_ios_build_version', '')
on conflict (key) do nothing;

select key, value, updated_at from public.app_config order by key;

-- ────────────────────────────────────────────────────────────
-- To force everyone on 1.1.7 up to build 124, set BOTH keys. Setting only
-- min_ios_build does nothing — that is the safety, not a bug:
--
--   update public.app_config set value = '124', updated_at = now()
--   where key = 'min_ios_build';
--   update public.app_config set value = '1.1.7', updated_at = now()
--   where key = 'min_ios_build_version';
--
-- Check what is live before shipping a new marketing version, and clear the
-- pin when it no longer applies:
--
--   update public.app_config set value = '', updated_at = now()
--   where key = 'min_ios_build_version';
-- ────────────────────────────────────────────────────────────
