/**
 * DriftInScreen.jsx
 * Deep-focus lock mode. User commits to a task, enters an immersive countdown.
 * BackHandler blocks accidental exits. expo-keep-awake keeps the screen on.
 */
import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, TouchableOpacity, TextInput, StyleSheet,
  BackHandler, Alert, Animated, Platform, StatusBar,
  ScrollView, Dimensions,
} from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import Svg, { Circle as SvgCircle } from "react-native-svg";
import { useFonts, Oswald_400Regular, Oswald_700Bold } from "@expo-google-fonts/oswald";
import { Orbitron_700Bold, Orbitron_400Regular } from "@expo-google-fonts/orbitron";
import { getTheme } from "./theme";

const { width } = Dimensions.get("window");

// ── Always-dark palette (active session) ─────────────────────
const BG    = "#0B1A11";
const GREEN = "#2FAB72";
const WHITE = "#E8F5EC";
const MUTED = "#4A8060";
const BLUE  = "#5AB4D4";

const FO  = "Orbitron_700Bold";
const FOM = "Orbitron_400Regular";
const FK  = "Oswald_700Bold";
const FKR = "Oswald_400Regular";
const FB  = undefined; // system sans-serif

// ── Duration options ─────────────────────────────────────────
const DURATIONS = [
  { label: "15m",  mins: 15  },
  { label: "25m",  mins: 25  },
  { label: "30m",  mins: 30  },
  { label: "45m",  mins: 45  },
  { label: "1h",   mins: 60  },
  { label: "90m",  mins: 90  },
  { label: "2h",   mins: 120 },
];

const fmtSecs = s => {
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  return `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
};

// ── Circular progress ring ────────────────────────────────────
const RING_R    = 108;
const RING_CIRC = 2 * Math.PI * RING_R;

function ProgressRing({ progress }) {
  const offset = RING_CIRC * (1 - Math.min(1, Math.max(0, progress)));
  return (
    <Svg width={260} height={260} style={StyleSheet.absoluteFill}>
      {/* Track */}
      <SvgCircle cx={130} cy={130} r={RING_R}
        stroke="rgba(47,171,114,0.12)" strokeWidth={7} fill="none" />
      {/* Fill */}
      <SvgCircle cx={130} cy={130} r={RING_R}
        stroke={GREEN} strokeWidth={7} fill="none"
        strokeDasharray={RING_CIRC}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90, 130, 130)"
      />
      {/* Glow layer (soft duplicate at lower opacity) */}
      <SvgCircle cx={130} cy={130} r={RING_R}
        stroke={GREEN} strokeWidth={14} fill="none"
        strokeDasharray={RING_CIRC}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90, 130, 130)"
        opacity={0.08}
      />
    </Svg>
  );
}

// ── Main component ────────────────────────────────────────────
export default function DriftInScreen({ onSessionComplete, onSessionStart, onSessionEnd, dark = false }) {
  const theme = getTheme(dark);
  // Setup-phase colors follow the app theme; active/done always use dark forest
  const [phase,   setPhase]   = useState("setup"); // setup | active | done
  const [task,    setTask]    = useState("");
  const [dur,     setDur]     = useState(25);
  const [secLeft, setSecLeft] = useState(0);
  const [secTotal,setSecTotal]= useState(0);

  const timerRef  = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim  = useRef(new Animated.Value(0.4)).current;

  // Pulse + glow during active session
  useEffect(() => {
    if (phase !== "active") return;
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.03, duration: 2400, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1.0,  duration: 2400, useNativeDriver: true }),
    ]));
    const glow = Animated.loop(Animated.sequence([
      Animated.timing(glowAnim, { toValue: 0.7, duration: 2000, useNativeDriver: true }),
      Animated.timing(glowAnim, { toValue: 0.4, duration: 2000, useNativeDriver: true }),
    ]));
    pulse.start();
    glow.start();
    return () => { pulse.stop(); glow.stop(); };
  }, [phase]);

  // Keep screen awake during session
  useEffect(() => {
    if (phase === "active") activateKeepAwakeAsync();
    else deactivateKeepAwake();
    return () => deactivateKeepAwake();
  }, [phase]);

  // Block back during active session
  useEffect(() => {
    if (phase !== "active") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      Alert.alert(
        "Leave session?",
        "Abandoning won't earn any credits.",
        [
          { text: "Stay focused", style: "cancel" },
          { text: "Abandon", style: "destructive", onPress: abandon },
        ]
      );
      return true;
    });
    return () => sub.remove();
  }, [phase]);

  const startSession = () => {
    if (!task.trim()) return;
    const secs = dur * 60;
    setSecTotal(secs);
    setSecLeft(secs);
    setPhase("active");
    onSessionStart?.();
    timerRef.current = setInterval(() => {
      setSecLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          setPhase("done");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const abandon = () => {
    clearInterval(timerRef.current);
    onSessionEnd?.();
    setPhase("setup");
    setSecLeft(0);
  };

  const completeEarly = () => {
    Alert.alert(
      "Finish early?",
      "You'll earn credits for the time focused so far.",
      [
        { text: "Keep going", style: "cancel" },
        { text: "Finish", onPress: () => { clearInterval(timerRef.current); setPhase("done"); }},
      ]
    );
  };

  const elapsed       = secTotal - secLeft;
  const creditsEarned = Math.max(0, Math.floor(elapsed / 60));
  const xpEarned      = creditsEarned > 0 ? Math.round(creditsEarned * 1.5 * 0.45 + 8) : 0;
  const progress      = secTotal > 0 ? elapsed / secTotal : 0;

  // ──────────────────────────────────────────────────────────
  // SETUP
  // ──────────────────────────────────────────────────────────
  // Theme-aware setup colors
  const setupBg   = theme.paper.warm;
  const setupCard = theme.paper.card;
  const setupTxt  = theme.ink.deep;
  const setupMid  = theme.ink.mid;
  const setupBrd  = theme.ink.border;
  const setupFnt  = theme.ink.faint;

  if (phase === "setup") return (
    <ScrollView
      style={{ flex: 1, backgroundColor: setupBg }}
      contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 20, paddingBottom: 56 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <StatusBar barStyle={dark ? "light-content" : "dark-content"} />

      {/* Header */}
      <View style={{ marginBottom: 28 }}>
        <Text style={[s.pageTitle, { color: setupTxt }]}>DRIFT IN</Text>
        <Text style={[s.pageSubtitle, { color: setupMid }]}>Lock into deep focus</Text>
      </View>

      {/* Task input */}
      <View style={{ marginBottom: 22 }}>
        <Text style={[s.fieldLabel, { color: setupFnt }]}>WHAT ARE YOU WORKING ON?</Text>
        <TextInput
          value={task}
          onChangeText={setTask}
          placeholder="e.g. Study for exam, Deep work sprint..."
          placeholderTextColor={setupFnt}
          style={[s.taskInput, {
            backgroundColor: setupCard,
            borderColor: task.trim() ? GREEN : setupBrd,
            color: setupTxt,
          }]}
          multiline={false}
          returnKeyType="done"
          autoFocus={false}
        />
      </View>

      {/* Duration picker */}
      <View style={{ marginBottom: 24 }}>
        <Text style={[s.fieldLabel, { color: setupFnt }]}>SESSION LENGTH</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {DURATIONS.map(d => {
            const active = dur === d.mins;
            return (
              <TouchableOpacity
                key={d.mins}
                onPress={() => setDur(d.mins)}
                style={[
                  s.durPill,
                  { backgroundColor: active ? theme.earn.greenLo : setupCard, borderColor: active ? GREEN : setupBrd },
                ]}
                activeOpacity={0.75}
              >
                <Text style={[s.durPillText, { color: active ? GREEN : setupMid }]}>
                  {d.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Drift Lock notice */}
      <View style={[s.lockNotice, { backgroundColor: theme.earn.blueLo, borderColor: "rgba(90,180,212,0.2)" }]}>
        <Text style={[s.lockNoticeTitle, { color: "#2A7FA0" }]}>⚡ DRIFT LOCK</Text>
        <Text style={[s.lockNoticeBody, { color: "#2A7FA0" }]}>
          Back navigation is blocked and your screen stays on throughout your session.
        </Text>
        <View style={{ height: 1, backgroundColor: "rgba(90,180,212,0.2)", marginVertical: 10 }} />
        <Text style={[s.lockNoticeBody, { color: "#2A7FA0" }]}>
          For full app blocking, enable{" "}
          <Text style={{ fontWeight: "700" }}>iOS Focus Mode</Text> or{" "}
          <Text style={{ fontWeight: "700" }}>Android Digital Wellbeing</Text> before starting.
        </Text>
      </View>

      {/* Reward preview */}
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 28 }}>
        <View style={[s.rewardCard, { backgroundColor: setupCard, borderColor: "rgba(47,171,114,0.2)" }]}>
          <Text style={[s.rewardVal, { color: GREEN }]}>{dur}m</Text>
          <Text style={[s.rewardLabel, { color: setupMid }]}>credits earned</Text>
        </View>
        <View style={[s.rewardCard, { backgroundColor: setupCard, borderColor: "rgba(90,180,212,0.2)" }]}>
          <Text style={[s.rewardVal, { color: BLUE }]}>+{Math.round(dur * 1.5 * 0.45 + 8)} XP</Text>
          <Text style={[s.rewardLabel, { color: setupMid }]}>experience</Text>
        </View>
      </View>

      {/* CTA */}
      <TouchableOpacity
        onPress={startSession}
        disabled={!task.trim()}
        style={[
          s.ctaBtn,
          !task.trim() && {
            backgroundColor: dark ? "rgba(47,171,114,0.18)" : "#C2DDD3",
          },
        ]}
        activeOpacity={0.85}
      >
        <Text style={[
          s.ctaBtnText,
          !task.trim() && { color: dark ? "#6B9A7A" : "#fff" },
        ]}>
          {task.trim() ? "DRIFT IN  →" : "ENTER A TASK ABOVE"}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
  // (Active and Done phases always use the dark BG by design)

  // ──────────────────────────────────────────────────────────
  // ACTIVE SESSION
  // ──────────────────────────────────────────────────────────
  if (phase === "active") return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <StatusBar barStyle="light-content" />

      {/* Task name */}
      <View style={{ paddingTop: Platform.OS === "ios" ? 64 : 40, paddingHorizontal: 28, alignItems: "center" }}>
        <Text style={s.activeLabelSmall}>FOCUSED ON</Text>
        <Text style={s.activeTask} numberOfLines={2}>{task}</Text>
      </View>

      {/* Ring + timer */}
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>

        {/* Outer glow */}
        <Animated.View style={{
          width: 280, height: 280,
          borderRadius: 140,
          backgroundColor: "transparent",
          shadowColor: GREEN,
          shadowRadius: 40,
          shadowOpacity: glowAnim,
          shadowOffset: { width: 0, height: 0 },
          position: "absolute",
        }} />

        <Animated.View style={{
          width: 260, height: 260,
          alignItems: "center", justifyContent: "center",
          transform: [{ scale: pulseAnim }],
        }}>
          <ProgressRing progress={progress} />
          <View style={{ alignItems: "center", zIndex: 1 }}>
            <Text style={s.timerText}>{fmtSecs(secLeft)}</Text>
            <Text style={s.timerSub}>
              {Math.floor(elapsed / 60)}m {String(elapsed % 60).padStart(2,"0")}s focused
            </Text>
          </View>
        </Animated.View>
      </View>

      {/* Actions */}
      <View style={{ paddingHorizontal: 24, paddingBottom: Platform.OS === "ios" ? 52 : 32, gap: 12 }}>
        <TouchableOpacity onPress={completeEarly} style={s.completeBtn}>
          <Text style={s.completeBtnText}>COMPLETE EARLY</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => Alert.alert(
            "Abandon session?",
            "No credits will be earned.",
            [
              { text: "Stay focused", style: "cancel" },
              { text: "Abandon", style: "destructive", onPress: abandon },
            ]
          )}
          style={{ paddingVertical: 12, alignItems: "center" }}
        >
          <Text style={{ fontFamily: FB, fontSize: 13, color: MUTED }}>Abandon session</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ──────────────────────────────────────────────────────────
  // DONE
  // ──────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: BG, alignItems: "center", justifyContent: "center", padding: 32 }}>
      <StatusBar barStyle="light-content" />

      <Text style={{ fontSize: 64, marginBottom: 16 }}>✦</Text>
      <Text style={s.doneTitle}>SESSION COMPLETE</Text>
      <Text style={s.doneTask}>{task}</Text>

      {/* Stats */}
      <View style={{ flexDirection: "row", gap: 14, width: "100%", marginBottom: 40 }}>
        <View style={s.doneCard}>
          <Text style={[s.doneVal, { color: GREEN }]}>{creditsEarned}m</Text>
          <Text style={s.doneCardLabel}>credits earned</Text>
        </View>
        <View style={s.doneCard}>
          <Text style={[s.doneVal, { color: BLUE }]}>+{xpEarned} XP</Text>
          <Text style={s.doneCardLabel}>experience</Text>
        </View>
      </View>

      <TouchableOpacity
        onPress={() => {
          onSessionComplete({ credits: creditsEarned, xp: xpEarned, task });
          onSessionEnd?.();
          setPhase("setup");
          setTask("");
          setDur(25);
        }}
        style={s.collectBtn}
      >
        <Text style={s.collectBtnText}>COLLECT REWARDS  ✓</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────
const s = StyleSheet.create({
  // Setup
  pageTitle:   { fontFamily: FO,  fontSize: 28, color: "#1A2B1F", letterSpacing: 1.5 },
  pageSubtitle:{ fontFamily: FK,  fontSize: 17, color: "#6B8A78", marginTop: 4 },
  fieldLabel:  { fontFamily: FOM, fontSize: 9,  color: "#A8BFB5", letterSpacing: 2, marginBottom: 10 },
  taskInput: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5, borderColor: "rgba(26,43,31,0.1)",
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
    fontFamily: FB, fontSize: 15, color: "#1A2B1F",
  },
  durPill: {
    paddingVertical: 9, paddingHorizontal: 16, borderRadius: 30,
    borderWidth: 1.5, borderColor: "rgba(26,43,31,0.1)",
    backgroundColor: "#FFFFFF",
  },
  durPillActive: { borderColor: GREEN, backgroundColor: "#E4F5EE" },
  durPillText:   { fontFamily: FOM, fontSize: 12, color: "#6B8A78" },
  durPillTextActive: { color: GREEN },
  lockNotice: {
    backgroundColor: "#E6F4FB",
    borderRadius: 14, padding: 16, marginBottom: 22,
    borderWidth: 1, borderColor: "rgba(90,180,212,0.2)",
  },
  lockNoticeTitle: { fontFamily: FOM, fontSize: 10, color: "#2A7FA0", letterSpacing: 1.5, marginBottom: 8 },
  lockNoticeBody:  { fontFamily: FB,  fontSize: 13, color: "#2A7FA0", lineHeight: 20 },
  rewardCard: {
    flex: 1, backgroundColor: "#FFFFFF", borderRadius: 12, padding: 16,
    borderWidth: 1, alignItems: "center",
  },
  rewardVal:   { fontFamily: FO, fontSize: 20 },
  rewardLabel: { fontFamily: FB, fontSize: 11, color: "#6B8A78", marginTop: 4 },
  ctaBtn: {
    paddingVertical: 17, borderRadius: 16,
    backgroundColor: GREEN, alignItems: "center",
  },
  ctaBtnDisabled: { backgroundColor: "#C2DDD3" },
  ctaBtnText: { fontFamily: FO, fontSize: 13, color: "#fff", letterSpacing: 2 },

  // Active
  activeLabelSmall: { fontFamily: FOM, fontSize: 9, color: MUTED, letterSpacing: 2.5, marginBottom: 8 },
  activeTask:       { fontFamily: FK,  fontSize: 22, color: WHITE, textAlign: "center" },
  timerText:  { fontFamily: FO,  fontSize: 46, color: WHITE, letterSpacing: 3 },
  timerSub:   { fontFamily: FOM, fontSize: 11, color: MUTED, marginTop: 8, letterSpacing: 1 },
  completeBtn: {
    paddingVertical: 15, borderRadius: 14,
    backgroundColor: GREEN, alignItems: "center",
  },
  completeBtnText: { fontFamily: FO, fontSize: 12, color: "#fff", letterSpacing: 2 },

  // Done
  doneTitle: { fontFamily: FO, fontSize: 18, color: GREEN, letterSpacing: 2, marginBottom: 8 },
  doneTask:  { fontFamily: FK, fontSize: 20, color: WHITE, textAlign: "center", marginBottom: 36 },
  doneCard: {
    flex: 1, backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 14, padding: 18, alignItems: "center",
  },
  doneVal:      { fontFamily: FO, fontSize: 22 },
  doneCardLabel:{ fontFamily: FB, fontSize: 11, color: MUTED, marginTop: 6 },
  collectBtn: {
    width: "100%", paddingVertical: 16, borderRadius: 14,
    backgroundColor: GREEN, alignItems: "center",
  },
  collectBtnText: { fontFamily: FO, fontSize: 13, color: "#fff", letterSpacing: 2 },
});
