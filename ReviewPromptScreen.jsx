/**
 * ReviewPromptScreen.jsx
 * The "leave a review" page. When it may appear is decided by reviewPrompt.js
 * (up to three times a year, 90+ days apart, after a success). Per product spec:
 *   1. The page mounts and all elements animate in — but NO continue button yet,
 *      so the user actually reads it.
 *   2. After ~2.5s, we auto-trigger Apple's native in-app review prompt
 *      (expo-store-review). Apple decides whether/how often it actually shows
 *      and never tells us the outcome (reviewed vs declined) — so we can't gate
 *      on the result.
 *   3. Once the prompt has been requested, we reveal the two ways out: write a
 *      review in the App Store, or continue.
 *
 * WHY THERE IS NO "WRITE A REVIEW HERE" BUTTON
 *   Apple's sheet IS the in-app path — it takes a rating and a written review
 *   without leaving Drift — but requestReview() must not be called from a tap.
 *   Apple's documentation says so outright, and the sheet silently does nothing
 *   when throttled, so a button wired to it would do nothing a good fraction of
 *   the time. The sheet therefore fires on its own above, and the button offers
 *   the path that always works: the App Store's own review composer.
 *
 * Requires `expo-store-review` (npx expo install expo-store-review). Safe no-op
 * if the module is missing or review isn't available on the device.
 */
import React, { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, Animated, StyleSheet, Platform, Linking } from "react-native";
import { getTheme, FF } from "./theme";
import { getAppConfig } from "./supabase";
import Sprout from "./SproutArt";

let StoreReview = null;
try { StoreReview = require("expo-store-review"); } catch {}

const STAR = "★";

// Last-resort App Store link. app_config.ios_store_url is the source of truth
// (ForceUpdateModal reads the same row), but a review prompt that silently
// offers nothing because a network call failed is worse than a hardcoded id.
const FALLBACK_STORE_URL = "https://apps.apple.com/app/id6778215875";

/** The App Store page, opened straight onto the write-a-review composer. */
function writeReviewUrl(base) {
  const url = base || FALLBACK_STORE_URL;
  return url + (url.includes("?") ? "&" : "?") + "action=write-review";
}

export default function ReviewPromptScreen({ dark = false, onDone }) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;
  const [showContinue, setShowContinue] = useState(false);
  const [storeUrl, setStoreUrl] = useState(null); // App Store page, when available

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

    // Resolve the App Store page up front.
    //
    // StoreReview.storeUrl() reads expo.ios.appStoreUrl, which is not set, so
    // it returns null and the store link never rendered at all. app_config is
    // the live source of truth and needs no app release to correct.
    (async () => {
      try {
        let url = null;
        if (StoreReview?.storeUrl) { try { url = await StoreReview.storeUrl(); } catch {} }
        if (!url) { const cfg = await getAppConfig(); url = cfg?.ios_store_url || null; }
        setStoreUrl(url || FALLBACK_STORE_URL);
      } catch {
        setStoreUrl(FALLBACK_STORE_URL);
      }
    })();

    // 2. After the user has had a moment to read, auto-request the review.
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        // NOTE: Apple's in-app review prompt only appears in PRODUCTION App
        // Store builds and is throttled (~3/yr per device). In dev/TestFlight
        // requestReview() is a silent no-op — that's expected, not a bug. We
        // don't gate on isAvailableAsync() (it can falsely report false); the
        // call is a safe no-op if unsupported.
        if (StoreReview?.requestReview) await StoreReview.requestReview();
      } catch {}
      // 3. Reveal the Continue button (we can't detect the prompt's outcome).
      if (cancelled) return;
      setShowContinue(true);
      Animated.timing(continueFade, { toValue: 1, duration: 420, useNativeDriver: true }).start();
    }, 2500);

    return () => { cancelled = true; clearTimeout(t); };
  }, []);

  // Opens the App Store straight onto the review composer. This is the path
  // that always works — the in-app sheet is throttled and invisible in
  // TestFlight, so without this most people have no way to review at all.
  const openWriteReview = async () => {
    const target = writeReviewUrl(storeUrl);
    try {
      await Linking.openURL(target);
    } catch {
      // Some iOS versions refuse the composer deep link; the plain product
      // page still lets them write one, so fall back rather than dead-end.
      try { await Linking.openURL(storeUrl || FALLBACK_STORE_URL); } catch {}
    }
    onDone?.();
  };

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
          {/* Never ask for a particular rating. Apple's guidelines allow asking
              for a review, not for five stars, and this app has already been
              rejected once over how it prompts (5.6.3). */}
          Built by a tiny team. A review takes ten seconds and genuinely helps.
        </Text>
      </Animated.View>

      {/* Continue is intentionally hidden until the review prompt has fired. */}
      <View style={s.footer}>
        {showContinue && (
          <Animated.View style={{ opacity: continueFade }}>
            {/* Primary: always rendered. It used to be gated on a storeUrl
                that never resolved, so this was invisible in every build. */}
            <TouchableOpacity
              onPress={openWriteReview}
              activeOpacity={0.85}
              style={[s.continueBtn, { backgroundColor: earn.deep }, theme.fx.glow]}
            >
              <Text style={[s.continueText, { color: dark ? "#16261C" : "#FAF6EE" }]}>
                Write a review
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={onDone} activeOpacity={0.7} style={s.storeLink}>
              <Text style={[s.storeLinkText, { color: ink.mid }]}>Not now</Text>
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
  storeLink: { alignItems: "center", paddingVertical: 10, marginBottom: 4 },
  storeLinkText: { fontFamily: FF.bodyMed, fontSize: 13, letterSpacing: 0.2, textDecorationLine: "underline" },
});
