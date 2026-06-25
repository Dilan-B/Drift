/**
 * TutorialOverlay.jsx
 * Post-signup interactive coachmark tour. A dimmed overlay walks the user
 * through the core loop, anchoring each tooltip near the part of the screen it
 * describes (top = hero/balance, bottom = tab bar, center = intro/outro).
 *
 * We anchor to screen regions rather than measuring individual elements so the
 * tour stays robust across devices without fragile runtime layout measurement.
 */
import React, { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, Animated, StyleSheet, Platform, Dimensions } from "react-native";
import { getTheme, FF } from "./theme";

const STEPS = [
  { anchor: "center", kicker: "WELCOME", title: "Welcome to Drift", body: "You earn your screen time by completing real tasks. Here's the 20-second tour." },
  { anchor: "top",    kicker: "TODAY",   title: "Your earned time", body: "This is the time you've banked. When it reaches zero, your chosen apps lock until you earn more." },
  { anchor: "top",    kicker: "TASKS",   title: "Add a task", body: "Tap the + to add something worth doing. Finish and confirm it to earn screen time." },
  { anchor: "bottom", kicker: "FOCUS",   title: "Drift In", body: "Start a focus session from the tab bar. Your apps stay blocked while you focus — and you earn time for it." },
  { anchor: "bottom", kicker: "GROVE",   title: "The Grove", body: "Add friends, watch your plant grow as you level up, and challenge each other to stay on track." },
  { anchor: "center", kicker: "READY",   title: "You're all set", body: "Complete your first task to bank some minutes. Welcome to focused." },
];

export default function TutorialOverlay({ dark = false, onDone }) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;
  const [i, setI] = useState(0);
  const fade = useRef(new Animated.Value(0)).current;
  const cardFade = useRef(new Animated.Value(0)).current;
  const cardRise = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 320, useNativeDriver: true }).start();
  }, []);

  useEffect(() => {
    cardFade.setValue(0);
    cardRise.setValue(12);
    Animated.parallel([
      Animated.timing(cardFade, { toValue: 1, duration: 320, useNativeDriver: true }),
      Animated.spring(cardRise, { toValue: 0, useNativeDriver: true, damping: 14, stiffness: 180 }),
    ]).start();
  }, [i]);

  const step = STEPS[i];
  const isLast = i === STEPS.length - 1;

  const next = () => {
    if (isLast) { onDone?.(); return; }
    setI(v => v + 1);
  };

  // Position the tooltip card by anchor region.
  const cardPosition =
    step.anchor === "top" ? { top: Platform.OS === "ios" ? 180 : 150 }
    : step.anchor === "bottom" ? { bottom: Platform.OS === "ios" ? 130 : 110 }
    : { top: 0, bottom: 0, justifyContent: "center" };

  return (
    <Animated.View style={[StyleSheet.absoluteFill, s.scrim, { opacity: fade }]}>
      <TouchableOpacity onPress={onDone} activeOpacity={1} style={s.skip}>
        <Text style={[s.skipText, { color: "#FAF6EE" }]}>Skip</Text>
      </TouchableOpacity>

      <View style={[s.cardWrap, cardPosition]}>
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
            <TouchableOpacity onPress={next} activeOpacity={0.85} style={[s.nextBtn, { backgroundColor: earn.deep }]}>
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
  scrim: { backgroundColor: "rgba(11,26,17,0.72)", zIndex: 500 },
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
