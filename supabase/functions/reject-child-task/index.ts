// Drift — Reject Child Task (parent sends it back)
// Marks a submitted task 'rejected' so the child sees it again to redo. No time
// is granted. Service-role; verifies the parent link first.
//
// POST { task_id }  →  { success: true } | { success: false, reason }
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
      .from("tasks").select("id, user_id, status, deleted_at").eq("id", taskId).maybeSingle();
    if (tErr) { console.error("reject lookup:", tErr.message); return json({ error: "lookup_failed" }, 500); }
    if (!task || task.deleted_at) return json({ success: false, reason: "not_found" });

    const { data: owns } = await admin.rpc("parent_owns_child", {
      parent_uid: user.id, child_uid: task.user_id,
    });
    if (owns !== true) return json({ success: false, reason: "not_parent" });

    const { error: updErr } = await admin.from("tasks")
      .update({ status: "rejected", done: false })
      .eq("id", taskId);
    if (updErr) { console.error("reject update:", updErr.message); return json({ error: "update_failed" }, 500); }
    return json({ success: true });
  } catch (err: any) {
    console.error("reject-child-task:", err?.message || err);
    return json({ error: "Internal error" }, 500);
  }
});
