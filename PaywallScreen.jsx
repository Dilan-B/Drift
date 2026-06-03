/**
 * PaywallScreen.jsx
 * Shown when the 7-day free trial expires.
 * $2.99/month subscription to unlock the challenge feature.
 *
 * Payment is mocked here — wire in react-native-purchases (RevenueCat)
 * when ready for production.
 */
import React, { useEffect, useState } from "react";
import {
  Alert, StyleSheet, Text, TouchableOpacity, View, ScrollView,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";

const INSTALL_KEY    = "drift_install_date";
const TRIAL_DAYS     = 7;
const MONTHLY_PRICE  = "$2.99";

const ink   = { void: "#16120E", deep: "#1E1B15" };
const terra = "#D4622A";
const FD    = "Georgia";

// ── Trial logic ──────────────────────────────────────────────

export async function initTrial() {
  const existing = await AsyncStorage.getItem(INSTALL_KEY);
  if (!existing) {
    await AsyncStorage.setItem(INSTALL_KEY, new Date().toISOString());
  }
}

export async function getTrialStatus(userId) {
  const raw = await AsyncStorage.getItem(INSTALL_KEY);
  const installDate = raw ? new Date(raw) : new Date();
  const daysElapsed = (Date.now() - installDate.getTime()) / (1000 * 60 * 60 * 24);
  const trialActive = daysElapsed < TRIAL_DAYS;
  const daysLeft    = Math.max(0, Math.ceil(TRIAL_DAYS - daysElapsed));

  // Check Supabase subscription status
  let subActive = false;
  if (userId) {
    const { data } = await supabase
      .from("profiles")
      .select("sub_active, sub_expires")
      .eq("id", userId)
      .single();
    if (data?.sub_active) {
      const expires = data.sub_expires ? new Date(data.sub_expires) : null;
      subActive = !expires || expires > new Date();
    }
  }

  return { trialActive, daysLeft, subActive, isPremium: trialActive || subActive };
}

// ── Paywall screen ───────────────────────────────────────────

const FEATURES = [
  { icon: "🏆", title: "Challenge friends",    sub: "Dare or compete — winner gets bonus time" },
  { icon: "📊", title: "Full leaderboard",     sub: "See weekly rankings in your friend group"  },
  { icon: "⚡", title: "Streak bonuses",       sub: "Complete 7 days straight → double screen time" },
  { icon: "🔔", title: "Challenge alerts",     sub: "Push notifications when a friend dares you"  },
];

export default function PaywallScreen({ userId, daysLeft, onSubscribe, onClose }) {
  const [purchasing, setPurchasing] = useState(false);

  const handleSubscribe = async () => {
    setPurchasing(true);
    try {
      // ── Production: replace this block with RevenueCat purchase ──
      // const { customerInfo } = await Purchases.purchasePackage(pkg);
      // if (customerInfo.entitlements.active['premium']) { ... }

      // Mock: mark as subscribed in Supabase
      const expires = new Date();
      expires.setMonth(expires.getMonth() + 1);
      await supabase.from("profiles").update({
        sub_active:  true,
        sub_expires: expires.toISOString(),
      }).eq("id", userId);

      onSubscribe?.();
    } catch (e) {
      Alert.alert("Purchase failed", e.message || "Please try again.");
    } finally {
      setPurchasing(false);
    }
  };

  const trialEnded = daysLeft === 0;

  return (
    <View style={s.container}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Close (only if trial still active — once expired, user must subscribe or use free tier) */}
        {!trialEnded && onClose && (
          <TouchableOpacity onPress={onClose} style={s.closeBtn}>
            <Text style={s.closeBtnText}>✕</Text>
          </TouchableOpacity>
        )}

        {/* Hero */}
        <View style={s.hero}>
          <Text style={s.heroEmoji}>🏆</Text>
          {trialEnded ? (
            <>
              <Text style={s.heroTitle}>Your free trial ended</Text>
              <Text style={s.heroSub}>
                Subscribe to keep challenging friends{"\n"}and see their screen time.
              </Text>
            </>
          ) : (
            <>
              <Text style={s.heroTitle}>
                {daysLeft} day{daysLeft !== 1 ? "s" : ""} left in your trial
              </Text>
              <Text style={s.heroSub}>
                After that, challenges are locked.{"\n"}Subscribe to keep going.
              </Text>
            </>
          )}
        </View>

        {/* Feature list */}
        <View style={s.features}>
          {FEATURES.map((f, i) => (
            <View key={i} style={s.featureRow}>
              <Text style={{ fontSize: 22, width: 36, textAlign: "center" }}>{f.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.featureTitle}>{f.title}</Text>
                <Text style={s.featureSub}>{f.sub}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Pricing */}
        <View style={s.pricingBox}>
          <Text style={s.priceLabel}>Monthly</Text>
          <Text style={s.price}>{MONTHLY_PRICE}<Text style={s.pricePer}> / month</Text></Text>
          <Text style={s.priceSub}>Cancel anytime · first 7 days free</Text>
        </View>

        {/* CTA */}
        <TouchableOpacity
          onPress={handleSubscribe}
          disabled={purchasing}
          style={[s.ctaBtn, purchasing && { opacity: 0.6 }]}
        >
          <Text style={s.ctaBtnText}>
            {purchasing ? "Processing…" : `Subscribe for ${MONTHLY_PRICE}/mo`}
          </Text>
        </TouchableOpacity>

        <Text style={s.legalText}>
          Subscription auto-renews monthly. Cancel in your App Store settings.
        </Text>
      </ScrollView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: ink.void },
  scroll:    { padding: 24, paddingBottom: 60, alignItems: "center" },
  closeBtn: {
    alignSelf: "flex-end", width: 32, height: 32, borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.07)", alignItems: "center", justifyContent: "center",
    marginBottom: 8,
  },
  closeBtnText: { color: "#8A7E70", fontSize: 14 },
  hero: { alignItems: "center", marginBottom: 36, marginTop: 20 },
  heroEmoji: { fontSize: 56, marginBottom: 16 },
  heroTitle: {
    fontFamily: FD, fontSize: 26, color: "#F0E8D8",
    fontStyle: "italic", fontWeight: "300", textAlign: "center", marginBottom: 10,
  },
  heroSub: { fontSize: 14, color: "#6A5848", textAlign: "center", lineHeight: 22 },
  features: {
    width: "100%", marginBottom: 28, gap: 2,
    borderWidth: 0.5, borderColor: "rgba(255,255,255,0.07)", borderRadius: 14, overflow: "hidden",
  },
  featureRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, backgroundColor: "rgba(255,255,255,0.03)",
    borderBottomWidth: 0.5, borderColor: "rgba(255,255,255,0.06)",
  },
  featureTitle: { color: "#D0C8BC", fontSize: 14, fontWeight: "500", marginBottom: 2 },
  featureSub:   { color: "#5A4838", fontSize: 12, lineHeight: 17 },
  pricingBox: {
    width: "100%", padding: 20, borderRadius: 14, alignItems: "center",
    borderWidth: 0.5, borderColor: "rgba(212,98,42,0.3)",
    backgroundColor: "rgba(212,98,42,0.07)", marginBottom: 20,
  },
  priceLabel: { fontSize: 11, color: terra, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 },
  price:      { fontFamily: FD, fontSize: 42, color: "#F0E8D8", fontWeight: "300" },
  pricePer:   { fontSize: 18, color: "#6A5848" },
  priceSub:   { fontSize: 12, color: "#4A3828", marginTop: 6 },
  ctaBtn: {
    width: "100%", padding: 16, borderRadius: 14,
    backgroundColor: terra, alignItems: "center", marginBottom: 14,
  },
  ctaBtnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  legalText: { fontSize: 11, color: "#3A2E28", textAlign: "center", lineHeight: 17 },
});
