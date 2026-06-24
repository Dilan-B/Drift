import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Platform,
  StatusBar, Animated, Alert, ActivityIndicator,
} from "react-native";

const FK = Platform.OS === "ios" ? "Avenir-Medium" : "sans-serif-medium";
const FB = Platform.OS === "ios" ? "Avenir-Book" : "sans-serif";
const FOM = Platform.OS === "ios" ? "Avenir-Heavy" : "sans-serif-black";

const FEATURES = [
  { icon: "🤖", title: "AI-valued rewards", desc: "Get smarter credit for harder tasks" },
  { icon: "📸", title: "Photo proof tasks", desc: "Upload photos to verify completion" },
  { icon: "📋", title: "Unlimited tasks", desc: "Free users are limited to 5 active tasks" },
  { icon: "🔁", title: "Recurring tasks", desc: "Auto-schedule daily and weekly tasks" },
  { icon: "🕐", title: "Blocked hours", desc: "Set custom hours to auto-block apps" },
  { icon: "🏆", title: "Challenges", desc: "Compete with friends on goals" },
  { icon: "🎯", title: "Choose your apps", desc: "Free blocks all social & entertainment" },
];

export default function PaywallScreen({ onClose, onPurchase, onRestore, dark = false }) {
  const [plan, setPlan] = useState("annual");
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(entrance, { toValue: 1, friction: 8, tension: 40, useNativeDriver: true }).start();
  }, []);

  const paper = dark
    ? { bg: "#0b1f12", card: "#132b19", border: "#1e3d26" }
    : { bg: "#f4f9f6", card: "#fff", border: "#d6e6dc" };
  const ink = dark
    ? { deep: "#e8f0eb", mid: "#8aa694", faint: "#4a6b55" }
    : { deep: "#0b1a11", mid: "#6b8a76", faint: "#a3b8ab" };
  const earn = { terra: "#2fac72", terraLo: dark ? "#1a3d28" : "#e3f5ec" };

  const handlePurchase = async () => {
    setPurchasing(true);
    try {
      const result = await onPurchase(plan);
      if (result?.success) {
        onClose();
      } else if (result?.reason === "cancelled") {
        // user cancelled, do nothing
      } else if (result?.reason) {
        Alert.alert("Purchase failed", result.reason);
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
        Alert.alert("Restored!", "Your Pro access has been restored.");
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
        {/* Close button */}
        <TouchableOpacity
          onPress={onClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={{ alignSelf: "flex-end", padding: 4, marginBottom: 8 }}
        >
          <Text style={{ fontSize: 28, color: ink.mid, lineHeight: 28 }}>×</Text>
        </TouchableOpacity>

        {/* Header */}
        <Text style={{ fontFamily: FOM, fontSize: 28, color: ink.deep, textAlign: "center", marginBottom: 4 }}>
          Upgrade to Pro
        </Text>
        <Text style={{ fontFamily: FB, fontSize: 15, color: ink.mid, textAlign: "center", marginBottom: 24 }}>
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
              borderColor: isAnnual ? earn.terra : paper.border,
              backgroundColor: isAnnual ? earn.terraLo : paper.card,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <Text style={{ fontFamily: FOM, fontSize: 13, color: isAnnual ? earn.terra : ink.mid, letterSpacing: 0.5 }}>
                ANNUAL
              </Text>
              <View style={{ backgroundColor: earn.terra, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ fontFamily: FOM, fontSize: 9, color: "#fff", letterSpacing: 0.5 }}>SAVE 33%</Text>
              </View>
            </View>
            <Text style={{ fontFamily: FOM, fontSize: 22, color: ink.deep }}>
              $48.49
              <Text style={{ fontFamily: FB, fontSize: 14, color: ink.mid }}>/year</Text>
            </Text>
            <Text style={{ fontFamily: FB, fontSize: 12, color: ink.mid, marginTop: 4 }}>
              $4.04/mo — best value
            </Text>
          </TouchableOpacity>

          {/* Monthly */}
          <TouchableOpacity
            onPress={() => setPlan("monthly")}
            activeOpacity={0.8}
            style={{
              flex: 1, padding: 16, borderRadius: 16,
              borderWidth: 2,
              borderColor: !isAnnual ? earn.terra : paper.border,
              backgroundColor: !isAnnual ? earn.terraLo : paper.card,
            }}
          >
            <Text style={{ fontFamily: FOM, fontSize: 13, color: !isAnnual ? earn.terra : ink.mid, letterSpacing: 0.5, marginBottom: 8 }}>
              MONTHLY
            </Text>
            <Text style={{ fontFamily: FOM, fontSize: 22, color: ink.deep }}>
              $5.99
              <Text style={{ fontFamily: FB, fontSize: 14, color: ink.mid }}>/month</Text>
            </Text>
            <Text style={{ fontFamily: FB, fontSize: 12, color: ink.mid, marginTop: 4 }}>
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
            <Text style={{ fontSize: 24 }}>{f.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: FK, fontSize: 15, color: ink.deep }}>{f.title}</Text>
              <Text style={{ fontFamily: FB, fontSize: 12, color: ink.mid, marginTop: 2 }}>{f.desc}</Text>
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
        {/* Price summary */}
        <Text style={{ fontFamily: FB, fontSize: 14, color: ink.mid, textAlign: "center", marginBottom: 12 }}>
          1 week free trial, then {isAnnual ? "$48.49/year" : "$5.99/month"}
        </Text>

        {/* Purchase button */}
        <TouchableOpacity
          onPress={handlePurchase}
          disabled={purchasing || restoring}
          activeOpacity={0.8}
          style={{
            backgroundColor: earn.terra, borderRadius: 16,
            paddingVertical: 16, alignItems: "center",
            opacity: purchasing ? 0.7 : 1,
          }}
        >
          {purchasing
            ? <ActivityIndicator color="#fff" />
            : <Text style={{ fontFamily: FOM, fontSize: 16, color: "#fff", letterSpacing: 0.5 }}>
                Start Free Trial
              </Text>
          }
        </TouchableOpacity>

        {/* Restore */}
        <TouchableOpacity
          onPress={handleRestore}
          disabled={purchasing || restoring}
          style={{ alignItems: "center", marginTop: 12, paddingVertical: 6 }}
        >
          {restoring
            ? <ActivityIndicator size="small" color={ink.mid} />
            : <Text style={{ fontFamily: FK, fontSize: 13, color: ink.mid }}>
                Restore purchase
              </Text>
          }
        </TouchableOpacity>
      </View>
    </View>
  );
}
