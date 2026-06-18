// Drift — RevenueCat Webhook
// RevenueCat is the source of truth for Apple In-App Purchase entitlements.
// On every subscriber event it POSTs here; we map app_user_id -> profiles.id
// and flip profiles.rc_* so the app (and all AI/Pro edge functions) can gate
// access server-side. The 7-day free trial is an App Store Connect intro
// offer; RevenueCat reports period_type='trial' while it is active and the
// "pro" entitlement is active throughout the trial AND the paid period.
//
// SETUP (RevenueCat dashboard → Project → Integrations → Webhooks):
//   - URL:  https://<project-ref>.functions.supabase.co/revenuecat-webhook
//   - Authorization header value: set to the SAME string you store in the
//     Supabase secret REVENUECAT_WEBHOOK_SECRET (supabase secrets set ...).
//   - The app calls Purchases.logIn(<supabase user id>) so app_user_id == profiles.id.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

// Event types that GRANT/maintain the entitlement vs. revoke it.
const REVOKE_TYPES = new Set(["EXPIRATION", "CANCELLATION", "SUBSCRIPTION_PAUSED"]);
// NOTE: CANCELLATION means auto-renew off; access continues until expiry. We
// rely on expiration_at_ms below rather than the type alone for those.
const HARD_REVOKE = new Set(["EXPIRATION", "SUBSCRIPTION_PAUSED"]);

serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // 1. Authenticate the webhook via the shared secret in the Authorization header.
  const secret = Deno.env.get("REVENUECAT_WEBHOOK_SECRET") || "";
  const auth = req.headers.get("Authorization") || "";
  if (!secret || auth !== secret) return json({ error: "Unauthorized" }, 401);

  let payload: any;
  try { payload = await req.json(); }
  catch { return json({ error: "Invalid body" }, 400); }

  const event = payload?.event;
  if (!event?.id || !event?.app_user_id) return json({ ok: true, skipped: "no event/app_user_id" });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const appUserId   = String(event.app_user_id);
  const type        = String(event.type || "");
  const productId   = event.product_id ? String(event.product_id) : null;
  const periodType  = event.period_type ? String(event.period_type).toLowerCase() : null;
  const expiresAtMs = typeof event.expiration_at_ms === "number" ? event.expiration_at_ms : null;
  const expiresAt   = expiresAtMs ? new Date(expiresAtMs).toISOString() : null;
  const entitlementIds: string[] = Array.isArray(event.entitlement_ids) ? event.entitlement_ids : [];

  // 2. Idempotency — ignore replays of an event we've already processed.
  const { error: dupeErr } = await admin.from("rc_webhook_events").insert({
    id: event.id, app_user_id: appUserId, type, product_id: productId,
    period_type: periodType, expiration_at: expiresAt,
  });
  if (dupeErr) {
    // Primary-key collision => already handled. Anything else => log and 200
    // so RevenueCat doesn't hammer retries on a transient issue.
    if (dupeErr.code === "23505") return json({ ok: true, duplicate: true });
    console.warn("rc_webhook_events insert:", dupeErr.message);
  }

  // 3. Compute entitlement state.
  // Active when: not a hard-revoke event, the "pro" entitlement is involved
  // (or RC didn't scope entitlements), and expiry (if any) is in the future.
  const notExpired = !expiresAtMs || expiresAtMs > Date.now();
  const mentionsPro = entitlementIds.length === 0 || entitlementIds.includes("pro");
  const active = !HARD_REVOKE.has(type) && mentionsPro && notExpired;

  // 4. Resolve app_user_id -> profile. app_user_id should equal the Supabase
  // user id (set via Purchases.logIn). Anonymous RC ids ($RCAnonymousID:...)
  // can't be mapped — skip gracefully.
  if (appUserId.startsWith("$RCAnonymousID")) {
    return json({ ok: true, skipped: "anonymous app_user_id" });
  }

  const { error: updErr } = await admin.from("profiles")
    .update({
      rc_entitlement_active: active,
      rc_period_type: periodType,
      rc_product_id: productId,
      rc_expires_at: expiresAt,
      rc_last_event_at: new Date().toISOString(),
    })
    .eq("id", appUserId);

  if (updErr) {
    console.error("profiles rc update failed:", updErr.message);
    return json({ error: "update_failed" }, 500);
  }

  return json({ ok: true, active, type });
});
