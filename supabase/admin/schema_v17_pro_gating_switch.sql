-- ────────────────────────────────────────────────────────────
-- Drift schema v17 — Server-side Pro gating switch
--
-- verify-task and evaluate-task always computed whether the caller was Pro,
-- then threw the answer away: the 402 was commented out "until Apple IAP is
-- re-enabled post-approval". IAP is live, so the gate now exists again — but
-- behind this row rather than a code change, because turning it on alters the
-- product for every existing user and should not need a deploy to reverse.
--
--   'true'  → callers without an entitlement get 402 subscription_required
--   anything else, or no row → no enforcement (the behaviour until now)
--
-- Entitlement itself is unchanged: is_pro() / has_own_entitlement(), which
-- already counts subscriptions, pro_overrides grants (including cohort codes),
-- beta unlocks and children under a paying parent.
--
-- Seeded OFF. on conflict do nothing, so re-running this never undoes a switch
-- someone has already flipped.
--
-- DEPENDS ON schema_v11_app_config.sql.
-- Idempotent. Run in the Supabase SQL Editor.
-- ────────────────────────────────────────────────────────────

insert into public.app_config (key, value)
values ('enforce_pro_gating', 'false')
on conflict (key) do nothing;

-- Verify
do $$
begin
  if not exists (select 1 from public.app_config where key = 'enforce_pro_gating')
    then raise exception 'enforce_pro_gating row missing'; end if;
end $$;

select key, value, updated_at from public.app_config where key = 'enforce_pro_gating';

-- ────────────────────────────────────────────────────────────
-- TURN GATING ON. Takes effect within ~60s: each function instance caches the
-- switch for a minute.
--   update public.app_config set value = 'true', updated_at = now()
--   where key = 'enforce_pro_gating';
--
-- Turn it back off:
--   update public.app_config set value = 'false', updated_at = now()
--   where key = 'enforce_pro_gating';
--
-- Before turning it on, it is worth knowing who it would affect — every user
-- with no subscription, grant, beta unlock or paying parent:
--   select count(*) from auth.users u where not public.is_pro(u.id);
-- ────────────────────────────────────────────────────────────
