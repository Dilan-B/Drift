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
 */
import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, Platform,
  Animated, Alert, Linking, StatusBar,
} from "react-native";
import { FF } from "./theme";
import { SparkleIcon, CheckIcon, ShieldKeyIcon, ChartIcon, LockIcon } from "./Icons";
import { Spinner } from "./Skeleton";
import {
  resolveOffering, pickPackage, pickFamilyPackage, describeOffer, MAX_KIDS,
} from "./useSubscription";

const TERMS_URL   = "https://dilan-b.github.io/Drift/terms.html";
const PRIVACY_URL = "https://dilan-b.github.io/Drift/privacy.html";

// What the subscription actually buys. Written as capabilities rather than
// feature names — "AI-valued rewards" means nothing to someone who has used the
// app for ninety seconds.
const FEATURES = [
  { Icon: ShieldKeyIcon, title: "Your apps stay locked", desc: "Until you've earned the time back" },
  { Icon: SparkleIcon,   title: "Proof, not the honour system", desc: "Photo and video checks on every task" },
  { Icon: ChartIcon,     title: "Streaks, levels and the Grove", desc: "Your progress, and your friends'" },
];

export default function PaywallScreen({
  onPurchase, onRestore, onSignOut, offerings, dark = false,
}) {
  const [purchasing, setPurchasing] = useState(false);
  const [restoring,  setRestoring]  = useState(false);
  // 0 = just me. 1..MAX_KIDS = a parent paying $0.99/mo per child.
  // Defaults to 0 because most users are not parents, and a family plan chosen
  // by accident is a refund request.
  const [kids, setKids] = useState(0);
  const entrance = useRef(new Animated.Value(0)).current;

  const offering = resolveOffering(offerings);
  const monthly  = pickPackage(offering, "monthly");
  const familyPkg = kids > 0 ? pickFamilyPackage(offering, kids) : null;
  const activePkg = kids > 0 ? familyPkg : monthly;
  const { priceString, trialDays, isFreeTrial } = describeOffer(activePkg || monthly);

  // Placeholder until the offering loads. Kept identical to the configured
  // product so a slow network shows the right number rather than a wrong one.
  //
  // For a family tier we show the REAL package price once it loads. Before
  // that, 0.99 x kids is an estimate, and it is labelled as one — App Store
  // price points are not perfectly linear, so quietly presenting the
  // multiplication as fact risks advertising a price StoreKit won't charge.
  const loadedPrice = activePkg?.product?.priceString || null;
  const price = loadedPrice || (kids > 0 ? `about $${(0.99 * kids).toFixed(2)}` : "$0.99");
  const priceIsEstimate = !loadedPrice && kids > 0;
  const trial = trialDays || 3;

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
      const result = await onPurchase(kids > 0 ? { kids } : "monthly");
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
            ONE LAST THING
          </Text>
          <Text style={{
            fontFamily: FF.display, fontSize: 36, color: ink.deep,
            letterSpacing: -0.6, lineHeight: 42, marginBottom: 10,
          }}>
            {isFreeTrial || trial ? `Start with ${trial} free days` : "Unlock Drift"}
          </Text>
          <Text style={{
            fontFamily: FF.body, fontSize: 15, color: ink.mid,
            lineHeight: 22, marginBottom: 30,
          }}>
            Drift only works if the lock is real. That takes a server, an AI
            reviewing your proof, and someone keeping it running.
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
                <Text style={{ fontFamily: FF.body, fontSize: 14, color: ink.mid }}>/month</Text>
              </Text>
            </View>
            <Text style={{ fontFamily: FF.body, fontSize: 13, color: ink.mid, marginTop: 8, lineHeight: 19 }}>
              {trial
                ? `Free for ${trial} days, then ${price} per month. Cancel any time before the trial ends and you won't be charged.`
                : `${price} per month.`}
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
            Renews automatically at {price}/month until cancelled. Cancel any
            time in Settings › Apple ID › Subscriptions. Payment is charged to
            your Apple ID.
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
