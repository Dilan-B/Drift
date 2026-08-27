/**
 * useSubscription.js
 * RevenueCat-powered subscription state.
 *
 * Drift is paid-only: $4.99/month or $29.99/year after a 7-day free trial, no
 * free tier. Every user completes onboarding, signs up, and then hits the
 * paywall. Prices are never hardcoded into what the user is charged — they come
 * from StoreKit via the live offering; the figures named here and in
 * PaywallScreen's FALLBACK_* constants are documentation and pre-load
 * placeholders, and must be kept in step with App Store Connect.
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
 *   - Product `com.drift.pro.month`  — $4.99/month.
 *   - Product `com.drift.pro.annual` — $29.99/year, in the SAME subscription
 *     group as the monthly so Apple handles switching between them. Optional in
 *     the sense that the code degrades to monthly-only without it, but the
 *     paywall defaults to annual and annual carries ~3x the LTV, so treat it as
 *     required.
 *   - Products `drift_family_1` … `drift_family_5` — the parent-pays-per-child
 *     tiers, same subscription group.
 *   - A 7-day free trial as an introductory offer on BOTH, or the paywall will
 *     advertise a trial the store does not honour.
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
import AsyncStorage from "@react-native-async-storage/async-storage";
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
// These MUST match App Store Connect exactly. Note the two naming schemes:
// the solo products are reverse-DNS (com.drift.pro.*) and the family tiers are
// bare snake_case (drift_family_N). That is how they were created, and product
// IDs cannot be renamed or reused once they exist, so the code matches the
// store rather than the other way round.
//
// Only the family tiers are matched by ID in anger — pickFamilyPackage() and
// the webhook's seatsForProduct() both key off `drift_family_N` strictly. The
// solo IDs below are a LAST-RESORT fallback: pickPackage() prefers RevenueCat's
// package types (offering.monthly / offering.annual), which is why the solo
// products kept working while these constants were wrong.
const PRODUCT_MONTHLY = "com.drift.pro.month";
const PRODUCT_ANNUAL  = "com.drift.pro.annual";

// Family tiers. Children never pay; a parent buys a tier sized to how many
// children they have. Priced as a base seat plus a per-child amount rather
// than a flat per-child figure — see FAMILY_BASE / FAMILY_PER_KID in
// PaywallScreen for the pre-load estimate.
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
  const priceString = product?.priceString || "$4.99";
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
let rcInitError  = null; // why the SDK is unusable, when it is

/** Why RevenueCat is unavailable, or null when it's fine. For diagnostics. */
export function rcUnavailableReason() { return rcInitError; }

/**
 * Configure RevenueCat. Returns whether the SDK is usable. NEVER throws.
 *
 * `Purchases.configure()` throws SYNCHRONOUSLY when NativeModules.RNPurchases
 * is missing — Expo Go, a JS-only bundle, or a binary built before the pod was
 * installed. `require("react-native-purchases")` still SUCCEEDS in every one of
 * those cases, so the `!Purchases` check above does not catch it.
 *
 * That throw used to escape the init effect below, which meant
 * checkEntitlement() never ran, `loading` never went false — and because the
 * paywall gate in Drift.jsx was `!loading`, EVERY new user walked straight past
 * the paywall into the full app. Swallowing it here isn't hiding the problem:
 * callers read the return value and fail CLOSED.
 */
async function ensureConfigured(userId) {
  if (Platform.OS !== "ios") { rcInitError = "not_ios";     return false; }
  if (!Purchases)            { rcInitError = "sdk_missing"; return false; }
  if (!rcConfigured) {
    try {
      Purchases.configure({ apiKey: RC_APPLE_KEY, appUserID: userId || undefined });
      rcConfigured = true;
      rcIdentified = userId || null;
      rcInitError  = null;
    } catch (e) {
      rcInitError = e?.message || "configure_failed";
      console.warn("[Drift] RevenueCat unavailable:", rcInitError);
      return false;
    }
    return true;
  }
  // Align RC identity with the Supabase user. Critical if configure() ran
  // anonymously before login: otherwise purchases, restores and promotional
  // grants key off an anonymous id instead of the user's UUID, and the webhook
  // then can't match the payment to an account.
  //
  // Best-effort on purpose: a failed logIn leaves the SDK perfectly able to
  // READ entitlements, so it must not be reported as "SDK broken" and paywall
  // someone who is paying.
  if (userId && rcIdentified !== userId) {
    try { await Purchases.logIn(userId); rcIdentified = userId; } catch {}
  }
  return true;
}

/**
 * How long we will wait for a definitive entitlement answer before deciding
 * one. The paywall fails CLOSED, so "still deciding" holds the user on the
 * loading screen — this ceiling is what stops a hung RevenueCat call from
 * parking them there forever.
 */
const RESOLVE_TIMEOUT_MS = 8000;

/** Where the last DEFINITIVE Pro answer for a user is cached. */
const lastProKey = (uid) => `drift_pro_seen_${uid}`;

export function useSubscription(userId) {
  const [entitled, setEntitled] = useState(false); // RevenueCat
  const [override, setOverride] = useState(false); // manual grant
  // Do we have a DEFINITIVE answer about this user yet? The paywall fails
  // closed on it: until this is true Drift.jsx shows the loading screen, never
  // the app. Guaranteed to become true within RESOLVE_TIMEOUT_MS.
  const [resolved, setResolved] = useState(false);
  // The last definitive Pro answer for this user, read from disk. This is what
  // keeps the "never paywall a paying customer on a flaky connection" promise
  // now that unknown means paywall: someone who has verified as Pro before
  // boots straight into the app while the live check runs behind them. Someone
  // who never has does not.
  const [knownPro, setKnownPro] = useState(false);
  // Did each source actually ANSWER, as opposed to erroring, timing out, or
  // being unreadable? "No entitlement" and "couldn't ask" are different facts
  // and must not collapse into each other: only the first may overrule a
  // previously-confirmed subscriber.
  const [rcAnswered, setRcAnswered] = useState(false);
  const [ovAnswered, setOvAnswered] = useState(false);
  const [offerings, setOfferings] = useState(null);
  // Keyed by user, not a bare boolean: signing out and back in as a DIFFERENT
  // account must re-decide from scratch, or one paying account unlocks the next
  // one on the same device.
  const checkedForRef = useRef(null);

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
    if (!userId) { setOverride(false); setOvAnswered(false); return; }
    try {
      const { data, error } = await supabase
        .from("pro_overrides").select("granted, expires_at").eq("user_id", userId).maybeSingle();
      if (error) { setOvAnswered(false); return; }
      const live = !!data?.granted &&
        (!data.expires_at || new Date(data.expires_at) > new Date());
      setOverride(live);
      setOvAnswered(true);
    } catch {
      // Network error — keep previous override state.
      setOvAnswered(false);
    }
  }, [userId]);

  const checkEntitlement = useCallback(async () => {
    // No usable SDK. Report it as UNREADABLE, not as "not entitled": a build
    // with the native module missing tells us nothing about whether this person
    // pays Apple every month. A never-Pro user still lands on the paywall
    // (knownPro is false); a subscriber is not punished for our build error.
    // The old code did `setLoading(false); return;` here, which — once the gate
    // was `!loading` — silently unlocked the whole app instead.
    if (!(await ensureConfigured(userId))) {
      setEntitled(false); setRcAnswered(false); return;
    }
    try {
      const info = await Purchases.getCustomerInfo();
      setEntitled(hasProEntitlement(info));
      setRcAnswered(true);
    } catch {
      // RevenueCat unreachable — keep previous state. Do NOT downgrade to
      // false: a paying user on a flaky connection would get paywalled.
      // `knownPro` covers the same case across a cold start.
      setRcAnswered(false);
    }
  }, [userId]);

  // A new account starts undecided. Without this, the previous user's answer
  // survives a sign-out and entitles whoever signs in next on this device.
  useEffect(() => {
    setResolved(false);
    setEntitled(false);
    setOverride(false);
    setKnownPro(false);
    setRcAnswered(false);
    setOvAnswered(false);
    if (!userId) return;
    let cancelled = false;
    AsyncStorage.getItem(lastProKey(userId))
      .then(v => { if (!cancelled) setKnownPro(v === "1"); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userId]);

  // Persist every definitive answer, so the next cold start knows whether this
  // user has ever been Pro before the network comes back.
  useEffect(() => {
    if (!resolved || !userId) return;
    const pro = entitled || override;
    // Writing "0" off a timeout or a network error would paywall a subscriber
    // on their NEXT cold start too, turning one bad request into a lasting
    // lockout. Only a source that actually answered may clear the flag.
    if (!pro && !(rcAnswered && ovAnswered)) return;
    AsyncStorage.setItem(lastProKey(userId), pro ? "1" : "0").catch(() => {});
  }, [resolved, entitled, override, rcAnswered, ovAnswered, userId]);

  // Initial check + fetch offerings.
  //
  // Everything here is wrapped so that `resolved` ALWAYS flips. The bug this
  // replaces was exactly one unguarded `await` — ensureConfigured() throwing on
  // a missing native module rejected this IIFE before the entitlement check
  // ran, so the flag the paywall gates on never moved and nobody was ever
  // charged. Do not add an await outside the try.
  useEffect(() => {
    if (!userId || checkedForRef.current === userId) return;
    checkedForRef.current = userId;

    let settled = false;
    const resolve = () => { if (!settled) { settled = true; setResolved(true); } };
    // Hard ceiling, so a hung RevenueCat call can't park a user on the loading
    // screen indefinitely. Timing out lands a non-payer on the paywall.
    const timer = setTimeout(() => {
      console.warn("[Drift] entitlement check timed out — treating as undecided");
      resolve();
    }, RESOLVE_TIMEOUT_MS);

    (async () => {
      try {
        await Promise.all([checkEntitlement(), checkOverride()]);
      } catch {
        // Both callees already swallow their own errors; this is belt-and-
        // braces so a future edit can't re-create the never-resolves bug.
      } finally {
        clearTimeout(timer);
        resolve();
      }
      // Offerings are for rendering the paywall's prices, not for deciding
      // access — deliberately fetched AFTER resolution so a slow catalogue
      // request never delays the gate.
      try {
        if (rcConfigured && Purchases) setOfferings(await Purchases.getOfferings());
      } catch {}
    })();

    return () => clearTimeout(timer);
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
      // Hard-stop rather than pressing on: calling purchasePackage() on an
      // unconfigured SDK throws UninitializedPurchasesError, which surfaced to
      // the user as an opaque "Something went wrong".
      if (!(await ensureConfigured(userId))) return { success: false, reason: "sdk_missing" };
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
      if (!(await ensureConfigured(userId))) {
        // A comped account can still be recovered with no StoreKit at all.
        await checkOverride();
        return { success: false, reason: "sdk_missing" };
      }
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
      if (!(await ensureConfigured(userId))) return { success: false, reason: "sdk_missing" };
      if (Purchases.presentCodeRedemptionSheet) await Purchases.presentCodeRedemptionSheet();
      await checkEntitlement();
      return { success: true };
    } catch (e) {
      return { success: false, reason: e?.message || "unknown" };
    }
  }, [userId, checkEntitlement]);

  return {
    // A user we have PREVIOUSLY confirmed as Pro is let through whenever the
    // live check could not produce a real answer — still running, timed out,
    // network down, SDK unusable. Once BOTH sources have actually answered,
    // they are authoritative and the cached flag is ignored, so a genuinely
    // lapsed subscriber lands back on the paywall.
    //
    // A user we have never seen as Pro has knownPro = false, so every one of
    // those failure modes leaves them on the paywall. That asymmetry is the
    // fix: unknown is only generous to people who have already paid.
    proAccess: entitled || override || (!(rcAnswered && ovAnswered) && knownPro),
    resolved,
    entitled,
    override,
    loading: !resolved,
    sdkError: rcInitError,
    offerings,
    purchase,
    restore,
    checkEntitlement,
    refresh,
    redeemAppStoreCode,
  };
}
