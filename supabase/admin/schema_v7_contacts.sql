-- ────────────────────────────────────────────────────────────
-- Drift schema v7 — Contact matching (privacy-safe)
--
-- Stores a SHA-256 hash of each user's email so the `match-contacts` edge
-- function can tell which of a caller's contacts are on Drift WITHOUT anyone's
-- raw email being exposed. The table is service-role-only (no client RLS
-- policies), so one user can never read another's email hash — column-level
-- privacy that a column on `profiles` (which clients can read) couldn't give.
--
-- Idempotent. Run in the Supabase SQL Editor.
-- ────────────────────────────────────────────────────────────

create extension if not exists pgcrypto with schema extensions;

-- ── 1. Hash store (service-role only) ────────────────────────
create table if not exists public.email_hashes (
  user_id       uuid primary key references auth.users on delete cascade,
  email_sha256  text not null,
  updated_at    timestamptz not null default now()
);
alter table public.email_hashes enable row level security;
-- No policies → only the service role (edge functions) can read/write.

create index if not exists email_hashes_sha on public.email_hashes (email_sha256);

-- ── 2. Keep the hash in sync with auth.users.email ───────────
create or replace function public.sync_email_hash()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.email is not null then
    insert into public.email_hashes (user_id, email_sha256, updated_at)
    values (new.id, encode(extensions.digest(lower(trim(new.email)), 'sha256'), 'hex'), now())
    on conflict (user_id) do update
      set email_sha256 = excluded.email_sha256, updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_email_hash on auth.users;
create trigger trg_sync_email_hash
  after insert or update of email on auth.users
  for each row execute function public.sync_email_hash();

-- ── 3. Backfill existing users ───────────────────────────────
insert into public.email_hashes (user_id, email_sha256)
select id, encode(extensions.digest(lower(trim(email)), 'sha256'), 'hex')
from auth.users
where email is not null
on conflict (user_id) do update
  set email_sha256 = excluded.email_sha256, updated_at = now();

-- ── 4. Verify ────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='email_hashes')
    then raise exception 'email_hashes table missing'; end if;
  if not exists (select 1 from pg_trigger where tgname='trg_sync_email_hash')
    then raise exception 'trg_sync_email_hash trigger missing'; end if;
end $$;

select 'schema_v7_contacts applied — ' || count(*)::text || ' hashes' as status
from public.email_hashes;
