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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Matched by name so a duplicate-recurring-instance rejection is distinguishable
// from any other 23505 (e.g. a primary-key retry), which means something else.
const RECURRING_UNIQUE_INDEX = "tasks_one_instance_per_template_per_day";

// ── TASKS ────────────────────────────────────────────────────
// Boot/hydrate reads default to a BOUNDED window (last year, capped row count)
// so a multi-year power user's launch fetch stays O(recent) instead of pulling
// their entire task history every time. This is what keeps per-user payloads
// flat as both the user base (100 → 10k → 100k) and each user's history grow.
// Pass { sinceDate: null } to explicitly opt out and fetch all-time.
const DEFAULT_TASK_WINDOW_DAYS = 365;
const DEFAULT_TASK_LIMIT = 1000;

function windowStartDate(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function fetchTasks(userId, { sinceDate, limit = DEFAULT_TASK_LIMIT } = {}) {
  if (!userId) return [];
  // sinceDate === null  → caller explicitly wants all-time (no lower bound).
  // sinceDate undefined → apply the default bounded window.
  const since = sinceDate === null ? null : (sinceDate || windowStartDate(DEFAULT_TASK_WINDOW_DAYS));
  return cached(`tasks_${userId}_${since || "all"}_${limit}`, TTL.tasks, async () => {
    let q = supabase
      .from("tasks")
      .select("*")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (since) q = q.gte("task_date", since);
    const { data, error } = await q;
    if (error) { console.warn("fetchTasks:", error.message); return []; }
    if (data && data.length === limit) {
      // Not silent: surface that we stopped at the cap so history gaps are
      // explainable rather than mysterious.
      console.warn(`fetchTasks: reached the ${limit}-row cap for ${userId}; older tasks beyond the window were not loaded.`);
    }
    return (data || []).map(rowToTask);
  });
}

export async function insertTask(userId, task) {
  if (!userId) return null;
  const row = {
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
    // Persist the recurring template link server-side. It used to be client-only,
    // which meant "one instance per template per day" was enforced only by local
    // state that didn't survive a round-trip — the app re-materialized every
    // recurring task on every launch. The unique index
    // tasks_one_instance_per_template_per_day now enforces it in the database.
    recurring_template_id: task.recurringTemplateId || null,
  };
  if (UUID_RE.test(String(task.id || ""))) row.id = task.id;
  const { data, error } = await rateLimited(`insert_task_${userId}`, { limit: 30, windowMs: 60_000 }, () =>
    supabase.from("tasks").insert(row).select().single()
  );
  if (error) {
    // The unique index rejected this row: an instance of this template already
    // exists for this day (including a soft-deleted one, which is how
    // delete-for-the-day stays deleted). Not a failure — the invariant held.
    // Report it so the caller can drop its optimistic local copy.
    if (error.code === "23505" && String(error.message || "").includes(RECURRING_UNIQUE_INDEX)) {
      return { duplicate: true };
    }
    console.warn("insertTask:", error.message);
    return null;
  }
  invalidateCache(`tasks_${userId}`);
  return rowToTask(data);
}

// Patch an already-inserted task with its finalized AI-assigned credits/xp.
// Used by the async create flow: the task is inserted instantly with provisional
// credits, then updated here once the evaluator finishes.
export async function updateTaskCredits(userId, taskId, { credits, xp, reasoning, aiValued }) {
  if (!userId || !taskId) return;
  const patch = { credits, xp, ai_valued: !!aiValued };
  if (reasoning != null) patch.ai_reasoning = reasoning;
  const { error } = await rateLimited(`update_task_${userId}`, { limit: 60, windowMs: 60_000 }, () =>
    supabase.from("tasks").update(patch).eq("id", taskId).eq("user_id", userId)
  );
  if (error) console.warn("updateTaskCredits:", error.message);
  invalidateCache(`tasks_${userId}`);
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
    createdAt:   r.created_at,
    task_date:   r.task_date || (r.created_at ? r.created_at.slice(0, 10) : null),
    // Server-persisted as of schema_v5. NULL on rows created before that
    // migration; rehydrateClientFields still backfills those from the local
    // cache, so the two sources cover each other during the transition.
    recurringTemplateId: r.recurring_template_id || undefined,
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
// Offline-durable balance/XP sync.
//
// balance_seconds is the cross-launch source of truth. If a write fails
// (offline, transient error) we MUST NOT silently drop it — otherwise a stale
// server balance resurrects on the next launch. We persist the latest intended
// values to a local "pending" record and flush them on launch / foreground.
// Both fields are absolute + monotonic-by-max, so keeping only the newest
// pending value (not a delta queue) is correct.
const pendingKey = (userId) => `drift_pending_stats_${userId}`;

async function mergePendingStats(userId, fields) {
  try {
    const raw = await AsyncStorage.getItem(pendingKey(userId));
    const prev = raw ? JSON.parse(raw) : {};
    const next = { ...prev };
    // balance_seconds: newest write wins.
    if (typeof fields.balanceSeconds === "number") next.balanceSeconds = Math.max(0, fields.balanceSeconds);
    // total_xp: monotonic — keep the highest.
    if (typeof fields.totalXp === "number") next.totalXp = Math.max(Number(prev.totalXp || 0), Math.max(0, fields.totalXp));
    await AsyncStorage.setItem(pendingKey(userId), JSON.stringify(next));
  } catch {}
}

// Drop any QUEUED balance from the pending record (keeping pending XP). The
// daily reset calls this so a stale pre-reset balance from a failed offline
// sync yesterday can't be resurrected onto the server by a later
// flushPendingStats — which is exactly what caused "random screen time in the
// morning" after the balance was supposed to reset to 0.
export async function clearPendingBalance(userId) {
  if (!userId) return;
  try {
    const raw = await AsyncStorage.getItem(pendingKey(userId));
    if (!raw) return;
    const prev = JSON.parse(raw);
    delete prev.balanceSeconds;
    if (typeof prev.totalXp === "number") {
      await AsyncStorage.setItem(pendingKey(userId), JSON.stringify(prev));
    } else {
      await AsyncStorage.removeItem(pendingKey(userId));
    }
  } catch {}
}

async function writeProfileStats(userId, { totalXp, balanceSeconds }) {
  const patch = {};
  if (typeof totalXp === "number") {
    const { data } = await supabase
      .from("profiles")
      .select("total_xp")
      .eq("id", userId)
      .maybeSingle();
    patch.total_xp = Math.max(Number(data?.total_xp || 0), Math.max(0, totalXp));
  }
  if (typeof balanceSeconds === "number") patch.balance_seconds = Math.max(0, balanceSeconds);
  if (!Object.keys(patch).length) return { ok: true };
  const { error } = await rateLimited(`profile_stats_${userId}`, { limit: 60, windowMs: 60_000 }, () =>
    supabase.from("profiles").update(patch).eq("id", userId)
  );
  if (error) return { ok: false, error };
  invalidateCache(`profile_stats_${userId}`);
  return { ok: true };
}

export async function syncProfileStats(userId, { totalXp, balanceSeconds }) {
  if (!userId) return;
  let res;
  try {
    res = await writeProfileStats(userId, { totalXp, balanceSeconds });
  } catch (e) {
    res = { ok: false, error: e };
  }
  if (!res.ok) {
    console.warn("syncProfileStats (queued for retry):", res.error?.message || res.error);
    await mergePendingStats(userId, { totalXp, balanceSeconds });
  }
}

// Flush any balance/XP writes that failed while offline. Call on launch and
// whenever the app returns to the foreground / regains connectivity.
export async function flushPendingStats(userId) {
  if (!userId) return;
  let pending;
  try {
    const raw = await AsyncStorage.getItem(pendingKey(userId));
    if (!raw) return;
    pending = JSON.parse(raw);
  } catch { return; }
  if (!pending || (typeof pending.balanceSeconds !== "number" && typeof pending.totalXp !== "number")) {
    await AsyncStorage.removeItem(pendingKey(userId)).catch(() => {});
    return;
  }
  try {
    const res = await writeProfileStats(userId, pending);
    if (res.ok) await AsyncStorage.removeItem(pendingKey(userId)).catch(() => {});
  } catch {
    // still offline — leave the pending record in place for the next attempt.
  }
}

export async function fetchProfileStats(userId) {
  if (!userId) return { totalXp: 0, balanceSeconds: 0 };
  return cached(`profile_stats_${userId}`, 20_000, async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select("total_xp, balance_seconds")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      console.warn("fetchProfileStats:", error.message);
      return { totalXp: 0, balanceSeconds: 0 };
    }
    return {
      totalXp: Number(data?.total_xp || 0),
      balanceSeconds: Number(data?.balance_seconds || 0),
    };
  });
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

/**
 * Reconcile the user's entire blocklist in one batch.
 *
 * Replaces the old "await addBlockedApp/removeBlockedApp in a loop" pattern,
 * which fired ~2 sequential round-trips per app (slow & no way to show a
 * single coherent loading state). Here we diff once and collapse the work
 * into at most a handful of queries that run in parallel:
 *   - one lookup for existing rows among the apps being added
 *   - one bulk INSERT for brand-new apps
 *   - one bulk UPDATE to "re-add" soft-deleted apps
 *   - one bulk UPDATE to soft-remove apps no longer selected
 */
export async function syncBlockedApps(userId, apps) {
  if (!userId) return;
  const remote = await fetchBlockedApps(userId); // warm cache from modal open
  const remoteIds = new Set(remote.map(a => a.id));
  const localIds  = new Set(apps.map(a => a.id));
  const toAdd     = apps.filter(a => !remoteIds.has(a.id));
  const toRemove  = remote.filter(a => !localIds.has(a.id));
  if (!toAdd.length && !toRemove.length) return;

  await rateLimited(`blocked_write_${userId}`, { limit: 40, windowMs: 60_000 }, async () => {
    const nowIso = new Date().toISOString();

    // Resolve adds against any existing rows (including soft-deleted ones) so
    // re-adding clears removed_at instead of inserting a duplicate.
    let toInsert = toAdd;
    let reAddRowIds = [];
    if (toAdd.length) {
      const { data: existing } = await supabase
        .from("blocked_apps").select("id, app_id, removed_at")
        .eq("user_id", userId).in("app_id", toAdd.map(a => a.id));
      const existingByApp = new Map((existing || []).map(r => [r.app_id, r]));
      toInsert    = toAdd.filter(a => !existingByApp.has(a.id));
      reAddRowIds = toAdd
        .map(a => existingByApp.get(a.id))
        .filter(r => r && r.removed_at)
        .map(r => r.id);
    }

    const ops = [];
    if (toInsert.length) {
      ops.push(supabase.from("blocked_apps").insert(
        toInsert.map(a => ({ user_id: userId, app_id: a.id, app_name: a.name }))
      ));
    }
    if (reAddRowIds.length) {
      ops.push(supabase.from("blocked_apps")
        .update({ removed_at: null, added_at: nowIso })
        .in("id", reAddRowIds));
    }
    if (toRemove.length) {
      ops.push(supabase.from("blocked_apps")
        .update({ removed_at: nowIso })
        .eq("user_id", userId)
        .in("app_id", toRemove.map(a => a.id))
        .is("removed_at", null));
    }

    const results = await Promise.all(ops);
    const failed = results.find(r => r?.error);
    if (failed?.error) throw failed.error;
  });

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
