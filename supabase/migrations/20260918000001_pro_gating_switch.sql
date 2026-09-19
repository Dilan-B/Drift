-- ────────────────────────────────────────────────────────────
-- schema_v17_pro_gating_switch.sql
--
-- Applied via `supabase db push`. Mirrors
-- supabase/admin/schema_v17_pro_gating_switch.sql minus its verification
-- block, status SELECT and runbook.
--
-- Seeds app_config.enforce_pro_gating = 'false'. verify-task and evaluate-task
-- return 402 to unentitled callers only when it is 'true'.
-- ────────────────────────────────────────────────────────────

insert into public.app_config (key, value)
values ('enforce_pro_gating', 'false')
on conflict (key) do nothing;
