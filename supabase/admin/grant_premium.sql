-- ────────────────────────────────────────────────────────────
-- Drift admin: dev account management
-- Run in Supabase SQL Editor (private dashboard).
--
-- This file does THREE things:
--   1. Creates a `dev_emails` table — the list of email addresses
--      that always get Pro access regardless of subscription status.
--   2. Adds a database function `is_dev_user(uid)` so edge functions
--      can check dev status server-side.
--   3. Lets you grant/revoke dev access for any email with a single
--      line — see the bottom of this file.
-- ────────────────────────────────────────────────────────────

-- 1. Dev emails table (server-side allowlist)
create table if not exists public.dev_emails (
  email      text primary key,
  note       text,
  created_at timestamptz default now()
);

-- Lock it down — no client ever reads or writes this table
alter table public.dev_emails enable row level security;
-- (no policies = no rows visible to anon/authenticated clients)

-- 2. Helper function — server-only check
create or replace function public.is_dev_user(uid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from auth.users u
    join public.dev_emails d on lower(u.email) = lower(d.email)
    where u.id = uid
  );
$$;

-- 3. Auto-grant Pro to dev users
-- When `is_dev_user` is true, treat the user as subscribed.
-- This is enforced by the edge functions (see verify-task / evaluate-task).

-- ────────────────────────────────────────────────────────────
-- ADD A DEV ACCOUNT
-- Just insert the email here. Username stays auto-generated so it's
-- indistinguishable from any other user.
-- ────────────────────────────────────────────────────────────

-- ⚠ This file is gitignored (see .gitignore) and runs only against your
-- private Supabase project. Replace the placeholder below with your real
-- dev email locally before running. Do NOT commit a populated version.
--
-- insert into public.dev_emails (email, note) values
--   ('your-dev-email@example.com', 'Founder / primary dev')
-- on conflict (email) do update set note = excluded.note;

-- Add more dev emails like this:
-- insert into public.dev_emails (email, note) values
--   ('newdev@example.com', 'Beta tester'),
--   ('qa@example.com',     'QA automation')
-- on conflict (email) do update set note = excluded.note;

-- ────────────────────────────────────────────────────────────
-- REVOKE
-- delete from public.dev_emails where email = 'someone@example.com';
-- ────────────────────────────────────────────────────────────

-- Verify current dev list:
select * from public.dev_emails order by created_at desc;
