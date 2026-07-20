/**
 * TutorialOverlay.jsx
 * Post-signup interactive coachmark tour. A dimmed overlay walks the user
 * through the core loop and SPOTLIGHTS the element each step describes: the rest
 * of the screen stays dimmed while a cutout (a "hole" in the dim) reveals and
 * rings the target. The spotlight animates from one target to the next as the
 * user taps Next, so the previous element is un-highlighted and the next one lit.
 *
 * Target rects are measured by the parent (Drift.jsx) via measureInWindow and
 * passed in `targets`. If a measurement is unavailable, that step falls back to
 * a full-screen dim with a region-anchored card, so the tour never breaks.
 */
import React, { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, Animated, StyleSheet, Platform, Dimensions } from "react-native";
import { getTheme, FF } from "./theme";

const { width: W, height: H } = Dimensions.get("window");
const PAD = 10; // breathing room around the spotlighted element

const STEPS = [
  { target: null,      anchor: "center", kicker: "WELCOME", title: "Welcome to Drift", body: "You earn your screen time by completing real tasks. Here's the 20-second tour." },
  { target: "balance", anchor: "top",    kicker: "TODAY",   title: "Your earned time", body: "This is the time you've banked. When it reaches zero, your chosen apps lock until you earn more." },
  { target: "add",     anchor: "top",    kicker: "TASKS",   title: "Add a task", body: "Tap the + to add something worth doing. Finish and confirm it to earn screen time." },
  { target: { tab: 1 }, anchor: "bottom", kicker: "FOCUS",  title: "Drift In", body: "Start a focus session from the tab bar. Your apps stay blocked while you focus — and you earn time for it." },
  { target: { tab: 2 }, anchor: "bottom", kicker: "GROVE",  title: "The Grove", body: "Your progress under You, and your friends under Friends — streaks, levels and challenges in one place." },
  { target: { tab: 3 }, anchor: "bottom", kicker: "THE LAB", title: "The Lab", body: "Where you tune Drift: which apps get blocked, what repeats, and what gets suggested automatically." },
  { target: null,      anchor: "center", kicker: "READY",   title: "You're all set", body: "Complete your first task to bank some minutes. Welcome to focused." },
];

// Resolve a step's target into a padded, on-screen rect (or null for full dim).
function rectFor(step, targets) {
  if (!targets || !step.target) return null;
  let r = null;
  if (step.target === "balance") r = targets.balance;
  else if (step.target === "add") r = targets.add;
  else if (typeof step.target === "object" && targets.tabs) r = targets.tabs[step.target.tab];
  if (!r) return null;
  const x = Math.max(0, r.x - PAD);
  const y = Math.max(0, r.y - PAD);
  const w = Math.min(W - x, r.w + PAD * 2);
  const h = Math.min(H - y, r.h + PAD * 2);
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

export default function TutorialOverlay({ dark = false, targets, onDone }) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;
  const [i, setI] = useState(0);
  const fade = useRef(new Animated.Value(0)).current;
  const cardFade = useRef(new Animated.Value(0)).current;
  const cardRise = useRef(new Animated.Value(12)).current;

  // Animated spotlight rect (x, y, w, h). Starts as a zero-size hole at center
  // (= full dim) so the welcome step shows nothing highlighted.
  const sx = useRef(new Animated.Value(W / 2)).current;
  const sy = useRef(new Animated.Value(H / 2)).current;
  const sw = useRef(new Animated.Value(0)).current;
  const sh = useRef(new Animated.Value(0)).current;
  const ringFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 320, useNativeDriver: true }).start();
  }, []);

  const step = STEPS[i];
  const rect = rectFor(step, targets);

  // Move the spotlight to this step's target whenever the step (or the measured
  // targets) change. Center steps collapse the hole → full dim.
  useEffect(() => {
    const dest = rect || { x: W / 2, y: H / 2, w: 0, h: 0 };
    Animated.parallel([
      Animated.timing(sx, { toValue: dest.x, duration: 340, useNativeDriver: false }),
      Animated.timing(sy, { toValue: dest.y, duration: 340, useNativeDriver: false }),
      Animated.timing(sw, { toValue: dest.w, duration: 340, useNativeDriver: false }),
      Animated.timing(sh, { toValue: dest.h, duration: 340, useNativeDriver: false }),
      Animated.timing(ringFade, { toValue: rect ? 1 : 0, duration: 260, useNativeDriver: false }),
    ]).start();
  }, [i, targets]);

  // Card enter animation per step.
  useEffect(() => {
    cardFade.setValue(0);
    cardRise.setValue(12);
    Animated.parallel([
      Animated.timing(cardFade, { toValue: 1, duration: 320, useNativeDriver: true }),
      Animated.spring(cardRise, { toValue: 0, useNativeDriver: true, damping: 14, stiffness: 180 }),
    ]).start();
  }, [i]);

  const isLast = i === STEPS.length - 1;
  const next = () => {
    if (isLast) { onDone?.(); return; }
    setI(v => v + 1);
  };

  // Position the tooltip card so it never covers the spotlight.
  let cardPosition;
  if (!rect) {
    cardPosition = { top: 0, bottom: 0, justifyContent: "center" };
  } else if (rect.y > H / 2) {
    // target low on screen → card above it
    cardPosition = { bottom: Math.min(H - rect.y + 16, H - 80) };
  } else {
    // target high on screen → card below it
    cardPosition = { top: Math.min(rect.y + rect.h + 16, H - 280) };
  }

  const dimColor = "rgba(11,26,17,0.74)";
  const bottomTop = Animated.add(sy, sh);
  const rightLeft = Animated.add(sx, sw);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 500, opacity: fade }]}>
      {/* ── Dim built from 4 panels around the spotlight hole ───────── */}
      <Animated.View style={{ position: "absolute", left: 0, right: 0, top: 0, height: sy, backgroundColor: dimColor }} />
      <Animated.View style={{ position: "absolute", left: 0, right: 0, top: bottomTop, bottom: 0, backgroundColor: dimColor }} />
      <Animated.View style={{ position: "absolute", left: 0, top: sy, width: sx, height: sh, backgroundColor: dimColor }} />
      <Animated.View style={{ position: "absolute", left: rightLeft, right: 0, top: sy, height: sh, backgroundColor: dimColor }} />

      {/* ── Glow ring around the spotlighted element ────────────────── */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: sx, top: sy, width: sw, height: sh,
          borderRadius: 18,
          borderWidth: 2,
          borderColor: earn.sage,
          opacity: ringFade,
          shadowColor: earn.sage,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.6,
          shadowRadius: 12,
        }}
      />

      <TouchableOpacity onPress={onDone} activeOpacity={1} style={s.skip}>
        <Text style={[s.skipText, { color: "#FAF6EE" }]}>Skip</Text>
      </TouchableOpacity>

      <View style={[s.cardWrap, cardPosition]} pointerEvents="box-none">
        <Animated.View style={[
          s.card,
          { backgroundColor: paper.card, borderColor: ink.hairline, opacity: cardFade, transform: [{ translateY: cardRise }] },
        ]}>
          <Text style={[s.kicker, { color: earn.sage }]}>{step.kicker}</Text>
          <Text style={[s.title, { color: ink.deep }]}>{step.title}</Text>
          <Text style={[s.body, { color: ink.mid }]}>{step.body}</Text>

          <View style={s.footer}>
            <View style={s.dots}>
              {STEPS.map((_, d) => (
                <View key={d} style={[s.dot, { backgroundColor: d === i ? earn.sage : ink.hairline }]} />
              ))}
            </View>
            <TouchableOpacity onPress={next} activeOpacity={0.85} style={[s.nextBtn, { backgroundColor: earn.deep }, theme.fx.glow]}>
              <Text style={[s.nextText, { color: dark ? "#16261C" : "#FAF6EE" }]}>
                {isLast ? "Done" : "Next"}
              </Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  skip: { position: "absolute", top: Platform.OS === "ios" ? 56 : 28, right: 20, padding: 8, zIndex: 2 },
  skipText: { fontFamily: FF.bodyMed, fontSize: 13, opacity: 0.8 },
  cardWrap: { position: "absolute", left: 22, right: 22 },
  card: { borderRadius: 22, borderWidth: 1, padding: 22 },
  kicker: { fontFamily: FF.kicker, fontSize: 10, letterSpacing: 2.4, marginBottom: 8 },
  title: { fontFamily: FF.display, fontSize: 26, letterSpacing: -0.4, marginBottom: 8 },
  body: { fontFamily: FF.body, fontSize: 14, lineHeight: 21 },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 20 },
  dots: { flexDirection: "row", gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  nextBtn: { paddingVertical: 11, paddingHorizontal: 22, borderRadius: 13 },
  nextText: { fontFamily: FF.bodyMed, fontSize: 14 },
});
