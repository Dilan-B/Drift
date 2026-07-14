// Drift — Family PIN (set / verify)
// A parent sets a PIN; the child's device requires it before the native app
// picker opens, so a kid can't change which apps are blocked. The hash lives in
// the service-role-only family_pins table; clients never read it.
//
// POST { action: "set", pin }                    (caller must be the parent)
//   → { success: true }
// POST { action: "verify", family_id, pin }      (child device)
//   → { success: true, ok: boolean }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function hashPin(familyId: string, pin: string): Promise<string> {
  const data = new TextEncoder().encode(`${familyId}:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

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

    let body: { action?: unknown; pin?: unknown; family_id?: unknown };
    try { body = await req.json(); } catch { return json({ error: "Invalid body" }, 400); }
    const action = String(body.action ?? "");
    const pin = String(body.pin ?? "").replace(/\D/g, "").slice(0, 8);
    if (pin.length < 4) return json({ success: false, reason: "bad_pin" });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (action === "set") {
      // Caller must be the parent-owner of a family.
      const { data: fam } = await admin
        .from("families").select("id").eq("parent_id", user.id).is("deleted_at", null).maybeSingle();
      if (!fam) return json({ success: false, reason: "not_parent" });
      const pin_hash = await hashPin(fam.id, pin);
      const { error } = await admin.from("family_pins")
        .upsert({ family_id: fam.id, pin_hash, updated_at: new Date().toISOString() }, { onConflict: "family_id" });
      if (error) { console.error("pin set:", error.message); return json({ error: "set_failed" }, 500); }
      return json({ success: true });
    }

    if (action === "verify") {
      const familyId = String((body as { family_id?: unknown }).family_id ?? "");
      const setMode = String((body as { set_mode?: unknown }).set_mode ?? "");
      if (!familyId) return json({ success: false, reason: "not_found" });
      const { data: row } = await admin
        .from("family_pins").select("pin_hash").eq("family_id", familyId).maybeSingle();
      if (!row) return json({ success: true, ok: false, reason: "no_pin" });
      const candidate = await hashPin(familyId, pin);
      const ok = candidate === row.pin_hash;

      // On a correct PIN, optionally flip THIS child's blocking mode (the parent
      // is present on the child's device to enter the PIN). The child can't
      // write their own policy, so we do it here with the service role.
      if (ok && (setMode === "custom" || setMode === "categories")) {
        const { data: member } = await admin
          .from("family_members").select("id, app_policy")
          .eq("family_id", familyId).eq("user_id", user.id).eq("role", "child")
          .is("removed_at", null).maybeSingle();
        if (member) {
          const policy = member.app_policy || { mode: "categories", allow: [] };
          await admin.from("family_members")
            .update({ app_policy: { ...policy, mode: setMode } })
            .eq("id", member.id);
        }
      }
      return json({ success: true, ok });
    }

    return json({ error: "bad_action" }, 400);
  } catch (err: any) {
    console.error("family-pin:", err?.message || err);
    return json({ error: "Internal error" }, 500);
  }
});
