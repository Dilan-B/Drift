-- ────────────────────────────────────────────────────────────
-- Drift schema v21 — Free tier ("Seedling") daily task allowance
--
-- Drift had a hard paywall: no entitlement, no app. It now has a free tier for
-- personal accounts — up to 3 blocked apps, 3 photo-verified tasks a day, the
-- plant up to stage 3 (Sapling). Pro is everything past that, and Family stays
-- subscribe-to-start.
--
-- Entitlement itself is UNCHANGED. A free user is simply someone is_pro() says
-- no to; nothing here is a new entitlement source, so has_own_entitlement() is
-- untouched. What changes is what verify-task does with a "no": instead of
-- 402 subscription_required, it lets the caller through while their count of
-- APPROVED checks today is under this number, and returns 402 free_limit after.
--
-- The count comes from ai_check_usage (verified = true). Users can insert and
-- read their own rows there but cannot update or delete them, so the count can
-- only go up — nobody can buy back their allowance by deleting history.
--
-- Only applies while app_config.enforce_pro_gating = 'true' (schema_v17). With
-- gating off, everyone gets AI checks as before.
--
-- The client reads the same row to show "2 of 3 today", so changing it here
-- changes both. Seeded at 3; on conflict do nothing so a re-run never undoes a
-- value someone has tuned.
--
-- DEPENDS ON schema_v11_app_config.sql, schema_v17_pro_gating_switch.sql.
-- Idempotent. Run in the Supabase SQL Editor.
-- ────────────────────────────────────────────────────────────

insert into public.app_config (key, value)
values ('free_daily_tasks', '3')
on conflict (key) do nothing;

-- Verify
do $$
begin
  if not exists (select 1 from public.app_config where key = 'free_daily_tasks')
    then raise exception 'free_daily_tasks row missing'; end if;
end $$;

select key, value, updated_at from public.app_config
where key in ('free_daily_tasks', 'enforce_pro_gating');

-- ────────────────────────────────────────────────────────────
-- Change the allowance (takes effect within ~60s server-side; clients pick it
-- up on next launch):
--   update public.app_config set value = '5', updated_at = now()
--   where key = 'free_daily_tasks';
--
-- How many free users are hitting the limit:
--   select date_trunc('day', created_at) as day, count(distinct user_id)
--   from (
--     select user_id, created_at,
--            count(*) over (partition by user_id, date_trunc('day', created_at)) as n
--     from public.ai_check_usage
--     where verified = true and not public.is_pro(user_id)
--   ) t
--   where n >= 3 group by 1 order by 1 desc;
-- ────────────────────────────────────────────────────────────
