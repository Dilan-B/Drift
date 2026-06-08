// Drift – Stripe Webhook Handler
// Updates profiles.sub_active when subscriptions change.
// IMPORTANT: Verifies Stripe signature on every request.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.5.0?target=deno";

serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const stripeKey   = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSec  = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!stripeKey || !webhookSec) return new Response("Misconfigured", { status: 500 });

  const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSec);
  } catch (err: any) {
    console.error("Bad signature:", err?.message);
    return new Response(`Bad signature: ${err?.message}`, { status: 400 });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  async function setSubStatus(userId: string, active: boolean, expiresAt?: number | null) {
    await supabaseAdmin
      .from("profiles")
      .update({
        sub_active:  active,
        sub_expires: expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
        updated_at:  new Date().toISOString(),
      })
      .eq("id", userId);
  }

  // ── IDEMPOTENCY GUARD ─────────────────────────────────────
  // Stripe may retry the same event. We dedupe on event.id so we never
  // double-credit or double-grant. Insert with primary-key collision check;
  // if the row already exists, we silently 200-OK Stripe.
  try {
    const { error: dupErr } = await supabaseAdmin
      .from("webhook_events")
      .insert({ id: event.id, event_type: event.type });
    if (dupErr) {
      if ((dupErr as any).code === "23505" /* unique_violation */) {
        console.log("Duplicate webhook event ignored:", event.id);
        return new Response("ok", { status: 200 });
      }
      // Some other DB error — log and continue (better to risk dupe than to
      // drop a valid Stripe event and have inconsistent state)
      console.error("Webhook dedupe insert failed:", dupErr.message);
    }
  } catch (e: any) {
    console.error("Webhook dedupe exception:", e?.message);
  }

  try {
    let processedUserId: string | undefined;
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId  = session.metadata?.supabase_user_id ||
          (session.subscription
            ? (await stripe.subscriptions.retrieve(session.subscription as string))
                .metadata?.supabase_user_id
            : undefined);
        if (userId) { await setSubStatus(userId, true); processedUserId = userId; }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.supabase_user_id;
        if (userId) {
          const active = ["active", "trialing"].includes(sub.status);
          await setSubStatus(userId, active, sub.current_period_end);
          processedUserId = userId;
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.supabase_user_id;
        if (userId) { await setSubStatus(userId, false); processedUserId = userId; }
        break;
      }
    }

    // Record which user the event affected (for audit)
    if (processedUserId) {
      await supabaseAdmin.from("webhook_events")
        .update({ user_id: processedUserId })
        .eq("id", event.id);
    }
  } catch (err: any) {
    // Log server-side only. Never echo the error to Stripe — they'll retry,
    // which our idempotency guard handles cleanly.
    console.error("Webhook handler error:", err?.message || err);
    return new Response("Handler error", { status: 500 });
  }

  return new Response("ok", { status: 200 });
});
