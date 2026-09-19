// Drift — Redeem Pro / Cohort Code
// Validates a redemption code and grants the caller free Pro. Codes, limits,
// expiry, cohort and grant duration live in redeem_codes (service-role only).
// Each user can redeem a given code once.
//
// POST { code: string, participantId?: string }
//   → { success: true,  reason: "granted" | "already_redeemed",
//       cohort?: string, expiresAt?: string | null }
//   → { success: false, reason: "invalid" | "expired" | "used_up" | "inactive"
//       | "participant_id_required" | "participant_id_invalid"
//       | "participant_id_taken" }
//
// participantId is only read for codes whose redeem_codes.participant_id_format
// is set (research cohorts). The client learns a code needs one from the
// participant_id_required reply, then resubmits with it.
//
// SECURITY
//  - The decision is made by public.redeem_cohort_code() (schema_v16), not
//    here. That function takes a row lock, so two people racing for the last
//    seat of a capped code cannot both win — which the previous TypeScript
//    read-modify-write on `uses` allowed.
//  - Email verification required. Without it a throwaway account can burn a
//    cohort seat, and a 250-seat study code is worth burning.
//  - Per-user and per-IP attempt limits. supabase.js wraps this call in
//    rateLimited(), but that is client-side and trivially skipped.
//  - redeem_cohort_code is revoked from anon/authenticated: it takes the uid
//    as a parameter, so only the service role may call it, and only with a
//    uid taken from a verified JWT.
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

function isEmailVerified(
  user: { email_confirmed_at?: string | null; confirmed_at?: string | null } | null,
): boolean {
  return !!(user?.email_confirmed_at || user?.confirmed_at);
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

// The SQL function speaks in precise reasons; the client's copy map is keyed on
// the older, coarser set. Translate here so RedeemCodeModal keeps working and
// we do not leak "which of these four checks failed" to a code-guesser.
const REASON: Record<string, string> = {
  invalid_code:        "invalid",
  code_inactive:       "inactive",
  code_expired:        "expired",
  code_exhausted:      "used_up",
  code_grants_nothing: "inactive",
  no_user:             "invalid",
  participant_id_required: "participant_id_required",
  participant_id_invalid:  "participant_id_invalid",
  participant_id_taken:    "participant_id_taken",
};

// Asking for an ID is a step in the flow, not a failed guess, so it does not
// count against the hourly attempt limit.
const NOT_AN_ATTEMPT = new Set(["participant_id_required"]);

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
    if (!isEmailVerified(user)) return json({ error: "email_not_verified" }, 403);

    let body: { code?: unknown; participantId?: unknown };
    try { body = await req.json(); } catch { return json({ error: "Invalid body" }, 400); }

    const code = String(body.code ?? "").trim().toUpperCase();
    if (!code || code.length > 64) return json({ success: false, reason: "invalid" });

    const participantId = body.participantId == null ? null : String(body.participantId).trim();
    if (participantId && participantId.length > 64) {
      return json({ success: false, reason: "participant_id_invalid" });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Rate limit ──────────────────────────────────────────
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const ipHash  = await hashIp(extractIp(req));

    const [{ count: userTries }, { count: ipTries }] = await Promise.all([
      admin.from("redeem_code_attempts")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id).gte("created_at", hourAgo),
      admin.from("redeem_code_attempts")
        .select("*", { count: "exact", head: true })
        .eq("ip_hash", ipHash).gte("created_at", hourAgo),
    ]);
    if ((userTries ?? 0) >= MAX_PER_USER_PER_HOUR || (ipTries ?? 0) >= MAX_PER_IP_PER_HOUR) {
      return json({ error: "rate_limit", message: "Too many attempts. Try again later." }, 429);
    }

    // ── Redeem ──────────────────────────────────────────────
    // One call. Validation, the usage cap, the per-user lock, the counter and
    // the grant all happen inside one transaction holding a row lock on the
    // code. See schema_v16_cohort_codes.sql.
    const { data: result, error: rpcErr } = await admin.rpc("redeem_cohort_code", {
      p_uid:            user.id,
      p_code:           code,
      p_participant_id: participantId || null,
    });

    if (rpcErr) {
      console.error("redeem-code rpc:", rpcErr.message);
      // Not logged as an attempt: this is our failure, not theirs, and it
      // should not eat into their hourly allowance.
      return json({ error: "redeem_failed" }, 500);
    }

    const ok      = result?.ok === true;
    const rawWhy  = String(result?.error ?? "");
    // Redeeming twice is a success from the user's point of view — they hold
    // the grant either way, and telling them "already redeemed" after a flaky
    // network retry reads as a failure that isn't one.
    const already = rawWhy === "already_redeemed";

    if (!NOT_AN_ATTEMPT.has(rawWhy)) await admin.from("redeem_code_attempts").insert({
      user_id: user.id,
      code,
      success: ok || already,
      ip_hash: ipHash,
    });

    if (already) return json({ success: true, reason: "already_redeemed" });

    if (!ok) {
      return json({ success: false, reason: REASON[rawWhy] || "invalid" });
    }

    return json({
      success:   true,
      reason:    "granted",
      cohort:    result?.cohort ?? null,
      expiresAt: result?.expires_at ?? null,
    });
  } catch (err: any) {
    console.error("redeem-code:", err?.message || err);
    return json({ error: "Internal error" }, 500);
  }
});
