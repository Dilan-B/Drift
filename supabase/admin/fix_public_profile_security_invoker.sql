-- ────────────────────────────────────────────────────────────
-- Fix: "Security Definer View" lint on public.public_profile
--
-- A SECURITY DEFINER view runs with the VIEW OWNER's permissions/RLS
-- instead of the querying user's. That can silently bypass the RLS you
-- wrote on the underlying profiles table. Switching the view to
-- SECURITY INVOKER makes it evaluate the caller's permissions + RLS,
-- which is the intended Supabase model.
--
-- Postgres 15+ (Supabase) supports the security_invoker view option, so
-- we can fix this WITHOUT redefining the view's columns.
--
-- Idempotent. Safe to run multiple times. Run in the Supabase SQL Editor.
-- ────────────────────────────────────────────────────────────

-- 1. Flip the view to run as the querying user (respects their RLS).
alter view public.public_profile set (security_invoker = on);

-- 2. Verify: should report security_invoker=on.
do $$
declare opts text;
begin
  select array_to_string(c.reloptions, ', ')
    into opts
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'public_profile';

  raise notice 'public.public_profile reloptions: %', coalesce(opts, '(none)');
  if opts is null or opts not like '%security_invoker=%' then
    raise warning 'security_invoker not set — confirm the view name/schema.';
  end if;
end $$;

-- ────────────────────────────────────────────────────────────
-- AFTER RUNNING — confirm the caller-side access is still correct.
-- Because the view now uses the caller's RLS, make sure the role you
-- expose it to (anon and/or authenticated) is actually allowed to read
-- the columns it returns:
--
--   profiles currently has:  CREATE POLICY ... FOR SELECT USING (true)
--   so authenticated users can read all profile rows. If public_profile
--   is granted to `anon` but profiles has no anon SELECT policy, anon
--   queries will now correctly return ZERO rows (that's the point).
--
-- If you intend anon to read a public subset, add an explicit policy,
-- e.g. expose only non-sensitive columns and:
--   grant select on public.public_profile to anon, authenticated;
-- and ensure profiles has an RLS SELECT policy that permits it.
-- ────────────────────────────────────────────────────────────
