/**
 * useSubscription.js
 * Reads the user's subscription status from the `profiles.sub_active` column.
 * Source of truth is the Stripe webhook → Supabase. Client cannot self-grant.
 */
import { useEffect, useState, useCallback } from "react";
import { supabase } from "./supabase";
import { cached, invalidateCache, rateLimited } from "./apiGuards";

export function useSubscription(userId) {
  const [active,  setActive]  = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async ({ force = false } = {}) => {
    if (!userId) { setActive(false); setLoading(false); return; }
    setLoading(true);

    // Run dev check + sub query in parallel
    const [{ data: devOk }, { data }] = await cached(`sub_${userId}`, 20_000, () => Promise.all([
      supabase.rpc("is_dev_user", { uid: userId }).catch(() => ({ data: false })),
      supabase.from("profiles").select("sub_active, sub_expires, beta_unlocked_at").eq("id", userId).maybeSingle(),
    ]), { force });

    const notExpired = !data?.sub_expires || new Date(data.sub_expires) > new Date();
    const betaOk = !!data?.beta_unlocked_at;
    setActive(devOk === true || (!!data?.sub_active && notExpired) || betaOk);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    if (!cancelled) load();

    // Listen for real-time changes (Stripe webhook, beta unlock, etc.)
    const channel = supabase
      .channel(`profile:${userId}`)
      .on("postgres_changes", {
        event:  "UPDATE",
        schema: "public",
        table:  "profiles",
        filter: `id=eq.${userId}`,
      }, payload => {
        const n = payload.new;
        const notExpired = !n.sub_expires || new Date(n.sub_expires) > new Date();
        const betaOk = !!n.beta_unlocked_at;
        invalidateCache(`sub_${userId}`);
        setActive((!!n.sub_active && notExpired) || betaOk);
      })
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [userId, load]);

  return { active, loading, refresh: () => load({ force: true }) };
}

// Start a Stripe Checkout session via the edge function and return the URL.
export async function createCheckoutSession() {
  const { data, error } = await rateLimited("checkout", { limit: 5, windowMs: 10 * 60_000 }, () =>
    supabase.functions.invoke("create-checkout", {})
  );
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data?.url;
}

export async function confirmCheckoutSession(sessionId) {
  const clean = String(sessionId || "").trim();
  if (!clean) throw new Error("Missing checkout session.");
  const { data, error } = await rateLimited("confirm_checkout", { limit: 10, windowMs: 10 * 60_000 }, () =>
    supabase.functions.invoke("confirm-checkout-session", {
      body: { sessionId: clean },
    })
  );
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}
