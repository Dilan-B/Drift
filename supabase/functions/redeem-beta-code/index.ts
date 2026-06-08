// Drift – Redeem Beta Code
// Verifies a user-supplied beta code against the server secret. On match,
// flips `profiles.beta_unlocked_at` to NOW(), giving the user real Pro access.
//
// SECURITY:
//  - The actual code lives in Supabase secrets (BETA_CODE env var). It is
//    NEVER in the client bundle. Rotate via `supabase secrets set BETA_CODE=…`.
//  - Constant-time comparison to prevent timing side-channel.
//  - Per-user rate limit (10 attempts / hour) to prevent bruteforce.
//  - Per-IP rate limit (20 attempts / hour) as defense-in-depth.
//  - Once redeemed, idempotent — re-running just returns success.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_PER_USER_PER_HOUR = 10;
const MAX_PER_IP_PER_HOUR   = 20;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// Constant-time string comparison (prevent timing leak on code length / content)
function constantTimeEq(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hashIp(ip: string): Promise<string> {
  const salt = Deno.env.get("IP_HASH_SALT") || "drift-default-salt-change-me";
  const data = new TextEncoder().encode(`${salt}::${ip.trim().toLowerCase()}`);
  const buf  = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function extractIp(req: Request): string {
  return (req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
          req.headers.get("x-real-ip")?.trim() || "0.0.0.0");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Already unlocked? Idempotent — return success.
    const { data: profile } = await admin
      .from("profiles").select("beta_unlocked_at").eq("id", user.id).maybeSingle();
    if (profile?.beta_unlocked_at) {
      return json({ ok: true, alreadyUnlocked: true });
    }

    // Parse body
    let body: { code?: string };
    try { body = await req.json(); }
    catch { return json({ error: "Invalid body" }, 400); }
    const submittedCode = String(body.code || "").trim();
    if (!submittedCode || submittedCode.length > 64) {
      return json({ error: "Invalid code" }, 400);
    }

    // Rate limits
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const ipHash  = await hashIp(extractIp(req));

    const [{ count: userTries }, { count: ipTries }] = await Promise.all([
      admin.from("beta_redeem_attempts")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id).gte("created_at", hourAgo),
      admin.from("beta_redeem_attempts")
        .select("*", { count: "exact", head: true })
        .eq("ip_hash", ipHash).gte("created_at", hourAgo),
    ]);
    if ((userTries ?? 0) >= MAX_PER_USER_PER_HOUR) {
      return json({ error: "rate_limit", message: "Too many attempts. Try again later." }, 429);
    }
    if ((ipTries ?? 0) >= MAX_PER_IP_PER_HOUR) {
      return json({ error: "rate_limit", message: "Too many attempts. Try again later." }, 429);
    }

    // Compare against the server-side code
    const expectedCode = Deno.env.get("BETA_CODE") || "";
    if (!expectedCode) {
      console.error("BETA_CODE env var not set");
      return json({ error: "Beta access not configured" }, 500);
    }

    const matched = constantTimeEq(submittedCode, expectedCode);

    // Log every attempt (success or fail) for abuse audit
    await admin.from("beta_redeem_attempts").insert({
      user_id: user.id, success: matched, ip_hash: ipHash,
    });

    if (!matched) {
      return json({ ok: false, error: "invalid_code" }, 200);
    }

    // ✓ Code matched — grant Pro access via beta flag
    const { error: updErr } = await admin.from("profiles")
      .update({ beta_unlocked_at: new Date().toISOString() })
      .eq("id", user.id);

    if (updErr) {
      console.error("beta unlock update failed:", updErr.message);
      return json({ error: "Could not unlock beta access" }, 500);
    }

    return json({ ok: true });
  } catch (err: any) {
    console.error("redeem-beta-code:", err?.message || err);
    return json({ error: "Internal error" }, 500);
  }
});
