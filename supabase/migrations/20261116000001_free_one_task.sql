-- ────────────────────────────────────────────────────────────
-- schema_v25_free_one_task.sql
--
-- Applied via `supabase db push`. Mirrors
-- supabase/admin/schema_v25_free_one_task.sql minus its verification block
-- and status SELECT.
--
-- Free plan: app_config.free_daily_tasks 3 → 1 approved AI check per local day.
-- ────────────────────────────────────────────────────────────

insert into public.app_config (key, value)
values ('free_daily_tasks', '1')
on conflict (key) do update set value = excluded.value, updated_at = now();
