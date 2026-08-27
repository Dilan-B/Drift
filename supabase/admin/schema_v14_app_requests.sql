-- ────────────────────────────────────────────────────────────
-- Drift schema v14 — Child app-access requests
--
-- Two ways a child's blocked apps get managed:
--   1. Parent allow-list (schema_v13, family_members.app_policy.allow) — the
--      parent decides from their own device.
--   2. THIS: a child asks for a specific app to be allowed. The request lands in
--      app_requests; the parent approves/denies (resolve-app-request edge fn),
--      and on approval the app is added to that child's allow-list.
--
-- Also adds app_policy.mode ('categories' | 'custom') — 'custom' means the child
-- device uses the native app picker (see screenTime.js; needs the native build).
--
-- DEPENDS ON schema_v13_family.sql. Idempotent. Run in the Supabase SQL editor.
-- ────────────────────────────────────────────────────────────

-- Ensure the verified-email helper exists (normally from schema_v6). Defined
-- here (create-or-replace, so it's a no-op if v6 already ran) so this migration
-- runs standalone even on a database where v6 was never applied.
create or replace function public.current_user_email_confirmed()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
  );
$$;
grant execute on function public.current_user_email_confirmed() to authenticated;

-- Parent PIN (hashed) — gates the native app picker on the child's device so a
-- kid can't change which apps are blocked. SERVICE-ROLE ONLY (no RLS policies),
-- like pro_overrides, so the child can never read the hash. The family-pin edge
-- function sets/verifies it.
create table if not exists public.family_pins (
  family_id  uuid primary key references public.families on delete cascade,
  pin_hash   text not null,
  updated_at timestamptz not null default now()
);
alter table public.family_pins enable row level security;
-- No policies → only the service role can read/write.

create table if not exists public.app_requests (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families on delete cascade,
  child_id    uuid not null references auth.users on delete cascade,
  app_label   text not null,                    -- the app the kid is asking about
  kind        text not null default 'allow' check (kind in ('allow', 'block')),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  removed_at  timestamptz                        -- soft delete
);
alter table public.app_requests enable row level security;
grant select, insert on public.app_requests to authenticated;

create index if not exists app_requests_family_pending
  on public.app_requests (family_id, status) where removed_at is null;
create index if not exists app_requests_child
  on public.app_requests (child_id) where removed_at is null;

-- RLS: a child creates + reads their own requests; a parent reads their kids'
-- requests. Resolving (status change) is service-role only via the edge function.
do $$ begin
  drop policy if exists "app_requests: child insert" on public.app_requests;
  drop policy if exists "app_requests: child read" on public.app_requests;
  drop policy if exists "app_requests: parent read" on public.app_requests;
end $$;

create policy "app_requests: child insert" on public.app_requests
  for insert with check (
    auth.uid() = child_id and public.current_user_email_confirmed()
  );
create policy "app_requests: child read" on public.app_requests
  for select using (auth.uid() = child_id);
create policy "app_requests: parent read" on public.app_requests
  for select using (public.is_parent_of(child_id));

-- No-hard-delete guard for the new table.
do $$ begin
  drop trigger if exists no_hard_delete on public.app_requests;
  create trigger no_hard_delete before delete on public.app_requests
    for each row execute function public.prevent_hard_delete();
end $$;

-- Realtime so the parent sees a request the instant it's made, and the child
-- sees the parent's decision — no refresh.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_requests'
  ) then
    alter publication supabase_realtime add table public.app_requests;
  end if;
end $$;

-- Verify.
do $$ begin
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='app_requests')
    then raise exception 'app_requests table missing'; end if;
end $$;

select 'schema_v14_app_requests applied — '
  || (select count(*) from public.app_requests)::text || ' requests' as status;
