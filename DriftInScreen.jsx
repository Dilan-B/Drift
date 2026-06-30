/**
 * DriftInScreen.jsx
 * Deep-focus lock mode. User commits to a task, enters an immersive countdown.
 * BackHandler blocks accidental exits. expo-keep-awake keeps the screen on.
 */
import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, TouchableOpacity, TextInput, StyleSheet,
  BackHandler, Alert, Animated, Platform, StatusBar,
  ScrollView, Dimensions, AppState,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import Svg, { Circle as SvgCircle } from "react-native-svg";
import { useFonts, Oswald_400Regular, Oswald_700Bold } from "@expo-google-fonts/oswald";
import { Orbitron_700Bold, Orbitron_400Regular } from "@expo-google-fonts/orbitron";
import { FF, getTheme } from "./theme";
import Slider from "@react-native-community/slider";
import { SparkleIcon, CheckIcon } from "./Icons";
import Sprout, { LeafGlyph } from "./SproutArt";

const { width } = Dimensions.get("window");

// Persisted in-progress session so the countdown survives backgrounding and even
// an app kill — the timer is wall-clock based (an end timestamp), not a ticking
// counter, so it keeps progressing while Drift is closed.
const SESSION_KEY = "drift_driftin_session";

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

function ProgressRing({ progress, accent = GREEN, track = "rgba(47,171,114,0.12)" }) {
  const offset = RING_CIRC * (1 - Math.min(1, Math.max(0, progress)));
  return (
    <Svg width={260} height={260} style={StyleSheet.absoluteFill}>
      {/* Track */}
      <SvgCircle cx={130} cy={130} r={RING_R}
        stroke={track} strokeWidth={7} fill="none" />
      {/* Fill */}
      <SvgCircle cx={130} cy={130} r={RING_R}
        stroke={accent} strokeWidth={7} fill="none"
        strokeDasharray={RING_CIRC}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90, 130, 130)"
      />
      {/* Glow layer (soft duplicate at lower opacity) */}
      <SvgCircle cx={130} cy={130} r={RING_R}
        stroke={accent} strokeWidth={14} fill="none"
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
// Reward preview tile with a soft, low-opacity sprout tucked into the corner.
// The plant is clipped by the card's rounded bounds so it reads as a quiet
// watermark rather than a foreground element.
function RewardCard({ theme, accent, value, label, suffix, dark }) {
  return (
    <View style={{
      flex: 1,
      backgroundColor: theme.paper.sand,
      borderRadius: 20,
      paddingVertical: 18,
      paddingHorizontal: 16,
      minHeight: 96,
      overflow: "hidden",
      justifyContent: "flex-end",
    }}>
      {/* watermark plant */}
      <View style={{
        position: "absolute",
        right: -14,
        top: -10,
        opacity: dark ? 0.12 : 0.10,
        pointerEvents: "none",
      }}>
        <Sprout size={86} tone={dark ? "night" : "fresh"} />
      </View>

      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
        <Text style={{ fontFamily: "PlayfairDisplay_700Bold", fontSize: 30, color: accent, letterSpacing: -0.6 }}>
          {value}
        </Text>
        {suffix && (
          <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 13, color: accent }}>{suffix}</Text>
        )}
      </View>
      <Text style={{ fontFamily: "DMSans_400Regular", fontSize: 12, color: theme.ink.mid, marginTop: 4 }}>
        {label}
      </Text>
    </View>
  );
}

function PlantSlider({
  value,
  onValueChange,
  minimumValue,
  maximumValue,
  step,
  accent,
  track,
  soil,
  textColor,
  leftLabel,
  rightLabel,
}) {
  const pct = Math.max(0, Math.min(1, (value - minimumValue) / (maximumValue - minimumValue)));
  const leaves = [0.2, 0.4, 0.6, 0.8];

  return (
    <View style={{ marginTop: 2 }}>
      <View style={{ height: 34, justifyContent: "center", marginHorizontal: 2 }}>
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 4,
            right: 4,
            height: 8,
            borderRadius: 8,
            backgroundColor: track,
            borderWidth: 1,
            borderColor: soil,
            overflow: "hidden",
          }}
        >
          <View style={{
            width: `${pct * 100}%`,
            height: "100%",
            backgroundColor: accent,
            borderRadius: 8,
          }} />
        </View>
        {leaves.map((stop, i) => {
          const grown = pct >= stop;
          return (
            <View
              key={stop}
              pointerEvents="none"
              style={{
                position: "absolute",
                left: `${stop * 100}%`,
                top: i % 2 === 0 ? 6 : 18,
                width: 13,
                height: 7,
                borderTopLeftRadius: 9,
                borderBottomRightRadius: 9,
                backgroundColor: grown ? accent : soil,
                opacity: grown ? 0.74 : 0.4,
                transform: [
                  { translateX: -6 },
                  { rotate: i % 2 === 0 ? "-28deg" : "28deg" },
                ],
              }}
            />
          );
        })}
        <Slider
          minimumValue={minimumValue}
          maximumValue={maximumValue}
          step={step}
          value={value}
          onValueChange={onValueChange}
          minimumTrackTintColor="transparent"
          maximumTrackTintColor="transparent"
          thumbTintColor={accent}
          style={{ width: "100%", height: 34 }}
        />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: -2 }}>
        <Text style={{ fontFamily: FB, fontSize: 10, color: textColor }}>{leftLabel}</Text>
        <Text style={{ fontFamily: FB, fontSize: 10, color: textColor }}>{rightLabel}</Text>
      </View>
    </View>
  );
}

export default function DriftInScreen({ onSessionComplete, onSessionStart, onSessionTick, onSessionEnd, dark = false }) {
  const theme = getTheme(dark);
  // Setup-phase colors follow the app theme; active/done always use dark forest
  const [phase,   setPhase]   = useState("setup"); // setup | active | done
  const [task,    setTask]    = useState("");
  const [dur,     setDur]     = useState(25);
  const [secLeft, setSecLeft] = useState(0);
  const [secTotal,setSecTotal]= useState(0);

  const timerRef  = useRef(null);
  const endAtRef  = useRef(0);     // wall-clock timestamp (ms) the session ends
  const phaseRef  = useRef(phase); // mirror for AppState/listener closures
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim  = useRef(new Animated.Value(0.4)).current;

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const persistSession = (data) => { AsyncStorage.setItem(SESSION_KEY, JSON.stringify(data)).catch(() => {}); };
  const clearPersisted = () => { AsyncStorage.removeItem(SESSION_KEY).catch(() => {}); };

  // Recompute remaining time from the wall clock. Safe to call any time
  // (foreground, every second, after a kill) — it derives from endAtRef, so it's
  // correct no matter how long JS was suspended.
  const recompute = () => {
    const left = Math.max(0, Math.round((endAtRef.current - Date.now()) / 1000));
    setSecLeft(left);
    onSessionTick?.(left);
    if (left <= 0) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      clearPersisted();
      setPhase("done");
    }
  };

  const startTicking = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    recompute(); // immediate, so the UI is right the instant we (re)start
    timerRef.current = setInterval(recompute, 1000);
  };

  // Restore an in-progress session on mount (e.g. app was killed mid-focus).
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(SESSION_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (!saved?.endAt || !saved?.secTotal) return;
        endAtRef.current = saved.endAt;
        setTask(saved.task || "");
        setSecTotal(saved.secTotal);
        const left = Math.round((saved.endAt - Date.now()) / 1000);
        if (left > 0) {
          setSecLeft(left);
          setPhase("active");
          // Re-sync the parent (shield + live activity); applyBlocking is idempotent.
          onSessionStart?.({ task: saved.task || "Drift In", durationSeconds: left });
          startTicking();
        } else {
          // Finished while we were away — let the user collect what they focused.
          setSecLeft(0);
          setPhase("done");
          clearPersisted();
        }
      } catch {}
    })();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // Recompute the moment the app returns to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active" && phaseRef.current === "active" && endAtRef.current) startTicking();
    });
    return () => sub.remove();
  }, []);

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
    endAtRef.current = Date.now() + secs * 1000;
    setSecTotal(secs);
    setSecLeft(secs);
    setPhase("active");
    persistSession({ task: task.trim(), secTotal: secs, endAt: endAtRef.current });
    onSessionStart?.({ task: task.trim(), durationSeconds: secs });
    onSessionTick?.(secs);
    startTicking();
  };

  const abandon = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    clearPersisted();
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
        { text: "Finish", onPress: () => {
          if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
          clearPersisted();
          setPhase("done");
        }},
      ]
    );
  };

  const elapsed       = secTotal - secLeft;
  const focusMins     = Math.max(0, Math.floor(elapsed / 60)); // full minutes focused
  const creditsEarned = Math.floor(focusMins / 2);             // screen time = HALF the time drifted in
  const xpEarned      = focusMins > 0 ? Math.round(focusMins * 1.5 * 0.45 + 8) : 0;
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
  const focusTheme = getTheme(true);
  const focusInk = focusTheme.ink;
  const focusPaper = focusTheme.paper;
  const focusEarn = focusTheme.earn;

  if (phase === "setup") return (
    <ScrollView
      style={{ flex: 1, backgroundColor: setupBg }}
      contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 20, paddingBottom: 56 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <StatusBar barStyle={dark ? "light-content" : "dark-content"} />

      {/* Header — editorial */}
      <View style={{ marginBottom: 30 }}>
        <Text style={{
          fontFamily: "Orbitron_400Regular",
          fontSize: 10,
          letterSpacing: 2.4,
          color: setupFnt,
          marginBottom: 4,
        }}>
          DEEP FOCUS
        </Text>
        <Text style={[s.pageTitle, { color: setupTxt }]}>Drift in</Text>
      </View>

      {/* Task input */}
      <View style={{ marginBottom: 22 }}>
        <Text style={[s.fieldLabel, { color: setupFnt }]}>TASK</Text>
        <TextInput
          value={task}
          onChangeText={setTask}
          placeholder="Deep work sprint"
          placeholderTextColor={setupFnt}
          maxLength={80}
          style={[s.taskInput, {
            backgroundColor: setupCard,
            borderColor: task.trim() ? theme.earn.sage : setupBrd,
            color: setupTxt,
          }]}
          multiline={false}
          returnKeyType="done"
          autoFocus={false}
        />
      </View>

      {/* Duration — slider 15m to 5h, 15m steps */}
      <View style={{ marginBottom: 26 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <Text style={[s.fieldLabel, { color: setupFnt, marginBottom: 0 }]}>LENGTH</Text>
          <Text style={{ fontFamily: "PlayfairDisplay_700Bold", fontSize: 20, color: theme.ink.deep, letterSpacing: -0.4 }}>
            {dur >= 60 ? `${Math.floor(dur/60)}h ${dur%60 ? `${dur%60}m` : ""}`.trim() : `${dur}m`}
          </Text>
        </View>
        <PlantSlider
          minimumValue={15}
          maximumValue={300}
          step={15}
          value={dur}
          onValueChange={setDur}
          accent={theme.earn.sage}
          track={dark ? "rgba(255,255,255,0.08)" : "rgba(60,48,36,0.08)"}
          soil={dark ? "rgba(232,245,236,0.14)" : "rgba(94,76,54,0.12)"}
          textColor={setupFnt}
          leftLabel="15m"
          rightLabel="5h"
        />
      </View>

      {/* Reward preview — warm cards with a low-opacity plant tucked in each */}
      <Text style={[s.fieldLabel, { color: setupFnt }]}>EARN</Text>
      <View style={{ flexDirection: "row", gap: 12, marginBottom: 30 }}>
        <RewardCard
          theme={theme}
          accent={theme.earn.sage}
          value={`${Math.floor(dur / 2)}m`}
          label="screen time"
          dark={dark}
        />
        <RewardCard
          theme={theme}
          accent={theme.earn.clay}
          value={`+${Math.round(dur * 1.5 * 0.45 + 8)}`}
          label="experience"
          suffix="XP"
          dark={dark}
        />
      </View>

      {/* CTA */}
      <TouchableOpacity
        onPress={startSession}
        disabled={!task.trim()}
        style={[
          s.ctaBtn,
          !task.trim() && {
            backgroundColor: dark ? "rgba(127,190,150,0.18)" : "#D7CDBA",
          },
        ]}
        activeOpacity={0.85}
      >
        <Text style={[
          s.ctaBtnText,
          !task.trim() && { color: dark ? "#8FA98F" : "#FAF6EE" },
        ]}>
          {task.trim() ? "Drift in" : "Add a task"}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
  // (Active and Done phases always use the dark BG by design)

  // ──────────────────────────────────────────────────────────
  // ACTIVE SESSION
  // ──────────────────────────────────────────────────────────
  if (phase === "active") return (
    <View style={[s.focusScreen, { backgroundColor: focusInk.void }]}>
      <StatusBar barStyle="light-content" />

      <View style={s.focusHeader}>
        <Text style={[s.focusKicker, { color: focusInk.faint }]}>DEEP FOCUS</Text>
        <Text style={[s.focusTitle, { color: focusInk.deep }]}>Drift in</Text>
        <View style={[s.focusTaskPill, { backgroundColor: focusEarn.sageLo, borderColor: focusInk.border }]}>
          <LeafGlyph size={14} color={focusEarn.sage} />
          <Text style={[s.focusTaskText, { color: focusInk.deep }]} numberOfLines={2}>{task}</Text>
        </View>
      </View>

      <View style={s.focusCenter}>
        <Animated.View style={{
          position: "absolute",
          opacity: 0.08,
          transform: [{ scale: pulseAnim }],
        }} />

        <Animated.View style={{
          width: 260,
          height: 260,
          alignItems: "center", justifyContent: "center",
          transform: [{ scale: pulseAnim }],
        }}>
          <ProgressRing
            progress={progress}
            accent={focusEarn.sage}
            track="rgba(232,238,223,0.08)"
          />
          <View pointerEvents="none" style={{ position: "absolute", opacity: 0.08 }}>
            <Sprout size={210} tone="night" />
          </View>
          <View style={{ alignItems: "center", zIndex: 1 }}>
            <Text style={[s.timerText, { color: focusInk.deep }]}>{fmtSecs(secLeft)}</Text>
            <Text style={[s.timerSub, { color: focusInk.mid }]}>
              {Math.floor(elapsed / 60)}m {String(elapsed % 60).padStart(2,"0")}s focused
            </Text>
          </View>
        </Animated.View>

        <View style={s.focusStats}>
          <View style={[s.focusStat, { backgroundColor: focusPaper.sand, borderColor: focusInk.border }]}>
            <Text style={[s.focusStatValue, { color: focusEarn.sage }]}>{Math.max(0, Math.floor(secLeft / 60))}m</Text>
            <Text style={[s.focusStatLabel, { color: focusInk.mid }]}>remaining</Text>
          </View>
          <View style={[s.focusStat, { backgroundColor: focusPaper.sand, borderColor: focusInk.border }]}>
            <Text style={[s.focusStatValue, { color: focusEarn.clay }]}>{Math.round(progress * 100)}%</Text>
            <Text style={[s.focusStatLabel, { color: focusInk.mid }]}>complete</Text>
          </View>
        </View>
      </View>

      <View style={s.focusActions}>
        <TouchableOpacity onPress={completeEarly} style={[s.completeBtn, { backgroundColor: focusEarn.deep }]}>
          <Text style={[s.completeBtnText, { color: focusInk.void }]}>Complete early</Text>
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
          style={s.abandonBtn}
        >
          <Text style={[s.abandonText, { color: focusInk.mid }]}>Abandon session</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ──────────────────────────────────────────────────────────
  // DONE
  // ──────────────────────────────────────────────────────────
  return (
    <View style={[s.doneScreen, { backgroundColor: focusInk.void }]}>
      <StatusBar barStyle="light-content" />

      <View style={[s.doneHero, { backgroundColor: focusEarn.sageLo, borderColor: focusInk.border }]}>
        <Sprout size={116} tone="night" />
      </View>
      <Text style={[s.doneKicker, { color: focusInk.faint }]}>SESSION COMPLETE</Text>
      <Text style={[s.doneTitle, { color: focusInk.deep }]}>Good work.</Text>
      <Text style={[s.doneTask, { color: focusInk.mid }]}>{task}</Text>

      {/* Stats */}
      <View style={s.doneStats}>
        <View style={[s.doneCard, { backgroundColor: focusPaper.sand, borderColor: focusInk.border }]}>
          <Text style={[s.doneVal, { color: focusEarn.sage }]}>{creditsEarned}m</Text>
          <Text style={[s.doneCardLabel, { color: focusInk.mid }]}>screen time</Text>
        </View>
        <View style={[s.doneCard, { backgroundColor: focusPaper.sand, borderColor: focusInk.border }]}>
          <Text style={[s.doneVal, { color: focusEarn.clay }]}>+{xpEarned}</Text>
          <Text style={[s.doneCardLabel, { color: focusInk.mid }]}>experience</Text>
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
        style={[s.collectBtn, { backgroundColor: focusEarn.deep }]}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={[s.collectBtnText, { color: focusInk.void }]}>Collect rewards</Text>
          <CheckIcon size={16} color={focusInk.void} />
        </View>
      </TouchableOpacity>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────
const s = StyleSheet.create({
  // Setup
  pageTitle:   { fontFamily: "PlayfairDisplay_500Medium", fontSize: 38, color: "#1A2820", letterSpacing: -0.4 },
  pageSubtitle:{ fontFamily: "DMSans_400Regular", fontSize: 14, color: "#6B7A6E", marginTop: 6 },
  fieldLabel:  { fontFamily: "Orbitron_400Regular", fontSize: 9,  color: "#A8B0A8", letterSpacing: 2.4, marginBottom: 10 },
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
    paddingVertical: 16, borderRadius: 16,
    backgroundColor: "#1F3A2A", alignItems: "center",
  },
  ctaBtnDisabled: { backgroundColor: "#C2DDD3" },
  ctaBtnText: { fontFamily: "DMSans_500Medium", fontSize: 14, color: "#FAF6EE", letterSpacing: 0.2 },

  // Active
  focusScreen: { flex: 1 },
  focusHeader: {
    paddingTop: Platform.OS === "ios" ? 58 : 36,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  focusKicker: { fontFamily: FF.kicker, fontSize: 10, letterSpacing: 2.4, marginBottom: 8 },
  focusTitle: { fontFamily: FF.display, fontSize: 34, letterSpacing: -0.4, marginBottom: 18 },
  focusTaskPill: {
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  focusTaskText: { flexShrink: 1, fontFamily: FF.bodyMed, fontSize: 14, lineHeight: 18, textAlign: "center" },
  focusCenter: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  timerText:  { fontFamily: FF.display, fontSize: 50, letterSpacing: 0 },
  timerSub:   { fontFamily: FF.bodyMed, fontSize: 12, marginTop: 8 },
  focusStats: { flexDirection: "row", gap: 12, width: "100%", marginTop: 26 },
  focusStat: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
  },
  focusStatValue: { fontFamily: FF.display, fontSize: 24, letterSpacing: -0.3 },
  focusStatLabel: { fontFamily: FF.body, fontSize: 11, marginTop: 3 },
  focusActions: { paddingHorizontal: 24, paddingBottom: Platform.OS === "ios" ? 48 : 28, gap: 10 },
  completeBtn: {
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  completeBtnText: { fontFamily: FF.bodyMed, fontSize: 15 },
  abandonBtn: { height: 42, alignItems: "center", justifyContent: "center" },
  abandonText: { fontFamily: FF.bodyMed, fontSize: 13 },

  // Done
  doneScreen: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28 },
  doneHero: {
    width: 148,
    height: 148,
    borderRadius: 74,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 22,
    overflow: "hidden",
  },
  doneKicker: { fontFamily: FF.kicker, fontSize: 10, letterSpacing: 2.4, marginBottom: 8 },
  doneTitle: { fontFamily: FF.display, fontSize: 38, letterSpacing: -0.5, marginBottom: 8 },
  doneTask:  { fontFamily: FF.body, fontSize: 14, lineHeight: 20, textAlign: "center", marginBottom: 30 },
  doneStats: { flexDirection: "row", gap: 12, width: "100%", marginBottom: 34 },
  doneCard: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: "center",
  },
  doneVal:      { fontFamily: FF.display, fontSize: 28, letterSpacing: -0.4 },
  doneCardLabel:{ fontFamily: FF.body, fontSize: 11, marginTop: 4 },
  collectBtn: {
    width: "100%",
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  collectBtnText: { fontFamily: FF.bodyMed, fontSize: 15 },
});
