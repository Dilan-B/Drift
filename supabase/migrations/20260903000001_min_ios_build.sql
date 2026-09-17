-- Force-update by build number. See supabase/admin/schema_v12_min_build.sql
-- for why the version pin is required.
--
--   min_ios_build          → installs with CFBundleVersion below this update
--   min_ios_build_version  → the marketing version that minimum applies to;
--                            min_ios_build is ignored unless it matches
--
-- Seeded inert (build 0, no pin) so the gate stays off until set deliberately.

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

insert into public.app_config (key, value) values
  ('min_ios_build',         '0'),
  ('min_ios_build_version', '')
on conflict (key) do nothing;
