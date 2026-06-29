// Drift — Redeem Pro Code
// Validates a custom redemption code and grants the caller free Pro by writing
// to pro_overrides with the service role. Codes/limits/expiry live in
// redeem_codes (service-role only). Each user can redeem a given code once.
//
// POST { code: string }  →  { success: true, reason: "granted" | "already_redeemed" }
//                        →  { success: false, reason: "invalid" | "expired" | "used_up" | "inactive" }
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

    let body: { code?: unknown };
    try { body = await req.json(); } catch { return json({ error: "Invalid body" }, 400); }

    const code = String(body.code ?? "").trim().toUpperCase();
    if (!code || code.length > 64) return json({ success: false, reason: "invalid" });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Look up the code.
    const { data: row, error: codeErr } = await admin
      .from("redeem_codes")
      .select("code, grants_pro, max_uses, uses, expires_at, active")
      .eq("code", code)
      .maybeSingle();
    if (codeErr) {
      console.error("redeem-code lookup:", codeErr.message);
      return json({ error: "lookup_failed" }, 500);
    }
    if (!row) return json({ success: false, reason: "invalid" });
    if (!row.active) return json({ success: false, reason: "inactive" });
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      return json({ success: false, reason: "expired" });
    }

    // Already redeemed by this user? Treat as success (idempotent).
    const { data: priorUse } = await admin
      .from("redeem_code_uses")
      .select("code")
      .eq("code", code).eq("user_id", user.id)
      .maybeSingle();
    if (priorUse) {
      // Make sure their Pro override is still in place, then return success.
      await admin.from("pro_overrides").upsert(
        { user_id: user.id, granted: true, note: `code:${code}` },
        { onConflict: "user_id" },
      );
      return json({ success: true, reason: "already_redeemed" });
    }

    // Enforce the usage cap (null = unlimited).
    if (row.max_uses != null && row.uses >= row.max_uses) {
      return json({ success: false, reason: "used_up" });
    }

    // Record this redemption first — the unique (code,user_id) PK prevents a
    // double-grant on a racing retry.
    const { error: useErr } = await admin
      .from("redeem_code_uses")
      .insert({ code, user_id: user.id });
    if (useErr) {
      // Unique violation → another request already redeemed for this user.
      if (/duplicate|unique/i.test(useErr.message || "")) {
        return json({ success: true, reason: "already_redeemed" });
      }
      console.error("redeem-code use insert:", useErr.message);
      return json({ error: "redeem_failed" }, 500);
    }

    // Increment the counter and grant Pro.
    await admin.from("redeem_codes")
      .update({ uses: (row.uses ?? 0) + 1 })
      .eq("code", code);

    if (row.grants_pro !== false) {
      const { error: grantErr } = await admin.from("pro_overrides").upsert(
        { user_id: user.id, granted: true, note: `code:${code}` },
        { onConflict: "user_id" },
      );
      if (grantErr) {
        console.error("redeem-code grant:", grantErr.message);
        return json({ error: "grant_failed" }, 500);
      }
    }

    return json({ success: true, reason: "granted" });
  } catch (err: any) {
    console.error("redeem-code:", err?.message || err);
    return json({ error: "Internal error" }, 500);
  }
});
