/**
 * family.js
 * Client helpers for the family-accounts feature. All cross-account writes live
 * server-side in edge functions (join-family, assign-child-task, ...); this file
 * just calls them and reads family rows the caller is allowed to see under RLS.
 */
import { supabase } from "./supabase";
import { rateLimited } from "./apiGuards";

// Normalize a typed family code the same way the server does.
export function normalizeFamilyCode(raw) {
  return (raw || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 32);
}

/**
 * Child join: no email/password. Sends { family_code, child_name } to the
 * join-family edge function, then establishes the returned session on this
 * device so the child is signed in (and stays signed in across restarts).
 * Returns { ok, user?, username?, displayName?, reason? }.
 */
export async function joinFamily(familyCode, childName) {
  const code = normalizeFamilyCode(familyCode);
  const name = (childName || "").trim().slice(0, 40);
  if (!code) return { ok: false, reason: "invalid_code" };
  if (!name) return { ok: false, reason: "bad_name" };
  try {
    const { data, error } = await rateLimited(`join_family_${code}`, { limit: 5, windowMs: 15 * 60_000 }, () =>
      supabase.functions.invoke("join-family", { body: { family_code: code, child_name: name } })
    );
    if (error) return { ok: false, reason: "network" };
    if (!data?.success) return { ok: false, reason: data?.reason || "failed" };
    const { data: sess, error: setErr } = await supabase.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });
    if (setErr) return { ok: false, reason: "session" };
    return {
      ok: true,
      user: sess?.user ?? null,
      username: data.username,
      displayName: data.display_name,
    };
  } catch (e) {
    return { ok: false, reason: e?.message || "failed" };
  }
}

/** A parent's own family row (code + id). RLS: parent reads their own family. */
export async function fetchMyFamily(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from("families")
    .select("id, code, active")
    .eq("parent_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) { console.warn("fetchMyFamily:", error.message); return null; }
  return data;
}

/** The family a child belongs to (via their membership). */
export async function fetchChildFamily(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from("family_members")
    .select("family_id, display_name, app_policy, families ( id, code, parent_id, active )")
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();
  if (error) { console.warn("fetchChildFamily:", error.message); return null; }
  return data;
}

/** A parent's active children (id, display name). RLS: parent reads own members. */
export async function fetchFamilyChildren(familyId) {
  if (!familyId) return [];
  const { data, error } = await supabase
    .from("family_members")
    .select("user_id, display_name, app_policy, joined_at")
    .eq("family_id", familyId)
    .eq("role", "child")
    .is("removed_at", null)
    .order("joined_at", { ascending: true });
  if (error) { console.warn("fetchFamilyChildren:", error.message); return []; }
  return data || [];
}

// ── Child task loop ──────────────────────────────────────────
// The child's assigned tasks (their own rows — RLS "tasks: own select").
export async function fetchChildTasks(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, category, minutes, credits, status, done, requires_approval, completed_at, created_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) { console.warn("fetchChildTasks:", error.message); return []; }
  return data || [];
}

// Child marks a task done → 'submitted' (self-update, allowed by RLS). No credit
// is granted here; the parent's approval is what grants screen time server-side.
export async function submitChildTask(taskId, userId) {
  if (!taskId || !userId) return { ok: false };
  const { error } = await supabase
    .from("tasks").update({ status: "submitted" })
    .eq("id", taskId).eq("user_id", userId);
  if (error) { console.warn("submitChildTask:", error.message); return { ok: false }; }
  return { ok: true };
}

// ── Parent actions (all via service-role edge functions) ─────
async function invokeFamilyFn(name, body, rl) {
  try {
    const run = () => supabase.functions.invoke(name, { body });
    const { data, error } = rl ? await rateLimited(rl.key, rl.opts, run) : await run();
    if (error) return { ok: false, reason: "network" };
    if (!data?.success) return { ok: false, reason: data?.reason || "failed" };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, reason: e?.message || "failed" };
  }
}

export function assignChildTask(childId, title, minutes) {
  return invokeFamilyFn("assign-child-task",
    { child_id: childId, title, minutes },
    { key: `assign_task_${childId}`, opts: { limit: 60, windowMs: 60_000 } });
}

export function approveChildTask(taskId) {
  return invokeFamilyFn("approve-child-task", { task_id: taskId });
}

export function rejectChildTask(taskId) {
  return invokeFamilyFn("reject-child-task", { task_id: taskId });
}

export function setChildAppPolicy(childId, allow, mode = "categories") {
  return invokeFamilyFn("set-child-app-policy",
    { child_id: childId, app_policy: { mode, allow: allow || [] } });
}

// ── App-access requests (child asks, parent approves) ────────
// Child creates a request directly (RLS: own insert).
export async function createAppRequest(familyId, childId, appLabel, kind = "allow") {
  const label = (appLabel || "").trim().slice(0, 80);
  if (!familyId || !childId || !label) return { ok: false, reason: "bad_input" };
  const { data, error } = await supabase
    .from("app_requests")
    .insert({ family_id: familyId, child_id: childId, app_label: label, kind })
    .select().single();
  if (error) { console.warn("createAppRequest:", error.message); return { ok: false, reason: "failed" }; }
  return { ok: true, request: data };
}

// Child: their own requests + statuses.
export async function fetchMyAppRequests(childId) {
  if (!childId) return [];
  const { data, error } = await supabase
    .from("app_requests")
    .select("id, app_label, kind, status, created_at")
    .eq("child_id", childId).is("removed_at", null)
    .order("created_at", { ascending: false }).limit(50);
  if (error) { console.warn("fetchMyAppRequests:", error.message); return []; }
  return data || [];
}

// Parent: pending requests across their kids.
export async function fetchAppRequests(childIds) {
  if (!childIds?.length) return [];
  const { data, error } = await supabase
    .from("app_requests")
    .select("id, child_id, app_label, kind, status, created_at")
    .in("child_id", childIds).eq("status", "pending").is("removed_at", null)
    .order("created_at", { ascending: true });
  if (error) { console.warn("fetchAppRequests:", error.message); return []; }
  return data || [];
}

export function resolveAppRequest(requestId, approve) {
  return invokeFamilyFn("resolve-app-request", { request_id: requestId, approve: !!approve });
}

// ── Parent PIN (gates the native app picker on the child device) ──
export function setFamilyPin(pin) {
  return invokeFamilyFn("family-pin", { action: "set", pin });
}

export async function verifyFamilyPin(familyId, pin, setMode) {
  try {
    const { data, error } = await supabase.functions.invoke("family-pin", {
      body: { action: "verify", family_id: familyId, pin, set_mode: setMode },
    });
    if (error) return { ok: false, reason: "network" };
    if (!data?.success) return { ok: false, reason: data?.reason || "failed" };
    return { ok: !!data.ok, reason: data.reason };
  } catch (e) {
    return { ok: false, reason: e?.message || "failed" };
  }
}

// Parent: tasks the children have submitted and are waiting on approval.
export async function fetchPendingApprovals(childIds) {
  if (!childIds?.length) return [];
  const { data, error } = await supabase
    .from("tasks")
    .select("id, user_id, title, minutes, status, created_at")
    .in("user_id", childIds)
    .eq("status", "submitted")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) { console.warn("fetchPendingApprovals:", error.message); return []; }
  return data || [];
}

// Parent: approved (completed + granted) tasks across their kids, newest first.
export async function fetchFamilyHistory(childIds) {
  if (!childIds?.length) return [];
  const { data, error } = await supabase
    .from("tasks")
    .select("id, user_id, title, minutes, completed_at")
    .in("user_id", childIds)
    .eq("status", "approved")
    .is("deleted_at", null)
    .order("completed_at", { ascending: false })
    .limit(100);
  if (error) { console.warn("fetchFamilyHistory:", error.message); return []; }
  return data || [];
}

// Parent: current remaining balance (seconds) for each child. RLS: parent reads
// their children's profiles.
export async function fetchChildrenBalances(childIds) {
  if (!childIds?.length) return {};
  const { data, error } = await supabase
    .from("profiles").select("id, balance_seconds").in("id", childIds);
  if (error) { console.warn("fetchChildrenBalances:", error.message); return {}; }
  const map = {};
  (data || []).forEach((r) => { map[r.id] = r.balance_seconds || 0; });
  return map;
}
