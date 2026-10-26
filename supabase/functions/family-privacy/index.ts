// Drift — Family privacy (COPPA)
// Auth required; caller must be the parent who owns the family.
//
// POST { action: "grant", notice_version: string }
//   Records verifiable parental consent. The method is the monetary
//   transaction one (16 CFR 312.5(b)(2)(ii)): consent is only accepted while the
//   family holds paid seats, i.e. the parent has bought a Family plan through
//   Apple, which notifies the account holder of each transaction. Until consent
//   is on file join-family refuses every child.
//
// POST { action: "withdraw" }
//   Parent revokes consent: every child in the family is erased (data, avatar,
//   auth user) and no child can join until consent is given again.
//
// POST { action: "delete_child", child_id: uuid }
//   Parent's right to have one child's data deleted (COPPA 312.6(a)(2)).
//
// Every grant / withdrawal / deletion is logged to parental_consent_events.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const CONSENT_METHOD = "app_store_purchase";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

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

    let body: { action?: unknown; notice_version?: unknown; child_id?: unknown };
    try { body = await req.json(); } catch { return json({ error: "Invalid body" }, 400); }
    const action = String(body.action ?? "");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: family } = await admin
      .from("families").select("id, parent_id, active, deleted_at")
      .eq("parent_id", user.id).is("deleted_at", null).maybeSingle();
    if (!family) return json({ success: false, reason: "no_family" });

    const log = (a: string, extra: Record<string, unknown> = {}) =>
      admin.from("parental_consent_events").insert({
        family_id: family.id, parent_id: user.id, action: a, ...extra,
      });

    // Erase one child: data in one transaction, then avatar + auth user.
    const eraseChild = async (childId: string) => {
      const { error } = await admin.rpc("erase_account", { p_uid: childId });
      if (error) throw new Error(error.message);
      const { data: files } = await admin.storage.from("avatars").list(childId, { limit: 1000 });
      if (files?.length) {
        await admin.storage.from("avatars").remove(files.map((f: { name: string }) => `${childId}/${f.name}`));
      }
      await admin.auth.admin.deleteUser(childId, true);
    };

    const activeChildren = async (): Promise<string[]> => {
      const { data } = await admin
        .from("family_members").select("user_id")
        .eq("family_id", family.id).eq("role", "child").is("removed_at", null);
      return (data || []).map((m: { user_id: string }) => m.user_id);
    };

    if (action === "grant") {
      const version = String(body.notice_version ?? "").slice(0, 32);
      if (!version) return json({ success: false, reason: "bad_version" });
      const { data: seats, error: seatErr } = await admin.rpc("family_seats", { p_family: family.id });
      if (seatErr) return json({ error: "lookup_failed" }, 500);
      if (Number(seats ?? 0) < 1) return json({ success: false, reason: "no_plan" });
      const now = new Date().toISOString();
      const { error } = await admin.from("families").update({
        consent_at: now, consent_version: version, consent_method: CONSENT_METHOD,
      }).eq("id", family.id);
      if (error) return json({ error: "save_failed" }, 500);
      await log("grant", { notice_version: version, method: CONSENT_METHOD });
      return json({ success: true, consent_at: now, consent_version: version });
    }

    if (action === "withdraw") {
      for (const id of await activeChildren()) {
        await eraseChild(id);
        await log("delete_child", { child_id: id });
      }
      await admin.from("families").update({
        consent_at: null, consent_version: null, consent_method: null,
      }).eq("id", family.id);
      await log("withdraw");
      return json({ success: true });
    }

    if (action === "delete_child") {
      const childId = String(body.child_id ?? "");
      if (!(await activeChildren()).includes(childId)) {
        return json({ success: false, reason: "not_your_child" }, 403);
      }
      await eraseChild(childId);
      await log("delete_child", { child_id: childId });
      return json({ success: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err: any) {
    console.error("family-privacy:", err?.message || err);
    return json({ error: "Internal error" }, 500);
  }
});
