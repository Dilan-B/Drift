/**
 * ReviewPromptScreen.jsx
 * Post-signup "leave a review" page. Per product spec:
 *   1. The page mounts and all elements animate in — but NO continue button yet,
 *      so the user actually reads it.
 *   2. After ~2.5s, we auto-trigger Apple's native in-app review prompt
 *      (expo-store-review). Apple decides whether/how often it actually shows
 *      and never tells us the outcome (reviewed vs declined) — so we can't gate
 *      on the result.
 *   3. Once the prompt has been requested, we reveal the Continue button so the
 *      user can move on.
 *
 * Requires `expo-store-review` (npx expo install expo-store-review). Safe no-op
 * if the module is missing or review isn't available on the device.
 */
import React, { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, Animated, StyleSheet, Platform } from "react-native";
import { getTheme, FF } from "./theme";
import Sprout from "./SproutArt";

let StoreReview = null;
try { StoreReview = require("expo-store-review"); } catch {}

const STAR = "★";

export default function ReviewPromptScreen({ dark = false, onDone }) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;
  const [showContinue, setShowContinue] = useState(false);

  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(18)).current;
  const starScales = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(0))).current;
  const continueFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // 1. Everything animates in.
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 520, useNativeDriver: true }),
      Animated.timing(rise, { toValue: 0, duration: 560, useNativeDriver: true }),
    ]).start();
    Animated.stagger(90, starScales.map(s =>
      Animated.spring(s, { toValue: 1, useNativeDriver: true, damping: 9, stiffness: 220, mass: 0.6 })
    )).start();

    // 2. After the user has had a moment to read, auto-request the review.
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        if (StoreReview && (await StoreReview.isAvailableAsync())) {
          await StoreReview.requestReview();
        }
      } catch {}
      // 3. Reveal the Continue button (we can't detect the prompt's outcome).
      if (cancelled) return;
      setShowContinue(true);
      Animated.timing(continueFade, { toValue: 1, duration: 420, useNativeDriver: true }).start();
    }, 2500);

    return () => { cancelled = true; clearTimeout(t); };
  }, []);

  return (
    <View style={[s.screen, { backgroundColor: paper.warm }]}>
      <Animated.View style={{ flex: 1, opacity: fade, transform: [{ translateY: rise }], alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
        <View style={{ marginBottom: 22 }}>
          <Sprout size={120} tone={dark ? "night" : "fresh"} />
        </View>

        <Text style={[s.kicker, { color: earn.sage }]}>ENJOYING DRIFT?</Text>

        <Text style={[s.headline, { color: ink.deep }]}>
          Help Drift grow
        </Text>

        <View style={s.stars}>
          {starScales.map((sc, i) => (
            <Animated.Text
              key={i}
              style={[s.star, { color: earn.terra, transform: [{ scale: sc }] }]}
            >
              {STAR}
            </Animated.Text>
          ))}
        </View>

        <Text style={[s.body, { color: ink.mid }]}>
          Drift is built by a tiny team. A 5-star review takes ten seconds and
          genuinely helps more people reclaim their focus — it's the single
          biggest thing you can do to support us.
        </Text>
      </Animated.View>

      {/* Continue is intentionally hidden until the review prompt has fired. */}
      <View style={s.footer}>
        {showContinue && (
          <Animated.View style={{ opacity: continueFade }}>
            <TouchableOpacity
              onPress={onDone}
              activeOpacity={0.85}
              style={[s.continueBtn, { backgroundColor: earn.deep }]}
            >
              <Text style={[s.continueText, { color: dark ? "#16261C" : "#FAF6EE" }]}>
                Continue
              </Text>
            </TouchableOpacity>
          </Animated.View>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  kicker: { fontFamily: FF.kicker, fontSize: 11, letterSpacing: 2.6, marginBottom: 12 },
  headline: { fontFamily: FF.display, fontSize: 40, letterSpacing: -0.5, textAlign: "center", marginBottom: 20 },
  stars: { flexDirection: "row", gap: 8, marginBottom: 22 },
  star: { fontSize: 30 },
  body: { fontFamily: FF.body, fontSize: 14, lineHeight: 22, textAlign: "center", maxWidth: 340 },
  footer: { paddingHorizontal: 32, paddingBottom: Platform.OS === "ios" ? 48 : 28, minHeight: 110, justifyContent: "flex-end" },
  continueBtn: { paddingVertical: 16, borderRadius: 16, alignItems: "center" },
  continueText: { fontFamily: FF.bodyMed, fontSize: 15, letterSpacing: 0.2 },
});
