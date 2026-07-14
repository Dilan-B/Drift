// Drift — Resolve App Request (parent approves/denies a child's app request)
// On approval of an 'allow' request, the app is added to that child's
// family_members.app_policy.allow so the child device can stop blocking it.
// Service-role; verifies the parent link first.
//
// POST { request_id, approve: boolean }
//   → { success: true, status } | { success: false, reason }
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

    let body: { request_id?: unknown; approve?: unknown };
    try { body = await req.json(); } catch { return json({ error: "Invalid body" }, 400); }
    const requestId = String(body.request_id ?? "");
    const approve = body.approve === true;
    if (!requestId) return json({ success: false, reason: "not_found" });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: reqRow, error: rErr } = await admin
      .from("app_requests")
      .select("id, family_id, child_id, app_label, kind, status, removed_at")
      .eq("id", requestId).maybeSingle();
    if (rErr) { console.error("resolve lookup:", rErr.message); return json({ error: "lookup_failed" }, 500); }
    if (!reqRow || reqRow.removed_at) return json({ success: false, reason: "not_found" });
    if (reqRow.status !== "pending") return json({ success: true, status: reqRow.status, already: true });

    const { data: owns } = await admin.rpc("parent_owns_child", {
      parent_uid: user.id, child_uid: reqRow.child_id,
    });
    if (owns !== true) return json({ success: false, reason: "not_parent" });

    const status = approve ? "approved" : "denied";
    const { error: updErr } = await admin.from("app_requests")
      .update({ status, resolved_at: new Date().toISOString() })
      .eq("id", requestId).eq("status", "pending");
    if (updErr) { console.error("resolve update:", updErr.message); return json({ error: "update_failed" }, 500); }

    // On approval of an allow-request, add the app to the child's allow-list.
    if (approve && reqRow.kind === "allow") {
      const { data: member } = await admin
        .from("family_members")
        .select("id, app_policy")
        .eq("family_id", reqRow.family_id).eq("user_id", reqRow.child_id).eq("role", "child")
        .is("removed_at", null).maybeSingle();
      if (member) {
        const policy = member.app_policy || { mode: "categories", allow: [] };
        const allow: string[] = Array.isArray(policy.allow) ? policy.allow : [];
        if (!allow.includes(reqRow.app_label)) allow.push(reqRow.app_label);
        await admin.from("family_members")
          .update({ app_policy: { ...policy, mode: policy.mode || "categories", allow: allow.slice(0, 100) } })
          .eq("id", member.id);
      }
    }

    return json({ success: true, status });
  } catch (err: any) {
    console.error("resolve-app-request:", err?.message || err);
    return json({ error: "Internal error" }, 500);
  }
});
