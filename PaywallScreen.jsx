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
import { SparkleIcon, CheckIcon, ShieldKeyIcon, ChartIcon, LockIcon } from "./Icons";
import { Spinner } from "./Skeleton";
import {
  resolveOffering, pickPackage, pickFamilyPackage, describeOffer, MAX_KIDS,
} from "./useSubscription";

const TERMS_URL   = "https://dilan-b.github.io/Drift/terms.html";
const PRIVACY_URL = "https://dilan-b.github.io/Drift/privacy.html";

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
const FALLBACK_TRIAL_DAYS = 7;

// Per-seat estimate for a family tier before its real price loads. A base seat
// for the parent plus each child. Labelled as an estimate wherever it is shown,
// because App Store price points are not perfectly linear and quietly
// presenting this multiplication as fact risks advertising a price StoreKit
// will not charge.
const FAMILY_BASE     = 4.99;
const FAMILY_PER_KID  = 3.00;
const familyEstimate = (kids) => FAMILY_BASE + (FAMILY_PER_KID * kids);

// What the subscription actually buys. Written as capabilities rather than
// feature names — "AI-valued rewards" means nothing to someone who has used the
// app for ninety seconds.
const FEATURES = [
  { Icon: ShieldKeyIcon, title: "Your apps stay locked", desc: "Until you've earned the time back" },
  { Icon: SparkleIcon,   title: "Proof, not the honour system", desc: "Photo and video checks on every task" },
  { Icon: ChartIcon,     title: "Streaks, levels and the Grove", desc: "Your progress, and your friends'" },
];

export default function PaywallScreen({
  onPurchase, onRestore, onSignOut, offerings, plan = null,
  accountType = "personal", dark = false,
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
  const [kids, setKids] = useState(accountType === "parent" ? 1 : 0);
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
  const { trialDays, isFreeTrial } = describeOffer(activePkg || monthly);

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
  const trial = trialDays || FALLBACK_TRIAL_DAYS;
  // Annual is billed once a year; every other product on this screen is monthly.
  const perPeriod = effBilling === "annual" ? "/year" : "/month";

  const REASON_MSG = {
    no_offering:  "Plans aren't loading right now. Check your connection and try again.",
    no_package:   "The subscription isn't available right now. Please try again shortly.",
    tier_unavailable: "That family size isn't set up yet. Try a different number, or contact support.",
    not_entitled: "That didn't unlock Drift. If you were charged, tap Restore.",
    ios_only:     "Purchases are only available on iOS right now.",
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
      if (!result?.success) {
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
            <Text style={{
              fontFamily: FF.body, fontSize: 15, color: ink.mid,
              lineHeight: 22, marginBottom: 28,
            }}>
              That's what your {plan.taskCount === 1 ? "task is" : "tasks are"} worth once
              you've done {plan.taskCount === 1 ? "it" : "them"}. Everything else on your
              phone stays locked until you have.
            </Text>

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
  return (
    <View style={{ flex: 1, backgroundColor: paper.bg }}>
      <StatusBar barStyle={dark ? "light-content" : "dark-content"} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 26,
          paddingTop: Platform.OS === "ios" ? 72 : 40,
          paddingBottom: 40,
          flexGrow: 1,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{
          opacity: entrance,
          transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
        }}>
          <Text style={{
            fontFamily: FF.kicker, fontSize: 10, color: earn.green,
            letterSpacing: 2.6, marginBottom: 10,
          }}>
            {kids > 0 ? "ONE STEP LEFT" : plan ? "ONE STEP LEFT" : "ONE LAST THING"}
          </Text>
          <Text style={{
            fontFamily: FF.display, fontSize: 36, color: ink.deep,
            letterSpacing: -0.6, lineHeight: 42, marginBottom: 10,
          }}>
            {isFreeTrial || trial ? `Start with ${trial} free days` : "Unlock Drift"}
          </Text>
          {/* The plan stays visible on the offer, not just on the reveal. The
              user is deciding whether to pay for a specific thing they built —
              taking it off screen at the moment of the ask turns it back into a
              generic subscription prompt. */}
          <Text style={{
            fontFamily: FF.body, fontSize: 15, color: ink.mid,
            lineHeight: 22, marginBottom: 30,
          }}>
            {plan
              ? `Your ${plan.taskCount} ${plan.taskCount === 1 ? "task is" : "tasks are"} set up and worth ${plan.minutesPerDay} minutes a day. Drift only works if the lock is real — that takes a server, an AI reviewing your proof, and someone keeping it running.`
              : "Drift only works if the lock is real. That takes a server, an AI reviewing your proof, and someone keeping it running."}
          </Text>

          {/* What you get */}
          <View style={{ gap: 16, marginBottom: 30 }}>
            {FEATURES.map(({ Icon, title, desc }) => (
              <View key={title} style={{ flexDirection: "row", alignItems: "flex-start", gap: 14 }}>
                <View style={{
                  width: 34, height: 34, borderRadius: 17,
                  backgroundColor: earn.sageLo,
                  alignItems: "center", justifyContent: "center",
                }}>
                  <Icon size={17} color={earn.green} />
                </View>
                <View style={{ flex: 1, paddingTop: 2 }}>
                  <Text style={{ fontFamily: FF.bodyMed, fontSize: 15, color: ink.deep }}>{title}</Text>
                  <Text style={{ fontFamily: FF.body, fontSize: 13, color: ink.mid, marginTop: 2, lineHeight: 18 }}>
                    {desc}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          {/* Who is this for. Children never pay for their own account — a
              parent buys a seat per child and every child in the family
              inherits access. */}
          <Text style={{
            fontFamily: FF.kicker, fontSize: 9, color: ink.faint,
            letterSpacing: 2, marginBottom: 10,
          }}>
            WHO'S USING DRIFT
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
            {[0, 1, 2, 3, 4, 5].slice(0, MAX_KIDS + 1).map(n => {
              const on = kids === n;
              return (
                <TouchableOpacity
                  key={n}
                  onPress={() => setKids(n)}
                  activeOpacity={0.8}
                  style={{
                    paddingVertical: 10, paddingHorizontal: 14,
                    borderRadius: 12, borderWidth: 1.4,
                    borderColor: on ? earn.green : paper.border,
                    backgroundColor: on ? earn.sageLo : "transparent",
                  }}
                >
                  <Text style={{
                    fontFamily: FF.bodyMed, fontSize: 13,
                    color: on ? earn.green : ink.mid,
                  }}>
                    {n === 0 ? "Just me" : n === 1 ? "1 kid" : `${n} kids`}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {kids > 0 && (
            <Text style={{
              fontFamily: FF.body, fontSize: 12, color: ink.mid,
              lineHeight: 18, marginTop: -12, marginBottom: 18,
            }}>
              Your {kids === 1 ? "child gets their" : "children get"} own account
              at no extra charge beyond the seat. You can change this later in
              Settings — Apple prorates the difference.
            </Text>
          )}

          {/* Billing period. Solo only — family tiers are monthly-only products,
              so offering a toggle there would advertise something StoreKit
              cannot sell. */}
          {kids === 0 && annualOffered && (
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}>
              {[
                { id: "annual",  label: "Yearly",  sub: annual?.product?.priceString || FALLBACK_ANNUAL },
                { id: "monthly", label: "Monthly", sub: monthly?.product?.priceString || FALLBACK_MONTHLY },
              ].map(opt => {
                const on = effBilling === opt.id;
                return (
                  <TouchableOpacity
                    key={opt.id}
                    onPress={() => setBilling(opt.id)}
                    activeOpacity={0.85}
                    style={{
                      flex: 1, paddingVertical: 14, paddingHorizontal: 14,
                      borderRadius: 16, borderWidth: 1.6,
                      borderColor: on ? earn.green : paper.border,
                      backgroundColor: on ? earn.sageLo : paper.card,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={{ fontFamily: FF.bodyMed, fontSize: 14, color: on ? earn.green : ink.deep }}>
                        {opt.label}
                      </Text>
                      {/* Only rendered off two REAL prices — never a hardcoded claim. */}
                      {opt.id === "annual" && annualSavingsPct > 0 && (
                        <View style={{
                          paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
                          backgroundColor: earn.deep,
                        }}>
                          <Text style={{ fontFamily: FF.bodyBold, fontSize: 9, color: onDeep, letterSpacing: 0.6 }}>
                            SAVE {annualSavingsPct}%
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text style={{ fontFamily: FF.body, fontSize: 12, color: ink.mid, marginTop: 3 }}>
                      {opt.sub}{opt.id === "annual" ? " a year" : " a month"}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* The offer. Apple requires the price, the period, the trial length
              and what it converts to, all BEFORE the purchase button. */}
          <View style={{
            backgroundColor: paper.card,
            borderRadius: 20, padding: 20, marginBottom: 18,
            borderWidth: 1.5, borderColor: earn.green,
          }}>
            <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
              <Text style={{ fontFamily: FF.bodyMed, fontSize: 16, color: ink.deep }}>
                {kids > 0 ? `Drift Family · ${kids} ${kids === 1 ? "kid" : "kids"}` : "Drift Pro"}
              </Text>
              <Text style={{ fontFamily: FF.display, fontSize: 26, color: ink.deep, letterSpacing: -0.4 }}>
                {price}
                <Text style={{ fontFamily: FF.body, fontSize: 14, color: ink.mid }}>{perPeriod}</Text>
              </Text>
            </View>
            <Text style={{ fontFamily: FF.body, fontSize: 13, color: ink.mid, marginTop: 8, lineHeight: 19 }}>
              {trial
                ? `Free for ${trial} days, then ${price} ${perPeriod === "/year" ? "per year" : "per month"}. Cancel any time before the trial ends and you won't be charged.`
                : `${price} ${perPeriod === "/year" ? "per year" : "per month"}.`}
              {priceIsEstimate ? " Exact price is confirmed by the App Store before you pay." : ""}
            </Text>
          </View>

          <TouchableOpacity
            onPress={handlePurchase}
            disabled={busy}
            activeOpacity={0.85}
            style={{
              paddingVertical: 17, borderRadius: 16,
              backgroundColor: busy ? earn.sageLo : earn.deep,
              alignItems: "center", justifyContent: "center",
              flexDirection: "row", gap: 8,
            }}
          >
            {purchasing
              ? <Spinner size={22} color={onDeep} />
              : (
                <>
                  <Text style={{ fontFamily: FF.bodyBold, fontSize: 13, color: onDeep, letterSpacing: 1.6 }}>
                    {trial ? `START MY ${trial} FREE DAYS` : "SUBSCRIBE"}
                  </Text>
                  <CheckIcon size={14} color={onDeep} />
                </>
              )}
          </TouchableOpacity>

          {/* Auto-renewal disclosure. Required verbatim-ish by 3.1.2. */}
          <Text style={{
            fontFamily: FF.body, fontSize: 11, color: ink.faint,
            textAlign: "center", lineHeight: 17, marginTop: 14,
          }}>
            Renews automatically at {price}{perPeriod} until cancelled. Cancel
            any time in Settings › Apple ID › Subscriptions. Payment is charged
            to your Apple ID.
          </Text>

          {/* Restore — mandatory. */}
          <TouchableOpacity
            onPress={handleRestore}
            disabled={busy}
            style={{ paddingVertical: 16, alignItems: "center" }}
          >
            {restoring
              ? <Spinner size={16} color={ink.mid} />
              : <Text style={{ fontFamily: FF.bodyMed, fontSize: 13, color: earn.green }}>
                  Restore purchase
                </Text>}
          </TouchableOpacity>

          {/* Legal links — mandatory. */}
          <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6 }}>
            <TouchableOpacity onPress={() => open(TERMS_URL)}>
              <Text style={{ fontFamily: FF.body, fontSize: 11, color: ink.faint, textDecorationLine: "underline" }}>
                Terms of Use
              </Text>
            </TouchableOpacity>
            <Text style={{ fontFamily: FF.body, fontSize: 11, color: ink.faint }}>·</Text>
            <TouchableOpacity onPress={() => open(PRIVACY_URL)}>
              <Text style={{ fontFamily: FF.body, fontSize: 11, color: ink.faint, textDecorationLine: "underline" }}>
                Privacy Policy
              </Text>
            </TouchableOpacity>
          </View>

          {/* The way out. Not a dismiss — this paywall has none — but a user
              must never be trapped in an account they can't leave. */}
          <TouchableOpacity onPress={onSignOut} style={{ paddingVertical: 18, alignItems: "center" }}>
            <Text style={{ fontFamily: FF.body, fontSize: 12, color: ink.faint }}>
              Sign out
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </View>
  );
}
