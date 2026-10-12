-- ────────────────────────────────────────────────────────────
-- schema_v21_free_tier.sql
--
-- Applied via `supabase db push`. Mirrors
-- supabase/admin/schema_v21_free_tier.sql minus its verification block,
-- status SELECT and runbook.
--
-- Seeds app_config.free_daily_tasks = '3': how many approved AI checks a
-- non-Pro caller gets per local day from verify-task before 402 free_limit.
-- ────────────────────────────────────────────────────────────

insert into public.app_config (key, value)
values ('free_daily_tasks', '3')
on conflict (key) do nothing;
