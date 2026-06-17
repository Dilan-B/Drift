// Drift – Create Stripe Checkout Session
// Auth required. Creates (or reuses) a Stripe Customer and returns a Checkout URL.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.5.0?target=deno";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function isEmailVerified(user: { email_confirmed_at?: string | null; confirmed_at?: string | null } | null): boolean {
  return !!(user?.email_confirmed_at || user?.confirmed_at);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    // Use service-role to read profiles (bypasses RLS for legitimate server work)
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);
    if (!isEmailVerified(user)) return json({ error: "email_not_verified" }, 403);

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const priceId   = Deno.env.get("STRIPE_PRICE_ID");
    if (!stripeKey || !priceId) return json({ error: "Stripe not configured" }, 500);

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    // Find/create Stripe customer
    const { data: profile } = await supabaseAdmin
      .from("profiles").select("stripe_customer_id").eq("id", user.id).maybeSingle();

    let customerId = profile?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      await supabaseAdmin.from("profiles")
        .update({ stripe_customer_id: customerId }).eq("id", user.id);
    }

    // Whitelist of valid redirect base URLs — APP_URL must match one of these
    // to prevent open-redirect attacks if the env var is ever misconfigured.
    const configuredUrl = (Deno.env.get("APP_URL") || "drift://checkout").replace(/\/+$/, "");
    const allowedUrl =
      configuredUrl === "https://drift.app" ||
      configuredUrl === "https://www.drift.app" ||
      configuredUrl.startsWith("drift://");
    const baseUrl = allowedUrl ? configuredUrl : "drift://checkout";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: user.id,
      metadata: { supabase_user_id: user.id },
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${baseUrl}/cancel`,
      subscription_data: { metadata: { supabase_user_id: user.id } },
    });

    return json({ url: session.url });
  } catch (err: any) {
    console.error("create-checkout:", err?.message || err);
    return json({ error: err?.message || "Could not start checkout" }, 500);
  }
});
