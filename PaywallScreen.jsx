/**
 * PaywallScreen.jsx
 * The hard paywall. Drift has no free tier — onboarding, then sign-up, then
 * this, and nothing past it until the subscription (or a manual grant) is live.
 *
 * ── Things here that exist because Apple rejects builds without them ─────────
 * Guideline 3.1.2 / 3.1.1 require, on any screen that sells a subscription:
 *   - the price and billing period, stated plainly
 *   - the trial length AND what it converts to, before the purchase button
 *   - that it auto-renews until cancelled, and how to cancel
 *   - a Restore Purchases control
 *   - links to Terms of Use (EULA) and Privacy Policy
 * All five are below. Do not "clean them up" — each one is a rejection.
 *
 * Prices are read from the live RevenueCat package rather than hardcoded, so
 * the screen cannot advertise a price different from what StoreKit charges
 * (another rejection, and worse, a trust problem). The literals are only a
 * placeholder until the offering loads.
 *
 * ── The escape hatch ─────────────────────────────────────────────────────────
 * A paywall with no way out is a trap, and a reviewer who cannot get past it
 * fails the build. There is deliberately no dismiss, but there IS sign-out —
 * so a user who doesn't want to pay can leave, and support can move an account.
 *
 * ── Why this screen has two beats ────────────────────────────────────────────
 * When a `plan` is passed (the tasks the user just picked in onboarding) the
 * first view shows a short REVEAL — "your plan is ready", their tasks, what
 * they'd earn per day — before the offer. Two reasons, both measured:
 *
 *   1. Mirroring onboarding answers on the paywall beats essentially every
 *      layout experiment. It reframes the ask from "pay to use this app" into
 *      "unlock the thing you just built", which is the difference between
 *      Noom-style quiz funnels converting >10% and the ~2.7% median.
 *   2. Multi-page onboarding paywalls convert ~37% better than single-page
 *      (12.41% vs 9.07% across 40M+ opens). The reveal IS the second page.
 *
 * The reveal is shown ONCE per install. A user who declines and comes back
 * lands straight on the offer — repeating the ceremony every launch would read
 * as a stall, not a delivery.
 */
import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, Platform,
  Animated, Alert, Linking, StatusBar,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { FF } from "./theme";
import { CheckIcon, LockIcon } from "./Icons";
import { Spinner } from "./Skeleton";
import {
  resolveOffering, pickPackage, pickFamilyPackage, describeOffer, MAX_KIDS,
} from "./useSubscription";

const TERMS_URL   = "https://driftproductivity.com/terms";
const PRIVACY_URL = "https://driftproductivity.com/privacy";

// Marks the reveal as spent. Per install, not per user: it is a first-run
// flourish, and a second account on the same phone does not need the ceremony.
const REVEAL_SEEN_KEY = "drift_paywall_reveal_seen";

// ── Placeholders, shown ONLY until the live offering loads ───────────────────
// These must mirror App Store Connect exactly. StoreKit is the source of truth
// and overwrites them the moment the offering arrives; they exist so a slow
// network shows the right number instead of a wrong one. If you reprice in App
// Store Connect, reprice here in the same change.
const FALLBACK_MONTHLY    = "$4.99";
const FALLBACK_ANNUAL     = "$29.99";
// There is deliberately no FALLBACK_TRIAL_DAYS. A price fallback stands in for
// a number we are about to confirm; a trial fallback stood in for a PROMISE,
// and it fired whenever the real trial length was 0 — including when the user
// was not eligible for one at all.

// Per-seat estimate for a family tier before its real price loads. A base seat
// for the parent plus each child. Labelled as an estimate wherever it is shown,
// because App Store price points are not perfectly linear and quietly
// presenting this multiplication as fact risks advertising a price StoreKit
// will not charge.
const FAMILY_BASE     = 4.99;
const FAMILY_PER_KID  = 3.00;
const familyEstimate = (kids) => FAMILY_BASE + (FAMILY_PER_KID * kids);

export default function PaywallScreen({
  onPurchase, onRestore, onSignOut, onRedeemCode, offerings, introEligible = null,
  plan = null, accountType = "personal", dark = false,
}) {
  const [purchasing, setPurchasing] = useState(false);
  const [restoring,  setRestoring]  = useState(false);
  // 0 = just me. 1..MAX_KIDS = a parent buying a seat per child.
  //
  // Defaults by ACCOUNT TYPE, which is permanent and chosen during onboarding.
  // A parent opens on Family (1 child, the cheapest tier they can actually use)
  // and a personal account opens on Pro. Landing a parent on the solo plan made
  // them hunt for the selector to find the only plan that covers their kids,
  // and landing a solo user on a family tier is a refund request.
  //
  // Both remain reachable from the selector either way — this only changes
  // where each account STARTS.
  //
  // The plan now follows the account type outright: a personal account only
  // sees Pro, a parent only sees Family (1–MAX_KIDS). Offering both on one
  // screen made each audience wade through the other's options.
  const isFamily = accountType === "parent";
  const [kids, setKids] = useState(isFamily ? 1 : 0);
  // Defaults to ANNUAL on purpose. Annual subscribers retain ~44% at 12 months
  // against ~17% for monthly — roughly a 3x LTV gap at the same price — and for
  // Drift's under-18 users it clears Apple's Ask to Buy parental approval once
  // instead of putting a recurring charge on a parent's statement every month,
  // which is the line item that gets cancelled.
  const [billing, setBilling] = useState("annual");
  // "pending" until we've read whether the reveal was already spent. Rendering
  // the offer during that read and then yanking it away would flash the price
  // at someone we're about to show the reveal to.
  const [phase, setPhase] = useState(plan ? "pending" : "offer");
  const entrance = useRef(new Animated.Value(0)).current;
  const reveal   = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    if (!plan) { setPhase("offer"); return; }
    AsyncStorage.getItem(REVEAL_SEEN_KEY)
      .then(seen => { if (!cancelled) setPhase(seen === "1" ? "offer" : "reveal"); })
      // Storage unavailable: show the offer. Erring toward the reveal would
      // risk replaying the ceremony on every launch.
      .catch(() => { if (!cancelled) setPhase("offer"); });
    return () => { cancelled = true; };
  }, [plan]);

  useEffect(() => {
    if (phase !== "reveal") return;
    reveal.setValue(0);
    Animated.timing(reveal, { toValue: 1, duration: 520, useNativeDriver: true }).start();
  }, [phase, reveal]);

  const dismissReveal = () => {
    AsyncStorage.setItem(REVEAL_SEEN_KEY, "1").catch(() => {});
    setPhase("offer");
  };

  const offering = resolveOffering(offerings);
  const monthly  = pickPackage(offering, "monthly");
  const annual   = pickPackage(offering, "annual");
  const familyPkg = kids > 0 ? pickFamilyPackage(offering, kids) : null;
  // Family tiers are monthly-only products, so the billing toggle is hidden
  // for them and the selection is forced back to monthly.
  //
  // `annualOffered` is the guard that matters. Before the offering loads we
  // assume annual exists (so the default selection paints its real placeholder
  // rather than flashing the monthly price); once it HAS loaded and there is no
  // annual product, the option disappears entirely. Without this, selecting
  // Yearly against a misconfigured offering would render "$29.99/year" and
  // "renews automatically at $29.99/year" over a package that bills monthly —
  // a false price on a paid screen, which is both a 3.1.2 rejection and the
  // kind of thing that becomes a chargeback.
  const annualOffered = !offering || !!annual;
  const effBilling = (kids === 0 && billing === "annual" && annualOffered) ? "annual" : "monthly";
  const soloPkg  = effBilling === "annual" ? annual : monthly;
  const activePkg = kids > 0 ? familyPkg : soloPkg;
  // isFreeTrial is deliberately not destructured: it describes the product, and
  // reading it here is what produced "Start with 0 free days". Eligibility is
  // the only thing that decides whether a trial is advertised.
  const { trialDays } = describeOffer(activePkg || monthly);

  // Real savings, computed from the two live StoreKit prices — never a
  // hardcoded "SAVE 50%". If the products are ever repriced independently, a
  // baked-in percentage becomes a false advertising claim on a paid screen.
  const monthlyNum = Number(monthly?.product?.price) || 0;
  const annualNum  = Number(annual?.product?.price)  || 0;
  const annualSavingsPct = (monthlyNum > 0 && annualNum > 0)
    ? Math.round((1 - (annualNum / (monthlyNum * 12))) * 100)
    : 0;

  // Placeholder until the offering loads. Kept identical to the configured
  // product so a slow network shows the right number rather than a wrong one.
  //
  // For a family tier we show the REAL package price once it loads. Before
  // that, familyEstimate(kids) is an estimate, and it is labelled as one — App Store
  // price points are not perfectly linear, so quietly presenting the
  // multiplication as fact risks advertising a price StoreKit won't charge.
  const loadedPrice = activePkg?.product?.priceString || null;
  const price = loadedPrice || (
    kids > 0            ? `about $${familyEstimate(kids).toFixed(2)}`
    : effBilling === "annual" ? FALLBACK_ANNUAL
    :                        FALLBACK_MONTHLY
  );
  const priceIsEstimate = !loadedPrice && kids > 0;
  // The trial is advertised ONLY when Apple says this user can actually have
  // it. `trialDays` describes the PRODUCT; introEligible describes the PERSON,
  // and someone who trialled and cancelled sees identical product metadata
  // while being charged immediately.
  //
  // The old `trialDays || FALLBACK_TRIAL_DAYS` fired whenever trialDays was 0 —
  // including when the product genuinely has no intro offer — so the screen
  // promised seven free days that did not exist. That constant is gone.
  //
  // While the catalogue is still loading this reads 0, so the screen offers a
  // plain subscription and upgrades to the trial once eligibility is known.
  // Flipping toward the more generous message is safe; the reverse is not.
  //
  // null (not yet checked) counts as ineligible. Wrong in the generous
  // direction costs a little conversion; wrong the other way is a false claim
  // on a payment screen, and App Store review reads that copy.
  const trial = (introEligible === true && trialDays > 0) ? trialDays : 0;
  // Annual is billed once a year; every other product on this screen is monthly.
  const perPeriod = effBilling === "annual" ? "/year" : "/month";

  const REASON_MSG = {
    no_offering:  "Plans aren't loading right now. Check your connection and try again.",
    no_package:   "The subscription isn't available right now. Please try again shortly.",
    tier_unavailable: "That family size isn't set up yet. Try a different number, or contact support.",
    not_entitled: "That didn't unlock Drift. If you were charged, tap Restore.",
    // Only reachable from redeemAppStoreCode now - it is Apple's offer-code
    // sheet, which has no Android counterpart (Play codes are redeemed in the
    // Play Store app). Buying itself is no longer iOS-only.
    ios_only:     "App Store codes can only be redeemed on iPhone.",
    store_unavailable: "Purchases aren't set up on this platform yet.",
    sdk_missing:  "Purchases aren't available in this build.",
  };

  useEffect(() => {
    Animated.spring(entrance, { toValue: 1, friction: 8, tension: 40, useNativeDriver: true }).start();
  }, [entrance]);

  const paper = dark
    ? { bg: "#0E1A13", card: "#17291D", border: "rgba(160,230,170,0.15)" }
    : { bg: "#F7F7F4", card: "#FFFFFF", border: "rgba(26,40,32,0.08)" };
  const ink = dark
    ? { deep: "#F0F7EA", mid: "#A9C4AB", faint: "#6E8A74" }
    : { deep: "#1A2820", mid: "#6B7A6E", faint: "#A8B0A8" };
  const earn = dark
    ? { green: "#7FE3A5", sageLo: "rgba(165,227,155,0.17)", deep: "#C6F2A0" }
    : { green: "#2D6B47", sageLo: "#E4ECE0", deep: "#3A6B4F" };
  const onDeep = dark ? "#16261C" : "#FAF6EE";

  const handlePurchase = async () => {
    if (purchasing || restoring) return;
    setPurchasing(true);
    try {
      const result = await onPurchase(kids > 0 ? { kids } : effBilling);
      // Success needs no navigation: proAccess flips and the gate in Drift.jsx
      // stops rendering this screen. Dismissing here as well would race it.
      if (!result?.success && result?.reason && result.reason !== "cancelled") {
        Alert.alert("Purchase failed", REASON_MSG[result.reason] || result.reason);
      }
    } catch (e) {
      Alert.alert("Something went wrong", e?.message || "Please try again.");
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestore = async () => {
    if (purchasing || restoring) return;
    setRestoring(true);
    try {
      const result = await onRestore();
      // A thrown StoreKit error (no network, App Store sign-in dismissed, a dev
      // build with no sandbox account) is not the same as "nothing to restore".
      if (!result?.success && result?.reason && !REASON_MSG[result.reason]) {
        Alert.alert(
          "Couldn't reach the App Store",
          "Check you're signed in to the App Store and connected, then try again.",
        );
      } else if (!result?.success) {
        Alert.alert(
          "Nothing to restore",
          "We couldn't find a subscription on this Apple ID. If you subscribed with a different one, sign in to that Apple ID in Settings and try again.",
        );
      }
    } catch (e) {
      Alert.alert("Restore failed", e?.message || "Please try again.");
    } finally {
      setRestoring(false);
    }
  };

  const open = (url) => Linking.openURL(url).catch(() => {});

  const busy = purchasing || restoring;

  // Nothing yet — we're still deciding which beat to show. A blank field in the
  // page colour, not a spinner: this read is a single AsyncStorage hit and a
  // spinner for it reads as a stall.
  if (phase === "pending") return <View style={{ flex: 1, backgroundColor: paper.bg }} />;

  // ── Beat one: the reveal ──────────────────────────────────────────────────
  // Their tasks, their number, their plan. No price on this screen at all — the
  // moment this becomes a pitch it stops being a delivery.
  if (phase === "reveal") {
    return (
      <View style={{ flex: 1, backgroundColor: paper.bg }}>
        <StatusBar barStyle={dark ? "light-content" : "dark-content"} />
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 26,
            paddingTop: Platform.OS === "ios" ? 96 : 56,
            paddingBottom: 40,
            flexGrow: 1,
            justifyContent: "center",
          }}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={{
            opacity: reveal,
            transform: [{ translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) }],
          }}>
            <Text style={{
              fontFamily: FF.kicker, fontSize: 10, color: earn.green,
              letterSpacing: 2.6, marginBottom: 10,
            }}>
              YOUR PLAN IS READY
            </Text>
            <Text style={{
              fontFamily: FF.display, fontSize: 34, color: ink.deep,
              letterSpacing: -0.6, lineHeight: 40,
            }}>
              {plan.taskCount} {plan.taskCount === 1 ? "task" : "tasks"},
            </Text>
            <Text style={{
              fontFamily: FF.display, fontSize: 34, color: earn.green,
              letterSpacing: -0.6, lineHeight: 40, marginBottom: 14,
            }}>
              {plan.minutesPerDay} minutes a day
            </Text>
            <View style={{ height: 14 }} />

            <View style={{
              backgroundColor: paper.card, borderRadius: 20, padding: 20,
              borderWidth: 1, borderColor: paper.border, gap: 13, marginBottom: 30,
            }}>
              {plan.taskTitles.map((title, i) => (
                <View key={`${title}-${i}`} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View style={{
                    width: 22, height: 22, borderRadius: 11,
                    backgroundColor: earn.sageLo,
                    alignItems: "center", justifyContent: "center",
                  }}>
                    <CheckIcon size={12} color={earn.green} />
                  </View>
                  <Text style={{ fontFamily: FF.bodyMed, fontSize: 15, color: ink.deep, flex: 1 }}>
                    {title}
                  </Text>
                </View>
              ))}
            </View>

            <TouchableOpacity
              onPress={dismissReveal}
              activeOpacity={0.85}
              style={{
                paddingVertical: 17, borderRadius: 16,
                backgroundColor: earn.deep,
                alignItems: "center", justifyContent: "center",
                flexDirection: "row", gap: 8,
              }}
            >
              <Text style={{ fontFamily: FF.bodyBold, fontSize: 13, color: onDeep, letterSpacing: 1.6 }}>
                TURN THE LOCK ON
              </Text>
              <LockIcon size={14} color={onDeep} />
            </TouchableOpacity>
          </Animated.View>
        </ScrollView>
      </View>
    );
  }

  // ── Beat two: the offer ───────────────────────────────────────────────────
  // Deliberately sparse. The simplest paywalls convert best: a headline, three
  // short benefits, the plan, one button. Everything Apple requires is still
  // here (price + period on the plan, trial terms and auto-renewal in the one
  // line under the button, Restore, Terms, Privacy) — just not repeated.
  const periodWord = perPeriod === "/year" ? "year" : "month";
  const terms = trial
    ? `${trial} days free, then ${price}/${periodWord}. Renews automatically — cancel anytime in Settings.`
    : `${price}/${periodWord}. Renews automatically — cancel anytime in Settings.`;
  const bullets = isFamily
    ? ["You set the rules", "They earn screen time with real tasks", "An account for every kid"]
    : ["Apps stay locked until you earn time", "Photo proof on every task", "Streaks, levels and friends"];

  const planTile = (id, label, sub, on, onPress, badge) => (
    <TouchableOpacity
      key={id}
      onPress={onPress}
      activeOpacity={0.85}
      style={{
        flex: 1, paddingVertical: 14, paddingHorizontal: 14,
        borderRadius: 16, borderWidth: 1.6,
        borderColor: on ? earn.green : paper.border,
        backgroundColor: on ? earn.sageLo : paper.card,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ fontFamily: FF.bodyMed, fontSize: 14, color: on ? earn.green : ink.deep }}>{label}</Text>
        {badge ? (
          <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: earn.deep }}>
            <Text style={{ fontFamily: FF.bodyBold, fontSize: 9, color: onDeep, letterSpacing: 0.6 }}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={{ fontFamily: FF.display, fontSize: 20, color: ink.deep, marginTop: 4 }}>{sub}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1, backgroundColor: paper.bg }}>
      <StatusBar barStyle={dark ? "light-content" : "dark-content"} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 26,
          paddingTop: Platform.OS === "ios" ? 88 : 48,
          paddingBottom: 32,
          flexGrow: 1,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{
          flex: 1,
          opacity: entrance,
          transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
        }}>
          <Text style={{
            fontFamily: FF.display, fontSize: 38, color: ink.deep,
            letterSpacing: -0.6, lineHeight: 44, marginBottom: 26,
          }}>
            {/* `trial` alone, not `isFreeTrial || trial`: isFreeTrial describes
                the product, and read "Start with 0 free days" to the ineligible. */}
            {isFamily
              ? (trial ? `Try Drift Family free for ${trial} days` : "Drift Family")
              : (trial ? `Try Drift free for ${trial} days` : "Unlock Drift")}
          </Text>

          <View style={{ gap: 14, marginBottom: 32 }}>
            {bullets.map((b) => (
              <View key={b} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={{
                  width: 24, height: 24, borderRadius: 12, backgroundColor: earn.sageLo,
                  alignItems: "center", justifyContent: "center",
                }}>
                  <CheckIcon size={13} color={earn.green} />
                </View>
                <Text style={{ fontFamily: FF.bodyMed, fontSize: 16, color: ink.deep, flex: 1 }}>{b}</Text>
              </View>
            ))}
          </View>

          {/* The plan. Family: how many kids (children never pay; the parent
              buys a seat per child). Personal: yearly or monthly. */}
          {isFamily ? (
            <>
              <View style={{
                flexDirection: "row", gap: 6, padding: 4, borderRadius: 14, marginBottom: 12,
                backgroundColor: dark ? "rgba(232,245,236,0.06)" : "#EDEEE8",
              }}>
                {Array.from({ length: MAX_KIDS }, (_, i) => i + 1).map(n => {
                  const on = kids === n;
                  return (
                    <TouchableOpacity
                      key={n}
                      onPress={() => setKids(n)}
                      activeOpacity={0.8}
                      accessibilityLabel={`${n} ${n === 1 ? "kid" : "kids"}`}
                      style={{
                        flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: "center",
                        backgroundColor: on ? paper.card : "transparent",
                        borderWidth: on ? 1.4 : 0, borderColor: earn.green,
                      }}
                    >
                      <Text style={{ fontFamily: on ? FF.bodyBold : FF.bodyMed, fontSize: 15, color: on ? earn.green : ink.mid }}>
                        {n}
                      </Text>
                      <Text style={{ fontFamily: FF.body, fontSize: 10, color: on ? earn.green : ink.faint }}>
                        {n === 1 ? "kid" : "kids"}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={{ flexDirection: "row" }}>
                {planTile("family", `${kids} ${kids === 1 ? "kid" : "kids"}`, `${price}/mo`, true, () => {})}
              </View>
            </>
          ) : annualOffered ? (
            <View style={{ flexDirection: "row", gap: 10 }}>
              {/* The savings badge is computed from the two live prices, never hardcoded. */}
              {planTile("annual", "Yearly", `${annual?.product?.priceString || FALLBACK_ANNUAL}/yr`,
                effBilling === "annual", () => setBilling("annual"),
                annualSavingsPct > 0 ? `SAVE ${annualSavingsPct}%` : null)}
              {planTile("monthly", "Monthly", `${monthly?.product?.priceString || FALLBACK_MONTHLY}/mo`,
                effBilling === "monthly", () => setBilling("monthly"))}
            </View>
          ) : (
            <View style={{ flexDirection: "row" }}>
              {planTile("monthly", "Monthly", `${price}/mo`, true, () => {})}
            </View>
          )}

          <View style={{ flex: 1, minHeight: 28 }} />

          <TouchableOpacity
            onPress={handlePurchase}
            disabled={busy}
            activeOpacity={0.85}
            style={{
              paddingVertical: 18, borderRadius: 16,
              backgroundColor: busy ? earn.sageLo : earn.deep,
              alignItems: "center", justifyContent: "center",
            }}
          >
            {purchasing
              ? <Spinner size={22} color={onDeep} />
              : <Text style={{ fontFamily: FF.bodyBold, fontSize: 16, color: onDeep }}>
                  {trial ? "Start free trial" : "Continue"}
                </Text>}
          </TouchableOpacity>

          {/* Apple 3.1.2: trial length, what it converts to, auto-renewal, how to cancel. */}
          <Text style={{
            fontFamily: FF.body, fontSize: 11, color: ink.faint,
            textAlign: "center", lineHeight: 16, marginTop: 12,
          }}>
            {terms}{priceIsEstimate ? " Final price shown by the App Store." : ""}
          </Text>

          {/* Restore, Terms, Privacy (all mandatory), cohort code, sign out — one quiet row. */}
          <View style={{
            flexDirection: "row", flexWrap: "wrap", justifyContent: "center",
            columnGap: 16, rowGap: 6, marginTop: 18,
          }}>
            <TouchableOpacity onPress={handleRestore} disabled={busy}>
              {restoring
                ? <Spinner size={14} color={ink.mid} />
                : <Text style={{ fontFamily: FF.body, fontSize: 12, color: ink.mid }}>Restore</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => open(TERMS_URL)}>
              <Text style={{ fontFamily: FF.body, fontSize: 12, color: ink.faint }}>Terms</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => open(PRIVACY_URL)}>
              <Text style={{ fontFamily: FF.body, fontSize: 12, color: ink.faint }}>Privacy</Text>
            </TouchableOpacity>
            {!!onRedeemCode && (
              <TouchableOpacity onPress={onRedeemCode} disabled={busy}>
                <Text style={{ fontFamily: FF.body, fontSize: 12, color: ink.faint }}>Have a code?</Text>
              </TouchableOpacity>
            )}
            {/* The way out: this paywall has no dismiss, so sign-out must exist. */}
            <TouchableOpacity onPress={onSignOut}>
              <Text style={{ fontFamily: FF.body, fontSize: 12, color: ink.faint }}>Sign out</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}
