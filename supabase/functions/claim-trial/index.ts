// Drift – Claim 7-Day Free Trial
// Called once after signup. Grants 7 days of Pro IFF the user's IP hasn't
// already been used for a trial recently (anti-abuse).
//
// IP is hashed (SHA-256 + per-deploy salt) before storage — we never store
// raw IPs. This means IPs can be matched for abuse detection but not
// reverse-engineered or leaked.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TRIAL_DAYS                 = 7;
const IP_LOCKOUT_DAYS            = 30;   // how long an IP is "burned" after a trial
const MAX_TRIALS_PER_IP_LIFETIME = 1;    // hard cap; bump if you need leniency

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function isEmailVerified(user: { email_confirmed_at?: string | null; confirmed_at?: string | null } | null): boolean {
  return !!(user?.email_confirmed_at || user?.confirmed_at);
}

// Hash IP with a server-side salt — irreversible, but deterministic enough
// to detect collisions.
async function hashIp(ip: string): Promise<string> {
  const salt = Deno.env.get("IP_HASH_SALT") || "drift-default-salt-change-me";
  const enc  = new TextEncoder();
  const data = enc.encode(`${salt}::${ip.trim().toLowerCase()}`);
  const buf  = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function extractIp(req: Request): string {
  // Supabase Edge runs behind a CDN. Trust the leftmost X-Forwarded-For value.
  const xff = req.headers.get("x-forwarded-for") || "";
  const real = req.headers.get("x-real-ip") || "";
  return (xff.split(",")[0].trim() || real.trim() || "0.0.0.0");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

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
    if (!isEmailVerified(user)) return json({ error: "email_not_verified" }, 403);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Already has an active subscription or a previously granted trial?
    const { data: profile } = await admin
      .from("profiles")
      .select("sub_active, sub_expires, trial_claimed_at")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.trial_claimed_at) {
      return json({ granted: false, reason: "already_claimed", expiresAt: profile.sub_expires });
    }

    // Per-user_id check (defense-in-depth — IP can be spoofed via XFF, but
    // the JWT user_id is verified by Supabase Auth).
    const { count: userPriorTrials } = await admin
      .from("trial_ip_log")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id);
    if ((userPriorTrials ?? 0) > 0) {
      return json({ granted: false, reason: "already_claimed" });
    }

    // Hash the IP and check for cross-account abuse
    const ip      = extractIp(req);
    const ipHash  = await hashIp(ip);
    const cutoff  = new Date(Date.now() - IP_LOCKOUT_DAYS * 86_400_000).toISOString();

    const { count: priorCount } = await admin
      .from("trial_ip_log")
      .select("*", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", cutoff);

    if ((priorCount ?? 0) >= MAX_TRIALS_PER_IP_LIFETIME) {
      // Don't reveal exact reason — anti-fingerprinting
      return json({ granted: false, reason: "ineligible" });
    }

    // Short-term IP rate limit (prevents floods even from unauth attempts)
    const last10minCutoff = new Date(Date.now() - 10 * 60_000).toISOString();
    const { count: recentCount } = await admin
      .from("trial_ip_log")
      .select("*", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", last10minCutoff);
    if ((recentCount ?? 0) >= 3) {
      return json({ granted: false, reason: "ineligible" });
    }

    // Grant the trial
    const expiresAt = new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString();
    const { error: updErr } = await admin.from("profiles").update({
      sub_active:       true,
      sub_expires:      expiresAt,
      trial_claimed_at: new Date().toISOString(),
    }).eq("id", user.id);

    if (updErr) {
      console.error("trial update failed:", updErr);
      return json({ error: "Could not grant trial" }, 500);
    }

    // Log the IP hash (we keep this even after the trial expires)
    await admin.from("trial_ip_log").insert({
      ip_hash: ipHash, user_id: user.id,
    });

    return json({ granted: true, expiresAt });
  } catch (err: any) {
    console.error("claim-trial:", err?.message || err);
    return json({ error: "Internal error" }, 500);
  }
});
