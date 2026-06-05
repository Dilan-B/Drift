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

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId  = session.metadata?.supabase_user_id ||
          (session.subscription
            ? (await stripe.subscriptions.retrieve(session.subscription as string))
                .metadata?.supabase_user_id
            : undefined);
        if (userId) await setSubStatus(userId, true);
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.supabase_user_id;
        if (userId) {
          const active = ["active", "trialing"].includes(sub.status);
          await setSubStatus(userId, active, sub.current_period_end);
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.supabase_user_id;
        if (userId) await setSubStatus(userId, false);
        break;
      }
    }
  } catch (err: any) {
    console.error("Webhook handler error:", err?.message || err);
    return new Response("Handler error", { status: 500 });
  }

  return new Response("ok", { status: 200 });
});
