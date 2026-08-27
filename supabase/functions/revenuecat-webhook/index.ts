// Drift — RevenueCat Webhook
//
// RevenueCat is the source of truth for Apple IAP entitlements. On every
// subscriber event it POSTs here; we map app_user_id -> profiles.id and write
// the entitlement so the app and every AI edge function can gate server-side.
//
// ── What the previous version got wrong ──────────────────────────────────────
// It wrote profiles.rc_entitlement_active / rc_expires_at / rc_period_type /
// rc_product_id / rc_last_event_at — none of which existed as columns. Every
// delivery would have failed the UPDATE and returned 500, so RevenueCat would
// have retried forever while no entitlement ever landed. And even a successful
// write would have granted nothing, because the AI functions gate on
// sub_active, which it never touched.
//
// Now: sub_active / sub_expires are the canonical write (that is what is READ),
// with the rc_* columns kept alongside as diagnostics. schema_v9 created them.
//
// ── Pricing model ───────────────────────────────────────────────────────────
// $4.99/month or $29.99/year. Children never pay: the PARENT buys a tier sized to
// how many children they have, and every child under that family inherits
// access. Auto-renewable subscriptions cannot use StoreKit quantity, so "per
// child" is modelled as tiered products in one subscription group:
//
//     com.drift.pro.month   -> a solo user, no children
//     com.drift.pro.annual  -> the same, billed yearly (0 child seats)
//     drift_family_1..5     -> a parent paying for 1..5 children
//
// The solo products are reverse-DNS and the family tiers are not. That is how
// they exist in App Store Connect and product IDs cannot be renamed, so the
// regex below matches the family scheme and everything else falls through to
// "solo", which is the correct default for both solo products.
//
// The tier drives families.seats. is_pro() then entitles children in join
// order up to that number.
//
// ── SETUP (RevenueCat dashboard → Project → Integrations → Webhooks) ────────
//   URL:    https://<project-ref>.functions.supabase.co/revenuecat-webhook
//   Header: Authorization = the same string stored in the Supabase secret
//           REVENUECAT_WEBHOOK_SECRET  (supabase secrets set ...)
//   The app calls Purchases.logIn(<supabase user id>) so app_user_id ==
//   profiles.id. Without that the events arrive anonymous and unmappable.
//
// This function must be deployed with --no-verify-jwt: RevenueCat authenticates
// with the shared secret above, not a Supabase user token.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

// Events that end access outright. CANCELLATION deliberately is NOT here:
// cancelling only turns auto-renew off, and the user keeps access until
// expiration_at_ms. Treating it as a revoke would cut off someone who has paid
// through the end of the month.
const HARD_REVOKE = new Set(["EXPIRATION", "SUBSCRIPTION_PAUSED", "REFUND"]);

/**
 * How many child seats a product buys.
 *
 * Unknown products get 0 seats but still grant the purchaser their own access —
 * a new SKU we haven't taught this function about should degrade to "solo",
 * never to "no access for someone who just paid".
 */
function seatsForProduct(productId: string | null): number {
  if (!productId) return 0;
  const m = /^drift_family_(\d+)$/.exec(productId);
  if (m) {
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(20, n)) : 0;
  }
  return 0; // com.drift.pro.month / .annual and anything else: solo
}

serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // 1. Authenticate via the shared secret.
  const secret = Deno.env.get("REVENUECAT_WEBHOOK_SECRET") || "";
  const auth = req.headers.get("Authorization") || "";
  if (!secret) {
    console.error("REVENUECAT_WEBHOOK_SECRET not set — refusing all events");
    return json({ error: "not_configured" }, 500);
  }
  if (auth !== secret) {
    console.error("webhook rejected: bad authorization header");
    return json({ error: "Unauthorized" }, 401);
  }

  let payload: any;
  try { payload = await req.json(); }
  catch { return json({ error: "Invalid body" }, 400); }

  const event = payload?.event;
  if (!event?.id || !event?.app_user_id) return json({ ok: true, skipped: "no event/app_user_id" });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const appUserId   = String(event.app_user_id);
  const type        = String(event.type || "");
  const productId   = event.product_id ? String(event.product_id) : null;
  const periodType  = event.period_type ? String(event.period_type).toLowerCase() : null;
  const expiresAtMs = typeof event.expiration_at_ms === "number" ? event.expiration_at_ms : null;
  const expiresAt   = expiresAtMs ? new Date(expiresAtMs).toISOString() : null;

  // 2. Anonymous ids can't be mapped to an account. This means the app called
  // configure() before logIn() — worth logging loudly, because it silently
  // means somebody paid and got nothing.
  if (appUserId.startsWith("$RCAnonymousID")) {
    console.error("webhook: anonymous app_user_id — Purchases.logIn() did not run before purchase");
    return json({ ok: true, skipped: "anonymous app_user_id" });
  }

  // 3. Idempotency. RevenueCat retries on any non-2xx and can redeliver out of
  // order; replaying a stale EXPIRATION after a RENEWAL would revoke a paying
  // customer.
  const { error: dupeErr } = await admin.from("rc_webhook_events").insert({
    id: event.id, app_user_id: appUserId, type, product_id: productId,
    period_type: periodType, expiration_at: expiresAt,
  });
  if (dupeErr) {
    if (dupeErr.code === "23505") return json({ ok: true, duplicate: true });
    // Not fatal — better to process the event than to drop it over a ledger
    // hiccup. Worst case is a redundant idempotent write.
    console.warn("rc_webhook_events insert:", dupeErr.message);
  }

  // 4. Entitlement state. Active while not hard-revoked and not past expiry.
  // period_type 'trial' is ACTIVE — the 7-day free trial grants full access.
  const notExpired = !expiresAtMs || expiresAtMs > Date.now();
  const active = !HARD_REVOKE.has(type) && notExpired;

  const { error: updErr } = await admin.from("profiles")
    .update({
      sub_active: active,
      sub_expires: expiresAt,
      rc_entitlement_active: active,
      rc_period_type: periodType,
      rc_product_id: productId,
      rc_expires_at: expiresAt,
      rc_last_event_at: new Date().toISOString(),
    })
    .eq("id", appUserId);

  if (updErr) {
    // 500 so RevenueCat retries. An entitlement that fails to land is somebody
    // who paid and can't get in, which is worth the retry storm.
    console.error("profiles entitlement update failed:", updErr.code || updErr.message);
    return json({ error: "update_failed" }, 500);
  }

  // 5. Family seats. Only meaningful for a parent who bought a family tier.
  // Seats are cleared to 0 on revoke so children lose access with the parent,
  // rather than staying entitled off a stale seat count.
  const seats = active ? seatsForProduct(productId) : 0;
  if (seats > 0 || HARD_REVOKE.has(type)) {
    const { error: famErr } = await admin.from("families")
      .update({ seats })
      .eq("parent_id", appUserId)
      .is("deleted_at", null);
    // Not fatal: a solo subscriber has no family row, and .update() matching
    // nothing is not an error. Only a real failure is worth logging.
    if (famErr) console.warn("families seats update:", famErr.code || famErr.message);
  }

  return json({ ok: true, active, type, seats });
});
