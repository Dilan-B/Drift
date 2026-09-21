-- ────────────────────────────────────────────────────────────
-- schema_v18_internal_dashboard.sql
--
-- public.internal_dashboard(p_real boolean) — every number on the internal
-- metrics page, as one jsonb document, in one round trip.
--
-- It exists so the hosted dashboard can ask ONE question over the wire. The
-- alternative, a web app issuing a dozen selects, would need broad table
-- access from the server; this needs exactly one grant and returns only
-- aggregates. No user id, email or task title leaves this function.
--
-- p_real = true drops our own and the test accounts. Six of them held 279 of
-- 549 tasks, which made every rate on the page a statement about us.
--
-- SECURITY: security definer and revoked from anon/authenticated, like every
-- other reporting function here (see v17 cohort_participants). Only the
-- service role may call it, and only from a server that holds that key.
--
-- Safe to re-run. Applied as supabase/migrations/20260921000001_internal_dashboard.sql.
-- ────────────────────────────────────────────────────────────

create or replace function public.internal_dashboard(p_real boolean default true)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
with
excl as (
  select id from auth.users
  where p_real and email ilike any(array[
    '%sanghani%','%dilan%','%ridilabs%','%getdriftapp%','%test%','%example.com'
  ])
),
u    as (select * from auth.users where id not in (select id from excl)),
live as (select t.* from public.tasks t
          where t.deleted_at is null and t.user_id in (select id from u)),
done as (select * from live where done),
ev   as (select e.* from public.analytics_events e where e.user_id in (select id from u)),
pf   as (select p.* from public.profiles p
          where p.deleted_at is null and p.id in (select id from u)),
first_task as (select user_id, min(created_at) as t0 from live group by user_id)
select json_build_object(
  'generated_at', now(),
  'excluded', (select count(*) from excl),
  'headline', (select json_build_object(
      'accounts',        (select count(*) from u),
      'tasks_created',   (select count(*) from live),
      'tasks_completed', (select count(*) from done),
      'focus_minutes',   (select coalesce(sum(minutes),0) from done),
      'earned_minutes',  (select coalesce(sum(credits),0) from done),
      'xp',              (select coalesce(sum(xp),0) from done),
      'doers',           (select count(distinct user_id) from done),
      'creators',        (select count(distinct user_id) from live),
      'median_task_min', (select percentile_cont(0.5) within group (order by minutes) from done),
      'ai_checked',      (select count(*) from done where ai_check),
      'photo_verified',  (select count(*) from done where verified_at is not null),
      'active_7',        (select count(distinct user_id) from live where created_at > now() - interval '7 days'),
      'active_30',       (select count(distinct user_id) from live where created_at > now() - interval '30 days'),
      'first_signup',    (select min(created_at)::date from u)
  )),
  -- Funnel. Each step counts USERS, and each is a subset of the one above it.
  'funnel', (select json_build_object(
      'signed_up',   (select count(*) from u),
      'onboarded',   (select count(distinct user_id) from public.onboarding_responses
                        where user_id in (select id from u)),
      'blocked',     (select count(distinct user_id) from ev where event_name = 'blocked_apps_selected'),
      'created',     (select count(distinct user_id) from live),
      'completed',   (select count(distinct user_id) from done),
      'repeat',      (select count(*) from (select user_id from done group by user_id having count(*) >= 5) q)
  )),
  -- 60-day series. generate_series so empty days are zeros and the chart shows
  -- the gaps instead of silently closing them up.
  'daily', (select coalesce(json_agg(row_to_json(d) order by d.day),'[]'::json) from (
      select g::date as day,
        (select count(*) from u where u.created_at::date = g::date) as signups,
        (select count(*) from live t where t.created_at::date = g::date) as created,
        (select count(*) from done t where t.completed_at::date = g::date) as completed,
        (select coalesce(sum(minutes),0) from done t where t.completed_at::date = g::date) as focus
      from generate_series(current_date - interval '59 days', current_date, interval '1 day') g
  ) d),
  'categories', (select coalesce(json_agg(row_to_json(c) order by c.created desc),'[]'::json) from (
      select coalesce(category,'uncategorised') as category,
             count(*) as created,
             count(*) filter (where done) as completed,
             coalesce(sum(minutes) filter (where done),0) as focus
      from live group by 1
  ) c),
  -- Retention measured from each user's FIRST task, not from signup: someone
  -- who installed and never started has nothing to retain.
  'retention', (select json_build_object(
      'cohort',  count(*),
      'd1',      count(*) filter (where exists (select 1 from live t where t.user_id=f.user_id and t.created_at >= f.t0 + interval '1 day')),
      'd7',      count(*) filter (where exists (select 1 from live t where t.user_id=f.user_id and t.created_at >= f.t0 + interval '7 days')),
      'd30',     count(*) filter (where exists (select 1 from live t where t.user_id=f.user_id and t.created_at >= f.t0 + interval '30 days'))
  ) from first_task f),
  'streaks', (select json_build_object(
      'on_streak', count(*) filter (where current_streak > 0),
      'best',      coalesce(max(longest_streak),0),
      'avg_best',  coalesce(round(avg(nullif(longest_streak,0)),1),0)
  ) from pf),
  -- sub_active alone is NOT a paying customer. Seven profiles still carry
  -- sub_active = true with a sub_expires from June and July, left over from
  -- the Stripe era that ended on 2026-06-18 and never cleared. The date test
  -- is what has_own_entitlement() uses, so it is what this has to use too.
  -- Trials are separated out because a trial is not revenue.
  'money', (select json_build_object(
      'paying',      (select count(*) from pf
                        where sub_active and (sub_expires is null or sub_expires > now())
                          and coalesce(rc_period_type,'') <> 'trial'),
      'trialing',    (select count(*) from pf
                        where sub_active and (sub_expires is null or sub_expires > now())
                          and rc_period_type = 'trial'),
      'stale_flags', (select count(*) from pf where sub_active and sub_expires <= now()),
      'overrides',   (select count(*) from public.pro_overrides
                        where granted and user_id in (select id from u)
                          and (expires_at is null or expires_at > now())),
      'redeemed',    (select count(*) from public.redeem_code_uses
                        where removed_at is null and user_id in (select id from u))
  )),
  -- Codes are inventory, not user data, so they are never filtered.
  'codes', (select coalesce(json_agg(row_to_json(k) order by k.cohort, k.code),'[]'::json) from (
      select c.code, c.cohort, c.uses, c.max_uses, c.grant_days, c.active,
             c.expires_at::date as open_until
      from public.redeem_codes c
      where c.deleted_at is null and c.active
      order by c.cohort, c.code
  ) k),
  'events', (select coalesce(json_agg(row_to_json(e) order by e.n desc),'[]'::json) from (
      select event_name, count(*) as n, count(distinct user_id) as users
      from ev group by 1
  ) e)
);

$fn$;

revoke all on function public.internal_dashboard(boolean) from public, anon, authenticated;

notify pgrst, 'reload schema';
