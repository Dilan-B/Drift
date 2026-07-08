/**
 * useSubscription.js
 * RevenueCat-powered subscription state. Server is source of truth.
 *
 * Setup required in RevenueCat dashboard + App Store Connect:
 *  - Apple API key configured
 *  - Products: "drift_pro_annual" (yearly) AND "drift_pro_monthly" (monthly),
 *    both Approved/Ready to Submit in App Store Connect.
 *  - Attach BOTH to the offering as the Annual and Monthly package types.
 *  - One entitlement the products unlock. We treat ANY active entitlement as
 *    Pro, so its exact identifier/casing here doesn't have to match the dash.
 *  - A "current" offering set in the dashboard containing both packages.
 */
import { useEffect, useState, useCallback, useRef } from "react";
import { Platform, AppState } from "react-native";
import Purchases, { PACKAGE_TYPE } from "react-native-purchases";
import { supabase } from "./supabase";

// ── Payments kill-switch ─────────────────────────────────────
// Payments are turned OFF for now: every user gets full access for free and no
// paywall / upgrade / purchase UI is shown anywhere. All the RevenueCat + Apple
// IAP machinery below is left intact but dormant (its effects no-op) so we can
// bring paid Pro back later by flipping this single flag to `true`.
const PAYMENTS_ENABLED = false;

const RC_APPLE_KEY = "appl_OetkgVkCSGdSfmrXdrqCElOjgIs";
const ENTITLEMENT_ID = "Pro";
// Product identifiers — must match App Store Connect + RevenueCat exactly.
const PRODUCT_ANNUAL  = "drift_pro_annual";
const PRODUCT_MONTHLY = "drift_pro_monthly";

// The user is Pro if ANY entitlement is active. Deliberately not keyed strictly
// on ENTITLEMENT_ID: a case/name mismatch between this constant and the
// dashboard ("Pro" vs "pro") would otherwise make a PAID user look unpaid.
function hasProEntitlement(info) {
  const active = info?.entitlements?.active;
  if (!active) return false;
  return active[ENTITLEMENT_ID] != null || Object.keys(active).length > 0;
}

// Resolve the offering robustly: prefer the dashboard's "current", then common
// names, then the first one that exists.
export function resolveOffering(off) {
  return off?.current
    || off?.all?.["default"]
    || off?.all?.["drift_pro"]
    || (off?.all ? Object.values(off.all)[0] : null)
    || null;
}

// Pick the package for the chosen plan, tolerant of how products are attached
// to the offering (typed package or by product id). IMPORTANT: a monthly
// selection NEVER falls back to the annual package — better to fail clearly
// than to charge a user the yearly price for a monthly tap.
export function pickPackage(offering, planType) {
  if (!offering) return null;
  const pkgs = offering.availablePackages || [];
  if (planType === "monthly") {
    return offering.monthly
      || pkgs.find(p => p.packageType === PACKAGE_TYPE?.MONTHLY)
      || pkgs.find(p => p.product?.identifier === PRODUCT_MONTHLY)
      || null;
  }
  return offering.annual
    || pkgs.find(p => p.packageType === PACKAGE_TYPE?.ANNUAL)
    || pkgs.find(p => p.product?.identifier === PRODUCT_ANNUAL)
    || pkgs[0]
    || null;
}

let rcConfigured = false;
let rcIdentified = null; // last RC appUserID we aligned to

async function ensureConfigured(userId) {
  if (Platform.OS !== "ios") return;
  if (!rcConfigured) {
    Purchases.configure({ apiKey: RC_APPLE_KEY, appUserID: userId || undefined });
    rcConfigured = true;
    rcIdentified = userId || null;
    return;
  }
  // Align RC identity with the Supabase user. Critical if configure() ran
  // anonymously before login: otherwise purchases, restores and promotional
  // grants key off an anonymous id instead of the user's UUID.
  if (userId && rcIdentified !== userId) {
    try { await Purchases.logIn(userId); rcIdentified = userId; } catch {}
  }
}

export function useSubscription(userId) {
  const [proAccess, setProAccess] = useState(false); // RevenueCat-derived entitlement
  const [override, setOverride] = useState(false);   // Supabase profiles.pro_override
  const [loading, setLoading] = useState(true);
  const [offerings, setOfferings] = useState(null);
  const checkedRef = useRef(false);

  // Backend Pro override: a manually-granted flag in Supabase that grants Pro
  // regardless of RevenueCat (comps, testers, founders). RevenueCat stays the
  // primary path; this is OR'd in. Works on all platforms (RC is iOS-only).
  //
  // Read from the dedicated `pro_overrides` table — NOT a column on profiles —
  // because profiles' RLS lets users update their own row, which would let them
  // grant themselves Pro. pro_overrides is read-only to the user (select own
  // row); only the service role (SQL editor / admin) can grant. See
  // supabase/admin/schema_v8_pro_override.sql.
  const checkOverride = useCallback(async () => {
    if (!userId) { setOverride(false); return; }
    try {
      const { data, error } = await supabase
        .from("pro_overrides").select("granted").eq("user_id", userId).maybeSingle();
      // If the table doesn't exist yet (schema not applied), treat as no override.
      if (error) return;
      setOverride(!!data?.granted);
    } catch {
      // Network error — keep previous override state.
    }
  }, [userId]);

  const checkEntitlement = useCallback(async () => {
    if (Platform.OS !== "ios") { setLoading(false); return; }
    try {
      await ensureConfigured(userId);
      const info = await Purchases.getCustomerInfo();
      const active = hasProEntitlement(info);
      setProAccess(active);
    } catch {
      // If RevenueCat is unreachable, keep previous state
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Initial check + fetch offerings
  useEffect(() => {
    if (!PAYMENTS_ENABLED) return;
    if (!userId || checkedRef.current) return;
    checkedRef.current = true;
    (async () => {
      await ensureConfigured(userId);
      await Promise.all([checkEntitlement(), checkOverride()]);
      try {
        const off = await Purchases.getOfferings();
        setOfferings(off);
      } catch {}
    })();
  }, [userId, checkEntitlement, checkOverride]);

  // Re-check on foreground
  useEffect(() => {
    if (!PAYMENTS_ENABLED) return;
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") { checkEntitlement(); checkOverride(); }
    });
    return () => sub.remove();
  }, [checkEntitlement, checkOverride]);

  // Listen for RevenueCat updates (restore, subscription change)
  useEffect(() => {
    if (!PAYMENTS_ENABLED) return;
    if (Platform.OS !== "ios") return;
    const listener = (info) => {
      const active = hasProEntitlement(info);
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
      const offering = resolveOffering(off);
      if (!offering) return { success: false, reason: "no_offering" };
      const pkg = pickPackage(offering, planType);
      if (!pkg) return { success: false, reason: planType === "monthly" ? "monthly_unavailable" : "no_package" };
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      const active = hasProEntitlement(customerInfo);
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
      const active = hasProEntitlement(info);
      setProAccess(active);
      return { success: active };
    } catch (e) {
      return { success: false, reason: e?.message || "unknown" };
    }
  }, [userId]);

  // Re-check both Pro sources (RevenueCat + Supabase override). Call after
  // redeeming a code so Pro flips on without waiting for the next foreground.
  const refresh = useCallback(async () => {
    await Promise.all([checkEntitlement(), checkOverride()]);
  }, [checkEntitlement, checkOverride]);

  // StoreKit: present Apple's offer-code / promo-code redemption sheet. NOTE
  // these are Apple-GENERATED codes (created in App Store Connect, tied to the
  // subscription), not arbitrary custom strings — for your own custom codes use
  // redeemProCode() in supabase.js. Safe no-op off iOS / if unsupported.
  const redeemAppStoreCode = useCallback(async () => {
    if (Platform.OS !== "ios") return { success: false, reason: "ios_only" };
    try {
      await ensureConfigured(userId);
      if (Purchases.presentCodeRedemptionSheet) {
        await Purchases.presentCodeRedemptionSheet();
      }
      await checkEntitlement();
      return { success: true };
    } catch (e) {
      return { success: false, reason: e?.message || "unknown" };
    }
  }, [userId, checkEntitlement]);

  if (!PAYMENTS_ENABLED) {
    // Free-for-all: full access, no purchase surface. Callbacks are safe no-ops
    // so any lingering call site does nothing instead of erroring.
    const noop = async () => ({ success: false, reason: "payments_disabled" });
    return {
      proAccess: true,
      loading: false,
      offerings: null,
      purchase: noop,
      restore: noop,
      checkEntitlement: async () => {},
      refresh: async () => {},
      redeemAppStoreCode: noop,
    };
  }

  return { proAccess: proAccess || override, loading, offerings, purchase, restore, checkEntitlement, refresh, redeemAppStoreCode };
}
