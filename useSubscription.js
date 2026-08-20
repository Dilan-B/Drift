/**
 * useSubscription.js
 * RevenueCat-powered subscription state.
 *
 * Drift is paid-only: $0.99/month after a 3-day free trial, no free tier.
 * Every user completes onboarding, signs up, and then hits the paywall.
 *
 * ── Why this file was deleted once, and what changed ─────────────────────────
 * Apple rejected an earlier build because react-native-purchases links
 * StoreKit, which makes App Store Connect demand complete auto-renewable
 * subscription metadata — and at the time payments were switched off, so that
 * metadata didn't exist. The fix then was to rip the SDK out. Now that we
 * actually sell a subscription the rejection reason is gone, but the lesson
 * stands: if this SDK is linked, the subscription must be fully configured in
 * App Store Connect before submitting.
 *
 * ── Setup this file assumes ──────────────────────────────────────────────────
 * RevenueCat dashboard:
 *   - Apple API key configured (public SDK key below).
 *   - Product `drift_pro_monthly` — $0.99/month, 3-day free trial as an
 *     introductory offer, Approved / Ready to Submit in App Store Connect.
 *   - An entitlement the product unlocks (we accept ANY active entitlement).
 *   - A "current" offering containing the monthly package.
 *   - A webhook pointed at the revenuecat-webhook edge function.
 *
 * ── Two sources of Pro, OR'd together ────────────────────────────────────────
 *   1. RevenueCat entitlement — the paying path.
 *   2. pro_overrides.granted — a manual grant for comps, testers, press,
 *      founders, and the App Store reviewer. Read-only to the user; only the
 *      service role can write it. See supabase/admin/schema_v9_payments.sql,
 *      and grant one with:  select public.grant_pro('them@example.com', 'why');
 *
 * The override deliberately lives in its OWN table rather than a column on
 * profiles: RLS lets a user update their own profiles row, so a column there
 * would let anyone grant themselves Pro with one PATCH.
 */
import { useEffect, useState, useCallback, useRef } from "react";
import { Platform, AppState } from "react-native";
import { supabase } from "./supabase";

// The SDK is required lazily so a JS-only context (Expo Go, a bundler that
// hasn't seen the native module yet) doesn't hard-crash on import. Everything
// below degrades to "not Pro, can't purchase" when it's missing.
let Purchases = null;
let PACKAGE_TYPE = null;
try {
  const rc = require("react-native-purchases");
  Purchases = rc.default || rc;
  PACKAGE_TYPE = rc.PACKAGE_TYPE;
} catch {}

// RevenueCat's iOS *public* SDK key. Public by design — it identifies the app
// to RevenueCat and can only read/purchase on behalf of the signed-in user. The
// secret key never leaves the dashboard and is not used by the client.
const RC_APPLE_KEY =
  process.env.EXPO_PUBLIC_RC_IOS_KEY || "appl_OetkgVkCSGdSfmrXdrqCElOjgIs";

const ENTITLEMENT_ID  = "Pro";
const PRODUCT_MONTHLY = "drift_pro_monthly";
const PRODUCT_ANNUAL  = "drift_pro_annual"; // optional; only used if the offering has one

// Family tiers. Children never pay; a parent buys a tier sized to how many
// children they have, at $0.99/month each.
//
// This is a LIST OF PRODUCTS rather than a quantity because an auto-renewable
// subscription cannot use StoreKit quantity — that is consumables only. All of
// these must live in ONE subscription group in App Store Connect, which is what
// makes Apple handle upgrades, downgrades and proration when a parent adds or
// removes a child.
export const MAX_KIDS = 5;
export const familyProductId = (kids) => `drift_family_${kids}`;

/**
 * Any active entitlement counts as Pro.
 *
 * Deliberately not keyed strictly on ENTITLEMENT_ID: a casing or naming
 * mismatch between this constant and the dashboard ("Pro" vs "pro") would make
 * a PAYING user look unpaid and shove them back behind the paywall. Failing
 * open here costs us nothing — the entitlement only exists if Apple charged
 * someone.
 */
function hasProEntitlement(info) {
  const active = info?.entitlements?.active;
  if (!active) return false;
  return active[ENTITLEMENT_ID] != null || Object.keys(active).length > 0;
}

/** Prefer the dashboard's "current" offering, then common names, then any. */
export function resolveOffering(off) {
  return off?.current
    || off?.all?.["default"]
    || off?.all?.["drift_pro"]
    || (off?.all ? Object.values(off.all)[0] : null)
    || null;
}

/**
 * The package for a family tier of N children, or null if that tier is not
 * configured in the offering. Matched strictly by product id — there is no
 * "close enough" fallback, because falling back would charge a parent for the
 * wrong number of children.
 */
export function pickFamilyPackage(offering, kids) {
  if (!offering || !kids) return null;
  const want = familyProductId(kids);
  return (offering.availablePackages || []).find(p => p.product?.identifier === want) || null;
}

/**
 * Pick the package for a plan, tolerant of how products were attached to the
 * offering (typed package, or by product id).
 *
 * A monthly selection NEVER falls back to annual. Charging someone a year
 * because they tapped a monthly button is the single worst bug this file could
 * have; failing visibly is strictly better.
 */
export function pickPackage(offering, planType) {
  if (!offering) return null;
  const pkgs = offering.availablePackages || [];
  if (planType === "annual") {
    return offering.annual
      || pkgs.find(p => p.packageType === PACKAGE_TYPE?.ANNUAL)
      || pkgs.find(p => p.product?.identifier === PRODUCT_ANNUAL)
      || null;
  }
  return offering.monthly
    || pkgs.find(p => p.packageType === PACKAGE_TYPE?.MONTHLY)
    || pkgs.find(p => p.product?.identifier === PRODUCT_MONTHLY)
    || pkgs[0]
    || null;
}

/** Trial length + price, read off the real package so the paywall never lies. */
export function describeOffer(pkg) {
  const product = pkg?.product;
  const priceString = product?.priceString || "$0.99";
  // RN SDK shapes differ across versions; check both.
  const intro = product?.introPrice || product?.introductoryPrice || null;
  const trialDays = (() => {
    if (!intro) return 0;
    const n = Number(intro.periodNumberOfUnits ?? intro.periodNumberOfUnits ?? 0);
    const unit = String(intro.periodUnit || "").toUpperCase();
    if (!n) return 0;
    if (unit.includes("DAY"))   return n;
    if (unit.includes("WEEK"))  return n * 7;
    if (unit.includes("MONTH")) return n * 30;
    return n;
  })();
  const isFreeTrial = !!intro && Number(intro.price ?? 0) === 0;
  return { priceString, trialDays, isFreeTrial };
}

let rcConfigured = false;
let rcIdentified = null; // last RC appUserID we aligned to

async function ensureConfigured(userId) {
  if (Platform.OS !== "ios" || !Purchases) return;
  if (!rcConfigured) {
    Purchases.configure({ apiKey: RC_APPLE_KEY, appUserID: userId || undefined });
    rcConfigured = true;
    rcIdentified = userId || null;
    return;
  }
  // Align RC identity with the Supabase user. Critical if configure() ran
  // anonymously before login: otherwise purchases, restores and promotional
  // grants key off an anonymous id instead of the user's UUID, and the webhook
  // then can't match the payment to an account.
  if (userId && rcIdentified !== userId) {
    try { await Purchases.logIn(userId); rcIdentified = userId; } catch {}
  }
}

export function useSubscription(userId) {
  const [entitled, setEntitled] = useState(false); // RevenueCat
  const [override, setOverride] = useState(false); // manual grant
  const [loading,  setLoading]  = useState(true);
  const [offerings, setOfferings] = useState(null);
  const checkedRef = useRef(false);

  /**
   * Manual Pro grant. Works on every platform (RevenueCat is iOS-only), which
   * is also what makes it usable for the App Store reviewer and for Android
   * later.
   *
   * A missing table or a network error leaves the previous value alone rather
   * than clearing it — revoking someone's access because Postgres blipped
   * would drop them onto a paywall they already paid past.
   */
  const checkOverride = useCallback(async () => {
    if (!userId) { setOverride(false); return; }
    try {
      const { data, error } = await supabase
        .from("pro_overrides").select("granted, expires_at").eq("user_id", userId).maybeSingle();
      if (error) return;
      const live = !!data?.granted &&
        (!data.expires_at || new Date(data.expires_at) > new Date());
      setOverride(live);
    } catch {
      // Network error — keep previous override state.
    }
  }, [userId]);

  const checkEntitlement = useCallback(async () => {
    if (Platform.OS !== "ios" || !Purchases) { setLoading(false); return; }
    try {
      await ensureConfigured(userId);
      const info = await Purchases.getCustomerInfo();
      setEntitled(hasProEntitlement(info));
    } catch {
      // RevenueCat unreachable — keep previous state. Do NOT downgrade to
      // false: a paying user on a flaky connection would get paywalled.
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Initial check + fetch offerings.
  useEffect(() => {
    if (!userId || checkedRef.current) return;
    checkedRef.current = true;
    (async () => {
      await ensureConfigured(userId);
      await Promise.all([checkEntitlement(), checkOverride()]);
      try {
        if (Purchases) setOfferings(await Purchases.getOfferings());
      } catch {}
    })();
  }, [userId, checkEntitlement, checkOverride]);

  // Re-check on foreground. Covers a subscription bought or cancelled in the
  // App Store app while Drift was backgrounded.
  useEffect(() => {
    const sub = AppState.addEventListener("change", next => {
      if (next === "active") { checkEntitlement(); checkOverride(); }
    });
    return () => sub.remove();
  }, [checkEntitlement, checkOverride]);

  // Live entitlement updates (restore, renewal, cancellation).
  useEffect(() => {
    if (Platform.OS !== "ios" || !Purchases) return;
    const listener = info => setEntitled(hasProEntitlement(info));
    Purchases.addCustomerInfoUpdateListener(listener);
    return () => Purchases.removeCustomerInfoUpdateListener(listener);
  }, []);

  /**
   * @param planType "monthly" | "annual" | { kids: N } for a family tier.
   */
  const purchase = useCallback(async (planType = "monthly") => {
    if (Platform.OS !== "ios") return { success: false, reason: "ios_only" };
    if (!Purchases) return { success: false, reason: "sdk_missing" };
    try {
      await ensureConfigured(userId);
      const off = offerings || await Purchases.getOfferings();
      const offering = resolveOffering(off);
      if (!offering) return { success: false, reason: "no_offering" };
      const kids = typeof planType === "object" ? Number(planType.kids) || 0 : 0;
      const pkg = kids > 0
        ? pickFamilyPackage(offering, kids)
        : pickPackage(offering, planType);
      // A missing family tier is reported distinctly: "no_package" would send
      // the parent to retry forever when the real problem is a product that
      // was never created in App Store Connect.
      if (!pkg) return { success: false, reason: kids > 0 ? "tier_unavailable" : "no_package" };
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      const active = hasProEntitlement(customerInfo);
      setEntitled(active);
      return { success: active, reason: active ? "purchased" : "not_entitled" };
    } catch (e) {
      if (e?.userCancelled) return { success: false, reason: "cancelled" };
      return { success: false, reason: e?.message || "unknown" };
    }
  }, [userId, offerings]);

  /**
   * Restore. Apple REQUIRES this on any paid screen — a user who reinstalls, or
   * signs in on a new device, must be able to recover access without paying
   * twice, and its absence is a guideline 3.1.1 rejection on its own.
   */
  const restore = useCallback(async () => {
    if (Platform.OS !== "ios") return { success: false, reason: "ios_only" };
    if (!Purchases) return { success: false, reason: "sdk_missing" };
    try {
      await ensureConfigured(userId);
      const info = await Purchases.restorePurchases();
      const active = hasProEntitlement(info);
      setEntitled(active);
      // A restore can also land on an account that was comped rather than
      // charged, so re-read the grant too before telling them it failed.
      await checkOverride();
      return { success: active };
    } catch (e) {
      return { success: false, reason: e?.message || "unknown" };
    }
  }, [userId, checkOverride]);

  /** Re-check both Pro sources. Call after redeeming a code. */
  const refresh = useCallback(async () => {
    await Promise.all([checkEntitlement(), checkOverride()]);
  }, [checkEntitlement, checkOverride]);

  /**
   * Apple's offer-code redemption sheet. These are Apple-GENERATED codes made
   * in App Store Connect and tied to the subscription — not arbitrary strings.
   * For our own codes use redeemProCode() in supabase.js.
   */
  const redeemAppStoreCode = useCallback(async () => {
    if (Platform.OS !== "ios" || !Purchases) return { success: false, reason: "ios_only" };
    try {
      await ensureConfigured(userId);
      if (Purchases.presentCodeRedemptionSheet) await Purchases.presentCodeRedemptionSheet();
      await checkEntitlement();
      return { success: true };
    } catch (e) {
      return { success: false, reason: e?.message || "unknown" };
    }
  }, [userId, checkEntitlement]);

  return {
    proAccess: entitled || override,
    entitled,
    override,
    loading,
    offerings,
    purchase,
    restore,
    checkEntitlement,
    refresh,
    redeemAppStoreCode,
  };
}
