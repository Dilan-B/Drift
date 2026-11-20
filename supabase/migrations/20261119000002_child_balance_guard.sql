-- ────────────────────────────────────────────────────────────
-- schema_v27_child_balance_guard.sql
--
-- A child cannot give themselves screen time.
--
-- 1. grant_screen_time() and parent_owns_child() (schema_v13) are security
--    definer and were never revoked. Postgres grants EXECUTE on a new function
--    to PUBLIC, so any signed-in user, a child included, could call
--      rpc('grant_screen_time', { child_uid: <self>, secs: 999999, ... })
--    over PostgREST and mint any balance, with a ledger row that says
--    'parent_grant'. Only the service role (approve-child-task and the other
--    family edge functions) calls them. Revoke from everyone else, the same
--    as redeem_cohort_code (v16) and internal_dashboard (v18).
--
-- 2. profiles.balance_seconds is self-writable: the app syncs its drain there
--    (syncProfileStats). For a child that meant writing any number. Now a
--    child's own write may lower their balance (drain, daily reset) but not
--    raise it. Raises come from grant_screen_time, which runs as the function
--    owner, not as 'authenticated', so it is unaffected.
--
--    The raise is clamped (the old value kept) rather than raised as an error.
--    The same UPDATE carries streak and XP, and failing it whole would make a
--    stale client lose its other stats over a balance it was never entitled
--    to set.
--
--    Personal accounts keep a self-writable balance. That is their own time
--    and their own phone; a cap there would need the client's earn paths
--    reconciled against credit_ledger first.
--
-- DEPENDS ON schema_v13_family.sql. Safe to re-run.
-- Applied as supabase/migrations/20261119000002_child_balance_guard.sql.
-- ────────────────────────────────────────────────────────────

revoke all on function public.grant_screen_time(uuid, int, int, uuid) from public, anon, authenticated;
grant execute on function public.grant_screen_time(uuid, int, int, uuid) to service_role;

revoke all on function public.parent_owns_child(uuid, uuid) from public, anon, authenticated;
grant execute on function public.parent_owns_child(uuid, uuid) to service_role;

-- SECURITY INVOKER on purpose: current_user must be the caller's role.
-- Directly from the app that is 'authenticated'. Inside grant_screen_time
-- (security definer) it is the function owner, and for edge functions it is
-- 'service_role'; neither is clamped.
create or replace function public.profiles_child_balance_guard()
returns trigger
language plpgsql
as $fn$
begin
  if current_user = 'authenticated'
     and new.account_type = 'child'
     and coalesce(new.balance_seconds, 0) > coalesce(old.balance_seconds, 0) then
    new.balance_seconds := old.balance_seconds;
  end if;
  return new;
end;
$fn$;

drop trigger if exists profiles_child_balance_guard_trg on public.profiles;
create trigger profiles_child_balance_guard_trg
  before update of balance_seconds on public.profiles
  for each row
  execute function public.profiles_child_balance_guard();

