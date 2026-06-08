# Drift — Data Model & Persistence Policy

## Source of truth

**Supabase Postgres is the source of truth for every piece of user data.**
AsyncStorage on the device is purely a cache for offline boot and as a fallback when the network is slow.

## No-hard-delete policy

Every user-data table has a **soft-delete column** (`deleted_at`, `removed_at`, or `cancelled_at`). To enforce this:

- **A `prevent_hard_delete()` trigger** is attached to every user-data table. Any `.delete()` call from the client raises an exception with a clear message.
- **No `DELETE` RLS policies** exist on these tables, so even if a future engineer removes the trigger, the database will still reject delete attempts at the policy layer.
- The credit ledger has **no UPDATE or DELETE policy at all** — it's strictly append-only.

## Tables

| Table | Soft-delete column | Notes |
|---|---|---|
| `profiles` | `deleted_at` | Adds `total_xp`, `balance_seconds` for fast reads |
| `tasks` | `deleted_at` | Per-user task list with `task_date` for daily filtering |
| `credit_ledger` | (append-only, no delete) | Records every credit change with `delta`, `reason`, `ref_id` |
| `blocked_apps` | `removed_at` | Per-user blocklist; re-adding clears `removed_at` |
| `friendships` | `removed_at` + `status='removed'` | Status is `pending`/`accepted`/`declined`/`removed` |
| `challenges` | `cancelled_at` + `status='cancelled'` | Cancelled challenges are kept for audit |
| `screen_time` | `deleted_at` | Daily aggregates |
| `ai_check_usage` | (append-only) | Rate-limiting log |
| `trial_ip_log` | (append-only) | Anti-abuse log (hashed IPs only) |

## Write paths

| User action | Client behavior | Server effect |
|---|---|---|
| Add task | Optimistic local insert | `INSERT INTO tasks` |
| Complete task | Optimistic local update | `UPDATE tasks SET done=true, completed_at=now()` + `INSERT INTO credit_ledger` + `UPDATE profiles SET total_xp, balance_seconds` |
| Delete task | Remove from visible list | `UPDATE tasks SET deleted_at=now()` (NOT delete) |
| Add blocked app | Cache write | `INSERT INTO blocked_apps` or clear `removed_at` if existed |
| Remove blocked app | Cache write | `UPDATE blocked_apps SET removed_at=now()` |
| Cancel challenge | Remove from visible list | `UPDATE challenges SET status='cancelled', cancelled_at=now()` |
| Earn credits | Optimistic local | `INSERT INTO credit_ledger (delta>0, reason='task_complete')` |
| Spend credits | Optimistic local | `INSERT INTO credit_ledger (delta<0, reason='spend')` |

## Read paths

On app boot, for each authenticated user we:
1. Load cached state from AsyncStorage **first** (so UI is instant)
2. Fetch fresh state from Supabase
3. Replace cache with fetched results

This means a user reinstalling the app or signing in on a new device gets **all their data back** — tasks, completed history, blocked apps, XP, the works.

## Recovery / audit

Because we never hard-delete anything:
- Accidentally deleted a task? Run `UPDATE tasks SET deleted_at = NULL WHERE id = ?`.
- Need to audit credit anomalies? Sum `credit_ledger` deltas — should always equal current balance.
- Disputed challenge cancellation? The row still exists with `cancelled_at` and original status history.
- Compromised account? Roll back specific writes by inspecting timestamps.

## Migration

Run **once** in Supabase SQL Editor:

```
supabase/admin/schema_v3_data_persistence.sql
```

This is fully idempotent — safe to re-run anytime.

## What still lives in AsyncStorage (cache only)

- `drift_cache_tasks_{uid}` — last-known task list
- `drift_cache_xp_{uid}` — last-known XP
- `drift_cache_blocked_{uid}` — last-known blocked apps
- `drift_v4` — legacy aggregate cache (transitional; will be deprecated)
- `drift_username`, `drift_dark_mode`, `drift_onboarded` — UI preferences only (no user data)

None of these are authoritative. If you lose your phone, you lose nothing.
