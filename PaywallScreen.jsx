import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Platform,
  StatusBar, Animated, Alert, ActivityIndicator,
} from "react-native";
import { FF } from "./theme";
import {
  SparkleIcon, CheckIcon, ClipboardIcon, ShieldKeyIcon, ChartIcon, PhoneIcon,
} from "./Icons";
import { resolveOffering, pickPackage } from "./useSubscription";

const FEATURES = [
  { title: "AI-valued rewards", desc: "Get smarter credit for harder tasks" },
  { title: "Photo proof tasks", desc: "Upload photos to verify completion" },
  { title: "Unlimited tasks", desc: "Free users are limited to 5 active tasks" },
  { title: "Recurring tasks", desc: "Auto-schedule daily and weekly tasks" },
  { title: "Blocked hours", desc: "Set custom hours to auto-block apps" },
  { title: "Challenges", desc: "Compete with friends on goals" },
  { title: "Choose your apps", desc: "Free blocks all social & entertainment" },
];

export default function PaywallScreen({ onClose, onPurchase, onRestore, offerings, dark = false }) {
  const [plan, setPlan] = useState("annual");
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const entrance = useRef(new Animated.Value(0)).current;

  // Real App Store prices from RevenueCat (falls back to placeholders until the
  // offering loads). Showing the actual charged price avoids mismatch/rejection.
  const offering   = resolveOffering(offerings);
  const annualPkg  = pickPackage(offering, "annual");
  const monthlyPkg = pickPackage(offering, "monthly");
  // Use the live store price; fall back to current list prices until it loads.
  const annualNum    = annualPkg?.product?.price ?? 29.99;
  const monthlyNum   = monthlyPkg?.product?.price ?? 2.99;
  const annualPrice  = annualPkg?.product?.priceString || "$29.99";
  const monthlyPrice = monthlyPkg?.product?.priceString || "$2.99";
  const annualPerMo  = `$${(annualNum / 12).toFixed(2)}/mo — best value`;
  // Real savings of annual vs paying monthly, computed from the actual prices.
  const savingsPct   = monthlyNum > 0 ? Math.round((1 - (annualNum / 12) / monthlyNum) * 100) : 0;

  const REASON_MSG = {
    no_offering: "Plans aren't available right now. Please try again shortly.",
    no_package: "This plan isn't available right now.",
    monthly_unavailable: "The monthly plan isn't available yet — try Annual.",
    not_entitled: "That didn't unlock Pro. If you were charged, tap Restore.",
    ios_only: "Purchases are only available on iOS.",
  };

  useEffect(() => {
    Animated.spring(entrance, { toValue: 1, friction: 8, tension: 40, useNativeDriver: true }).start();
  }, []);

  const paper = dark
    ? { bg: "#0E1A13", card: "#17291D", border: "rgba(160,230,170,0.15)" }
    : { bg: "#F7F7F4", card: "#FFFFFF", border: "rgba(26,40,32,0.08)" };
  const ink = dark
    ? { deep: "#F0F7EA", mid: "#A9C4AB", faint: "#6E8A74" }
    : { deep: "#1A2820", mid: "#6B7A6E", faint: "#A8B0A8" };
  const earn = dark
    ? { green: "#7FE3A5", greenD: "#B4F0C4", sageLo: "rgba(165,227,155,0.17)", deep: "#C6F2A0" }
    : { green: "#2D6B47", greenD: "#1F3A2A", sageLo: "#E4ECE0", deep: "#1F3A2A" };

  const handlePurchase = async () => {
    setPurchasing(true);
    try {
      const result = await onPurchase(plan);
      if (result?.success) {
        onClose();
      } else if (result?.reason === "cancelled") {
        // user cancelled
      } else if (result?.reason) {
        Alert.alert("Purchase failed", REASON_MSG[result.reason] || result.reason);
      }
    } catch (e) {
      Alert.alert("Error", e?.message || "Something went wrong.");
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    try {
      const result = await onRestore();
      if (result?.success) {
        Alert.alert("Restored", "Your Pro access has been restored.");
        onClose();
      } else {
        Alert.alert("No subscription found", "We couldn't find an active subscription for this Apple ID.");
      }
    } catch {
      Alert.alert("Error", "Couldn't restore purchases. Try again.");
    } finally {
      setRestoring(false);
    }
  };

  const safeTop = Platform.OS === "ios" ? 54 : (StatusBar.currentHeight || 24) + 8;
  const isAnnual = plan === "annual";

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: paper.bg, zIndex: 300 }]}>
      <Animated.ScrollView
        contentContainerStyle={{ paddingTop: safeTop + 12, paddingBottom: 200, paddingHorizontal: 20 }}
        style={{ opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [30, 0] }) }] }}
        showsVerticalScrollIndicator={false}
      >
        {/* Close */}
        <TouchableOpacity
          onPress={onClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={{ alignSelf: "flex-end", padding: 4, marginBottom: 8 }}
        >
          <Text style={{ fontSize: 28, color: ink.mid, lineHeight: 28 }}>×</Text>
        </TouchableOpacity>

        {/* Header */}
        <Text style={{ fontFamily: FF.display, fontSize: 28, color: ink.deep, textAlign: "center", marginBottom: 4 }}>
          Upgrade to Pro
        </Text>
        <Text style={{ fontFamily: FF.body, fontSize: 15, color: ink.mid, textAlign: "center", marginBottom: 24 }}>
          Unlock the full Drift experience
        </Text>

        {/* Plan selector */}
        <View style={{ flexDirection: "row", gap: 10, marginBottom: 20 }}>
          {/* Annual */}
          <TouchableOpacity
            onPress={() => setPlan("annual")}
            activeOpacity={0.8}
            style={{
              flex: 1, padding: 16, borderRadius: 16,
              borderWidth: 2,
              borderColor: isAnnual ? earn.green : paper.border,
              backgroundColor: isAnnual ? earn.sageLo : paper.card,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <Text style={{ fontFamily: FF.bodyBold, fontSize: 12, color: isAnnual ? earn.green : ink.mid, letterSpacing: 0.8 }}>
                ANNUAL
              </Text>
              {savingsPct > 0 && (
                <View style={{ backgroundColor: earn.green, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                  <Text style={{ fontFamily: FF.bodyBold, fontSize: 9, color: dark ? "#16261C" : "#fff", letterSpacing: 0.5 }}>SAVE {savingsPct}%</Text>
                </View>
              )}
            </View>
            <Text style={{ fontFamily: FF.bodyBold, fontSize: 22, color: ink.deep }}>
              {annualPrice}
              <Text style={{ fontFamily: FF.body, fontSize: 14, color: ink.mid }}>/year</Text>
            </Text>
            <Text style={{ fontFamily: FF.body, fontSize: 12, color: ink.mid, marginTop: 4 }}>
              {annualPerMo}
            </Text>
          </TouchableOpacity>

          {/* Monthly */}
          <TouchableOpacity
            onPress={() => setPlan("monthly")}
            activeOpacity={0.8}
            style={{
              flex: 1, padding: 16, borderRadius: 16,
              borderWidth: 2,
              borderColor: !isAnnual ? earn.green : paper.border,
              backgroundColor: !isAnnual ? earn.sageLo : paper.card,
            }}
          >
            <Text style={{ fontFamily: FF.bodyBold, fontSize: 12, color: !isAnnual ? earn.green : ink.mid, letterSpacing: 0.8, marginBottom: 8 }}>
              MONTHLY
            </Text>
            <Text style={{ fontFamily: FF.bodyBold, fontSize: 22, color: ink.deep }}>
              {monthlyPrice}
              <Text style={{ fontFamily: FF.body, fontSize: 14, color: ink.mid }}>/month</Text>
            </Text>
            <Text style={{ fontFamily: FF.body, fontSize: 12, color: ink.mid, marginTop: 4 }}>
              Flexible, cancel anytime
            </Text>
          </TouchableOpacity>
        </View>

        {/* Feature list */}
        {FEATURES.map((f, i) => (
          <View key={i} style={{
            flexDirection: "row", alignItems: "center", gap: 14,
            paddingVertical: 14, paddingHorizontal: 16,
            backgroundColor: paper.card, borderRadius: 14,
            borderWidth: 1, borderColor: paper.border,
            marginBottom: 10,
          }}>
            <View style={{
              width: 32, height: 32, borderRadius: 10,
              backgroundColor: earn.sageLo, alignItems: "center", justifyContent: "center",
            }}>
              <CheckIcon size={16} color={earn.green} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: FF.bodyMed, fontSize: 15, color: ink.deep }}>{f.title}</Text>
              <Text style={{ fontFamily: FF.body, fontSize: 12, color: ink.mid, marginTop: 2 }}>{f.desc}</Text>
            </View>
          </View>
        ))}
      </Animated.ScrollView>

      {/* Bottom CTA */}
      <View style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        paddingHorizontal: 20, paddingTop: 16,
        paddingBottom: Platform.OS === "ios" ? 40 : 24,
        backgroundColor: paper.bg,
        borderTopWidth: 1, borderTopColor: paper.border,
      }}>
        <Text style={{ fontFamily: FF.body, fontSize: 14, color: ink.mid, textAlign: "center", marginBottom: 12 }}>
          1 week free trial, then {isAnnual ? "$29.99/year" : "$2.99/month"}
        </Text>

        <TouchableOpacity
          onPress={handlePurchase}
          disabled={purchasing || restoring}
          activeOpacity={0.8}
          style={{
            backgroundColor: earn.deep, borderRadius: 16,
            paddingVertical: 16, alignItems: "center",
            opacity: purchasing ? 0.7 : 1,
          }}
        >
          {purchasing
            ? <ActivityIndicator color="#fff" />
            : <Text style={{ fontFamily: FF.bodyBold, fontSize: 16, color: dark ? "#16261C" : "#fff", letterSpacing: 0.3 }}>
                Start Free Trial
              </Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleRestore}
          disabled={purchasing || restoring}
          style={{ alignItems: "center", marginTop: 12, paddingVertical: 6 }}
        >
          {restoring
            ? <ActivityIndicator size="small" color={ink.mid} />
            : <Text style={{ fontFamily: FF.bodyMed, fontSize: 13, color: ink.mid }}>
                Restore purchase
              </Text>
          }
        </TouchableOpacity>
      </View>
    </View>
  );
}
