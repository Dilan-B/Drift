/**
 * useSubscription.js
 * Reads the user's subscription status from the `profiles.sub_active` column.
 * Source of truth is the Stripe webhook → Supabase. Client cannot self-grant.
 */
import { useEffect, useState, useCallback } from "react";
import { supabase } from "./supabase";

export function useSubscription(userId) {
  const [active,  setActive]  = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) { setActive(false); setLoading(false); return; }
    setLoading(true);

    // Run dev check + sub query in parallel
    const [{ data: devOk }, { data }] = await Promise.all([
      supabase.rpc("is_dev_user", { uid: userId }).catch(() => ({ data: false })),
      supabase.from("profiles").select("sub_active, sub_expires, beta_unlocked_at").eq("id", userId).maybeSingle(),
    ]);

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
        setActive((!!n.sub_active && notExpired) || betaOk);
      })
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [userId, load]);

  return { active, loading, refresh: load };
}

// Start a Stripe Checkout session via the edge function and return the URL.
export async function createCheckoutSession() {
  const { data, error } = await supabase.functions.invoke("create-checkout", {});
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data?.url;
}
