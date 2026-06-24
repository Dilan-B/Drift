/**
 * useSubscription.js
 * RevenueCat-powered subscription state. Server is source of truth.
 *
 * Setup required in RevenueCat dashboard:
 *  - Apple API key configured
 *  - Product "drift_pro_annual" ($24.99/yr with 1-week free trial)
 *  - Entitlement "pro" granting access
 *  - Offering "default" containing the annual package
 */
import { useEffect, useState, useCallback, useRef } from "react";
import { Platform, AppState } from "react-native";
import Purchases from "react-native-purchases";

const RC_APPLE_KEY = "appl_OetkgVkCSGdSfmrXdrqCElOjgIs";
const ENTITLEMENT_ID = "Pro";

let rcConfigured = false;

async function ensureConfigured(userId) {
  if (rcConfigured) return;
  if (Platform.OS !== "ios") return;
  Purchases.configure({ apiKey: RC_APPLE_KEY, appUserID: userId || undefined });
  rcConfigured = true;
}

export function useSubscription(userId) {
  const [proAccess, setProAccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [offerings, setOfferings] = useState(null);
  const checkedRef = useRef(false);

  const checkEntitlement = useCallback(async () => {
    if (Platform.OS !== "ios") { setLoading(false); return; }
    try {
      await ensureConfigured(userId);
      const info = await Purchases.getCustomerInfo();
      const active = !!info.entitlements.active[ENTITLEMENT_ID];
      setProAccess(active);
    } catch {
      // If RevenueCat is unreachable, keep previous state
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Initial check + fetch offerings
  useEffect(() => {
    if (!userId || checkedRef.current) return;
    checkedRef.current = true;
    (async () => {
      await ensureConfigured(userId);
      await checkEntitlement();
      try {
        const off = await Purchases.getOfferings();
        setOfferings(off);
      } catch {}
    })();
  }, [userId, checkEntitlement]);

  // Re-check on foreground
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") checkEntitlement();
    });
    return () => sub.remove();
  }, [checkEntitlement]);

  // Listen for RevenueCat updates (restore, subscription change)
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const listener = (info) => {
      const active = !!info.entitlements.active[ENTITLEMENT_ID];
      setProAccess(active);
    };
    Purchases.addCustomerInfoUpdateListener(listener);
    return () => Purchases.removeCustomerInfoUpdateListener(listener);
  }, []);

  const purchase = useCallback(async (planType = "annual") => {
    if (Platform.OS !== "ios") return { success: false, reason: "ios_only" };
    try {
      await ensureConfigured(userId);
      const off = offerings || await Purchases.getOfferings();
      const offering = off?.current || off?.all?.["drift_pro"];
      const pkg = planType === "monthly" ? offering?.monthly : offering?.annual;
      if (!pkg) return { success: false, reason: "no_package" };
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      const active = !!customerInfo.entitlements.active[ENTITLEMENT_ID];
      setProAccess(active);
      return { success: active, reason: active ? "purchased" : "not_entitled" };
    } catch (e) {
      if (e.userCancelled) return { success: false, reason: "cancelled" };
      return { success: false, reason: e?.message || "unknown" };
    }
  }, [userId, offerings]);

  const restore = useCallback(async () => {
    if (Platform.OS !== "ios") return { success: false, reason: "ios_only" };
    try {
      await ensureConfigured(userId);
      const info = await Purchases.restorePurchases();
      const active = !!info.entitlements.active[ENTITLEMENT_ID];
      setProAccess(active);
      return { success: active };
    } catch (e) {
      return { success: false, reason: e?.message || "unknown" };
    }
  }, [userId]);

  return { proAccess, loading, offerings, purchase, restore, checkEntitlement };
}
