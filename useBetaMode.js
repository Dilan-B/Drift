/**
 * useBetaMode.js
 *
 * Beta tester flow:
 *  1. User enters the code on their Profile page.
 *  2. Code is sent to the `redeem-beta-code` edge function (NOT validated
 *     client-side — the real code lives only in Supabase secrets).
 *  3. On success, the server sets `profiles.beta_unlocked_at = now()`, which
 *     grants REAL Pro access (verified by all AI edge functions).
 *  4. The "Preview free" toggle then lets the beta tester flip between the
 *     Pro and Free UI for testing/feedback. The toggle ONLY changes how the
 *     app displays itself — server-side, the user is always Pro until they
 *     manually lock beta access.
 *
 * The `unlocked` flag is sourced from `profiles.beta_unlocked_at` so it
 * survives reinstalls and works across devices.
 */
import { useEffect, useState, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";

const PREVIEW_KEY = "drift_beta_preview_as_free";

export function useBetaMode(userId) {
  const [unlocked,      setUnlocked]      = useState(false);
  const [previewAsFree, setPreviewAsFreeState] = useState(false);
  const [loaded,        setLoaded]        = useState(false);

  // Load preview-toggle from local storage on mount
  useEffect(() => {
    (async () => {
      try {
        const p = await AsyncStorage.getItem(PREVIEW_KEY);
        if (p === "1") setPreviewAsFreeState(true);
      } catch {}
      setLoaded(true);
    })();
  }, []);

  // Server is the source of truth for `unlocked`
  useEffect(() => {
    if (!userId) { setUnlocked(false); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles").select("beta_unlocked_at").eq("id", userId).maybeSingle();
      if (!cancelled) setUnlocked(!!data?.beta_unlocked_at);
    })();

    // Listen for real-time changes (when redeem succeeds, this updates)
    const channel = supabase
      .channel(`beta:${userId}`)
      .on("postgres_changes", {
        event:  "UPDATE",
        schema: "public",
        table:  "profiles",
        filter: `id=eq.${userId}`,
      }, payload => {
        setUnlocked(!!payload.new?.beta_unlocked_at);
      })
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [userId]);

  // Submit the code to the server. Returns { ok: true } on success,
  // { ok: false, reason } on failure.
  const tryUnlock = useCallback(async (codeAttempt) => {
    const code = String(codeAttempt || "").trim();
    if (!code) return { ok: false, reason: "empty" };
    try {
      const { data, error } = await supabase.functions.invoke("redeem-beta-code", {
        body: { code },
      });
      if (error) return { ok: false, reason: "network" };
      if (data?.ok) { setUnlocked(true); return { ok: true }; }
      if (data?.error === "rate_limit") return { ok: false, reason: "rate_limit", message: data.message };
      return { ok: false, reason: data?.error || "invalid" };
    } catch (e) {
      return { ok: false, reason: "network" };
    }
  }, []);

  const setPreviewAsFree = useCallback(async (val) => {
    setPreviewAsFreeState(val);
    await AsyncStorage.setItem(PREVIEW_KEY, val ? "1" : "0");
  }, []);

  // Note: "lock" only affects the local preview-toggle. The server keeps
  // `beta_unlocked_at` set — beta status doesn't get rescinded by the client.
  // (We could add a "revoke beta" edge function later if needed.)
  const lock = useCallback(async () => {
    await AsyncStorage.removeItem(PREVIEW_KEY);
    setPreviewAsFreeState(false);
  }, []);

  return { unlocked, previewAsFree, loaded, tryUnlock, setPreviewAsFree, lock };
}
