/**
 * sync.js
 * Read/write helpers that keep Supabase as the source of truth for user data.
 *
 * Pattern:
 *   - Write paths: optimistic local + fire-and-forget to Supabase.
 *   - Read paths: load from Supabase on app start, cache locally for offline.
 *   - "Delete" always means soft-delete (sets deleted_at / removed_at) so the
 *     backend retains the row for audit/recovery.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { cached, invalidateCache, rateLimited } from "./apiGuards";

const TTL = {
  tasks: 30_000,
  blockedApps: 60_000,
  ledger: 20_000,
};

// ── TASKS ────────────────────────────────────────────────────
export async function fetchTasks(userId, { sinceDate } = {}) {
  if (!userId) return [];
  return cached(`tasks_${userId}_${sinceDate || "all"}`, TTL.tasks, async () => {
    let q = supabase
      .from("tasks")
      .select("*")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (sinceDate) q = q.gte("task_date", sinceDate);
    const { data, error } = await q;
    if (error) { console.warn("fetchTasks:", error.message); return []; }
    return (data || []).map(rowToTask);
  });
}

export async function insertTask(userId, task) {
  if (!userId) return null;
  const row = {
    id:           task.id,
    user_id:      userId,
    title:        task.title,
    category:     task.cat,
    minutes:      task.minutes,
    credits:      task.credits,
    xp:           task.xp,
    done:         !!task.done,
    ai_check:     !!task.aiCheck,
    ai_valued:    !!task.aiValued,
    ai_reasoning: task.aiReasoning || null,
    task_date:    task.task_date || todayDateStr(),
  };
  const { data, error } = await rateLimited(`insert_task_${userId}`, { limit: 30, windowMs: 60_000 }, () =>
    supabase.from("tasks").insert(row).select().single()
  );
  if (error) { console.warn("insertTask:", error.message); return null; }
  invalidateCache(`tasks_${userId}`);
  return rowToTask(data);
}

export async function completeTaskRow(userId, taskId) {
  if (!userId || !taskId) return;
  const { error } = await rateLimited(`complete_task_${userId}`, { limit: 60, windowMs: 60_000 }, () =>
    supabase
      .from("tasks")
      .update({ done: true, completed_at: new Date().toISOString() })
      .eq("id", taskId)
      .eq("user_id", userId)
  );
  if (error) console.warn("completeTaskRow:", error.message);
  invalidateCache(`tasks_${userId}`);
}

// SOFT delete — never .delete()
export async function softDeleteTask(userId, taskId) {
  if (!userId || !taskId) return;
  const { error } = await rateLimited(`delete_task_${userId}`, { limit: 30, windowMs: 60_000 }, () =>
    supabase
      .from("tasks")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", taskId)
      .eq("user_id", userId)
  );
  if (error) console.warn("softDeleteTask:", error.message);
  invalidateCache(`tasks_${userId}`);
}

function rowToTask(r) {
  return {
    id:          r.id,
    title:       r.title,
    cat:         r.category,
    minutes:     r.minutes,
    credits:     r.credits,
    xp:          r.xp,
    done:        r.done,
    aiCheck:     r.ai_check,
    aiValued:    r.ai_valued,
    aiReasoning: r.ai_reasoning,
    completedAt: r.completed_at,
    completedDate: r.completed_at ? r.completed_at.slice(0, 10) : null,
    task_date:   r.task_date,
  };
}

const todayDateStr = () => new Date().toISOString().slice(0, 10);


// ── CREDIT LEDGER (append-only) ──────────────────────────────
export async function appendLedgerEntry(userId, { delta, reason, refId, balanceAfter }) {
  if (!userId || !delta) return;
  const { error } = await rateLimited(`ledger_${userId}`, { limit: 80, windowMs: 60_000 }, () =>
    supabase.from("credit_ledger").insert({
      user_id:       userId,
      delta,
      reason,
      ref_id:        refId || null,
      balance_after: balanceAfter ?? null,
    })
  );
  if (error) console.warn("appendLedgerEntry:", error.message);
  invalidateCache(`ledger_${userId}`);
}

/** Sum all ledger entries for the user — authoritative balance. */
export async function fetchBalanceFromLedger(userId) {
  if (!userId) return 0;
  return cached(`ledger_${userId}`, TTL.ledger, async () => {
    const { data, error } = await supabase
      .from("credit_ledger").select("delta").eq("user_id", userId);
    if (error) { console.warn("fetchBalanceFromLedger:", error.message); return 0; }
    return (data || []).reduce((s, r) => s + (r.delta || 0), 0);
  });
}


// ── XP / PROFILE STATE ───────────────────────────────────────
export async function syncProfileStats(userId, { totalXp, balanceSeconds }) {
  if (!userId) return;
  const patch = {};
  if (typeof totalXp === "number")        patch.total_xp        = Math.max(0, totalXp);
  if (typeof balanceSeconds === "number") patch.balance_seconds = Math.max(0, balanceSeconds);
  if (!Object.keys(patch).length) return;
  const { error } = await rateLimited(`profile_stats_${userId}`, { limit: 60, windowMs: 60_000 }, () =>
    supabase.from("profiles").update(patch).eq("id", userId)
  );
  if (error) console.warn("syncProfileStats:", error.message);
}


// ── BLOCKED APPS ─────────────────────────────────────────────
export async function fetchBlockedApps(userId) {
  if (!userId) return [];
  return cached(`blocked_${userId}`, TTL.blockedApps, async () => {
    const { data, error } = await supabase
      .from("blocked_apps")
      .select("*").eq("user_id", userId).is("removed_at", null)
      .order("added_at", { ascending: false });
    if (error) { console.warn("fetchBlockedApps:", error.message); return []; }
    return (data || []).map(r => ({ id: r.app_id, name: r.app_name }));
  });
}

export async function addBlockedApp(userId, app) {
  if (!userId || !app?.id) return;
  await rateLimited(`blocked_write_${userId}`, { limit: 40, windowMs: 60_000 }, async () => {
  // Upsert: if a soft-deleted row exists, "re-add" by clearing removed_at.
  const { data: existing } = await supabase
    .from("blocked_apps").select("id, removed_at")
    .eq("user_id", userId).eq("app_id", app.id).limit(1).maybeSingle();
  if (existing) {
    if (existing.removed_at) {
      await supabase.from("blocked_apps")
        .update({ removed_at: null, added_at: new Date().toISOString() })
        .eq("id", existing.id);
    }
    return;
  }
  await supabase.from("blocked_apps").insert({
    user_id: userId, app_id: app.id, app_name: app.name,
  });
  });
  invalidateCache(`blocked_${userId}`);
}

export async function removeBlockedApp(userId, appId) {
  if (!userId || !appId) return;
  await rateLimited(`blocked_write_${userId}`, { limit: 40, windowMs: 60_000 }, () =>
    supabase.from("blocked_apps")
      .update({ removed_at: new Date().toISOString() })
      .eq("user_id", userId).eq("app_id", appId).is("removed_at", null)
  );
  invalidateCache(`blocked_${userId}`);
}


// ── LOCAL CACHE (for offline + faster boot) ──────────────────
const CACHE_KEYS = {
  tasks:        (uid) => `drift_cache_tasks_${uid}`,
  totalXp:      (uid) => `drift_cache_xp_${uid}`,
  blockedApps:  (uid) => `drift_cache_blocked_${uid}`,
};

export const cache = {
  saveTasks:        (uid, arr)  => AsyncStorage.setItem(CACHE_KEYS.tasks(uid), JSON.stringify(arr || [])),
  loadTasks:        async (uid) => JSON.parse((await AsyncStorage.getItem(CACHE_KEYS.tasks(uid))) || "[]"),
  saveXp:           (uid, n)    => AsyncStorage.setItem(CACHE_KEYS.totalXp(uid), String(n || 0)),
  loadXp:           async (uid) => Number((await AsyncStorage.getItem(CACHE_KEYS.totalXp(uid))) || 0),
  saveBlocked:      (uid, arr)  => AsyncStorage.setItem(CACHE_KEYS.blockedApps(uid), JSON.stringify(arr || [])),
  loadBlocked:      async (uid) => JSON.parse((await AsyncStorage.getItem(CACHE_KEYS.blockedApps(uid))) || "[]"),
};
