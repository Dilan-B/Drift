/**
 * useSubscription.js
 * Reads the user's subscription status from the `profiles.sub_active` column.
 * Source of truth is the Stripe webhook → Supabase. Client cannot self-grant.
 */
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export function useSubscription(userId) {
  const [active,  setActive]  = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!userId) { setActive(false); setLoading(false); return; }
      setLoading(true);

      // Run dev check + sub query in parallel
      const [{ data: devOk }, { data, error }] = await Promise.all([
        supabase.rpc("is_dev_user", { uid: userId }),
        supabase.from("profiles").select("sub_active, sub_expires").eq("id", userId).maybeSingle(),
      ]);

      if (cancelled) return;
      const notExpired = !data?.sub_expires || new Date(data.sub_expires) > new Date();
      setActive(devOk === true || (!!data?.sub_active && notExpired));
      setLoading(false);
    }
    load();

    // Listen for real-time changes (e.g., after Stripe webhook update)
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
        setActive(!!n.sub_active && notExpired);
      })
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [userId]);

  return { active, loading };
}

// Start a Stripe Checkout session via the edge function and return the URL.
export async function createCheckoutSession() {
  const { data, error } = await supabase.functions.invoke("create-checkout", {});
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data?.url;
}
