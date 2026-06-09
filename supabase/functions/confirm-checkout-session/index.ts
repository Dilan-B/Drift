// Drift - Confirm Stripe Checkout Session
// Auth required. Verifies the returned Checkout Session belongs to the
// authenticated user before updating profiles.sub_active.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.5.0?target=deno";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function subscriptionPeriodEnd(sub: Stripe.Subscription | string | null): number | null {
  if (!sub || typeof sub === "string") return null;
  return sub.current_period_end || null;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return json({ error: "Stripe not configured" }, 500);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    let body: { sessionId?: string };
    try { body = await req.json(); }
    catch { return json({ error: "Invalid body" }, 400); }

    const sessionId = String(body.sessionId || "").trim();
    if (!/^cs_(test|live)_[A-Za-z0-9_]+$/.test(sessionId)) {
      return json({ error: "Invalid session" }, 400);
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    });

    const ownerId = session.client_reference_id || session.metadata?.supabase_user_id;
    if (ownerId !== user.id) {
      console.warn("checkout owner mismatch", { sessionId, ownerId, userId: user.id });
      return json({ error: "Forbidden" }, 403);
    }

    const sub = session.subscription as Stripe.Subscription | string | null;
    const subStatus = typeof sub === "string" ? null : sub?.status;
    const sessionPaid = session.payment_status === "paid" || session.payment_status === "no_payment_required";
    const subscriptionActive = !!subStatus && ["active", "trialing"].includes(subStatus);
    if (!sessionPaid && !subscriptionActive) {
      return json({ active: false, reason: "not_paid" }, 402);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const expiresAt = subscriptionPeriodEnd(sub);
    const { error: updateErr } = await admin
      .from("profiles")
      .update({
        sub_active: true,
        sub_expires: expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
        stripe_customer_id: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (updateErr) {
      console.error("confirm-checkout update:", updateErr.message);
      return json({ error: "Could not update subscription" }, 500);
    }

    return json({
      active: true,
      subExpires: expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
    });
  } catch (err: any) {
    console.error("confirm-checkout-session:", err?.message || err);
    return json({ error: "Could not confirm checkout" }, 500);
  }
});
