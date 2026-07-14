// Drift — Set Child App Policy (parent-managed allow-list)
// The child's phone blocks standard categories by default; the parent can exempt
// specific apps. This writes family_members.app_policy for one child. The child
// device reads the policy and applies "block categories except the allowed apps".
//
// POST { child_id, app_policy: { mode: "categories", allow: string[] } }
//   → { success: true } | { success: false, reason }
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

    let body: { child_id?: unknown; app_policy?: any };
    try { body = await req.json(); } catch { return json({ error: "Invalid body" }, 400); }
    const childId = String(body.child_id ?? "");
    if (!childId) return json({ success: false, reason: "bad_input" });

    // Normalize the policy to a safe, bounded shape.
    const rawAllow = Array.isArray(body.app_policy?.allow) ? body.app_policy.allow : [];
    const allow = rawAllow
      .map((a: unknown) => String(a).slice(0, 120))
      .filter(Boolean)
      .slice(0, 100);
    const rawMode = String(body.app_policy?.mode ?? "categories");
    const mode = rawMode === "custom" ? "custom" : "categories";
    const policy = { mode, allow };

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: owns } = await admin.rpc("parent_owns_child", {
      parent_uid: user.id, child_uid: childId,
    });
    if (owns !== true) return json({ success: false, reason: "not_parent" });

    const { error: updErr } = await admin.from("family_members")
      .update({ app_policy: policy })
      .eq("user_id", childId).eq("role", "child").is("removed_at", null);
    if (updErr) { console.error("set-policy update:", updErr.message); return json({ error: "update_failed" }, 500); }
    return json({ success: true, app_policy: policy });
  } catch (err: any) {
    console.error("set-child-app-policy:", err?.message || err);
    return json({ error: "Internal error" }, 500);
  }
});
