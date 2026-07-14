// Drift — Approve Child Task (parent grants the earned screen time)
// The parent approves a task their child submitted. Marks it done and grants the
// child `minutes` of screen time atomically (ledger + balance_seconds) via the
// grant_screen_time RPC. Service-role; verifies the parent link first.
//
// POST { task_id }
//   → { success: true, new_balance_seconds }
//   → { success: false, reason: "not_parent" | "not_found" | "not_pending" }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    let body: { task_id?: unknown };
    try { body = await req.json(); } catch { return json({ error: "Invalid body" }, 400); }
    const taskId = String(body.task_id ?? "");
    if (!taskId) return json({ success: false, reason: "not_found" });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: task, error: tErr } = await admin
      .from("tasks")
      .select("id, user_id, minutes, requires_approval, status, done, deleted_at")
      .eq("id", taskId)
      .maybeSingle();
    if (tErr) { console.error("approve lookup:", tErr.message); return json({ error: "lookup_failed" }, 500); }
    if (!task || task.deleted_at) return json({ success: false, reason: "not_found" });
    if (!task.requires_approval) return json({ success: false, reason: "not_pending" });
    // Only a submitted (not already approved) task can be approved. Idempotent:
    // if it's already approved, report success without double-granting.
    if (task.status === "approved" && task.done) {
      return json({ success: true, new_balance_seconds: null, already: true });
    }
    if (task.status !== "submitted") return json({ success: false, reason: "not_pending" });

    const { data: owns } = await admin.rpc("parent_owns_child", {
      parent_uid: user.id, child_uid: task.user_id,
    });
    if (owns !== true) return json({ success: false, reason: "not_parent" });

    const mins = Math.max(0, Math.round(Number(task.minutes) || 0));

    // Flip submitted→approved as the atomic lock: the `.eq("status","submitted")`
    // filter means only ONE concurrent request actually updates a row, and only
    // that request goes on to grant — so a double-tap / retry can't double-grant.
    const { data: updated, error: updErr } = await admin.from("tasks")
      .update({ done: true, status: "approved", completed_at: new Date().toISOString() })
      .eq("id", taskId).eq("status", "submitted").select("id");
    if (updErr) { console.error("approve update:", updErr.message); return json({ error: "update_failed" }, 500); }
    if (!updated || updated.length === 0) {
      // Someone else approved it first — succeed without granting again.
      return json({ success: true, new_balance_seconds: null, already: true });
    }

    let newBalance: number | null = null;
    if (mins > 0) {
      const { data: bal, error: grantErr } = await admin.rpc("grant_screen_time", {
        child_uid: task.user_id, secs: mins * 60, mins, ref: taskId,
      });
      if (grantErr) { console.error("approve grant:", grantErr.message); return json({ error: "grant_failed" }, 500); }
      newBalance = typeof bal === "number" ? bal : null;
    }
    return json({ success: true, new_balance_seconds: newBalance });
  } catch (err: any) {
    console.error("approve-child-task:", err?.message || err);
    return json({ error: "Internal error" }, 500);
  }
});
