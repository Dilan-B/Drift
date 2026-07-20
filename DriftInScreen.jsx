/**
 * DriftInScreen.jsx
 * Deep-focus lock mode. User commits to a task, enters an immersive countdown.
 * BackHandler blocks accidental exits. expo-keep-awake keeps the screen on.
 *
 * Design: the setup page is "the greenhouse door" — one composed session card
 * on warm paper with quiet aurora pools, not a form. Active and done phases
 * live in the night greenhouse (always dark, by design: the focus room is the
 * same room at any hour).
 */
import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, TouchableOpacity, TextInput, StyleSheet,
  BackHandler, Alert, Animated, Platform, StatusBar,
  ScrollView, AppState, KeyboardAvoidingView,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import Svg, { Circle as SvgCircle } from "react-native-svg";
import { FF, getTheme } from "./theme";
import Slider from "@react-native-community/slider";
import { selectionTick } from "./haptics";
import { CheckIcon } from "./Icons";
import Sprout, { LeafGlyph } from "./SproutArt";

// Persisted in-progress session so the countdown survives backgrounding and even
// an app kill — the timer is wall-clock based (an end timestamp), not a ticking
// counter, so it keeps progressing while Drift is closed.
const SESSION_KEY = "drift_driftin_session";

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

function ProgressRing({ progress, accent, track }) {
  const offset = RING_CIRC * (1 - Math.min(1, Math.max(0, progress)));
  return (
    <Svg width={260} height={260} style={StyleSheet.absoluteFill}>
      {/* Track */}
      <SvgCircle cx={130} cy={130} r={RING_R}
        stroke={track} strokeWidth={6} fill="none" />
      {/* Fill */}
      <SvgCircle cx={130} cy={130} r={RING_R}
        stroke={accent} strokeWidth={6} fill="none"
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

// ── Length slider with sprouting leaves along the track ──────
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

  // Feedback on each step crossing: a haptic tick plus a quick swell of the
  // filled track. Fired only when the value actually changes step, so dragging
  // within one step stays silent instead of machine-gunning.
  const lastValRef = useRef(value);
  const pulse = useRef(new Animated.Value(0)).current;

  const handleChange = (v) => {
    if (v !== lastValRef.current) {
      lastValRef.current = v;
      selectionTick();
      pulse.setValue(1);
      Animated.timing(pulse, {
        toValue: 0, duration: 180, useNativeDriver: false,
      }).start();
    }
    onValueChange(v);
  };

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
          <Animated.View style={{
            width: `${pct * 100}%`,
            height: "100%",
            backgroundColor: accent,
            borderRadius: 8,
            // Brief brightening on each step — visible feedback for anyone
            // with system haptics turned off.
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.62] }),
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
          onValueChange={handleChange}
          minimumTrackTintColor="transparent"
          maximumTrackTintColor="transparent"
          thumbTintColor={accent}
          style={{ width: "100%", height: 34 }}
        />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: -2 }}>
        <Text style={{ fontFamily: FF.body, fontSize: 10, color: textColor }}>{leftLabel}</Text>
        <Text style={{ fontFamily: FF.body, fontSize: 10, color: textColor }}>{rightLabel}</Text>
      </View>
    </View>
  );
}

// Most screen time a single Drift In session can pay out, however long it ran.
// Sessions themselves are still unrestricted — a 5-hour deep-work block is a
// fine thing to do, it just doesn't buy more than an hour of phone.
const MAX_EARN_MINS = 60;

// ── Main component ────────────────────────────────────────────
// Memoized: stays mounted in the tab filmstrip; see SocialScreen note.
function DriftInScreen({ onSessionComplete, onSessionStart, onSessionTick, onSessionEnd, dark = false }) {
  const theme = getTheme(dark);
  // Setup-phase colors follow the app theme; active/done always use dark forest
  const [phase,   setPhase]   = useState("setup"); // setup | active | done
  const [task,    setTask]    = useState("");
  const [showInfo, setShowInfo] = useState(false);
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
  // Screen time = HALF the time drifted in, capped at MAX_EARN_MINS. A 5h
  // session earns the same hour a 2h session does — long sessions are still
  // worth doing for the XP, which is uncapped.
  const creditsEarned = Math.min(MAX_EARN_MINS, Math.floor(focusMins / 2));
  const xpEarned      = focusMins > 0 ? Math.round(focusMins * 1.5 * 0.45 + 8) : 0;
  const progress      = secTotal > 0 ? elapsed / secTotal : 0;

  // Night-greenhouse tokens for the active/done rooms (always dark by design).
  const focusTheme = getTheme(true);
  const focusInk   = focusTheme.ink;
  const focusPaper = focusTheme.paper;
  const focusEarn  = focusTheme.earn;

  // ──────────────────────────────────────────────────────────
  // SETUP — "the greenhouse door"
  // ──────────────────────────────────────────────────────────
  const { ink, paper, earn, fx } = theme;

  if (phase === "setup") {
    const ready = !!task.trim();
    const durLabel = dur >= 60
      ? `${Math.floor(dur / 60)}h ${dur % 60 ? `${dur % 60}m` : ""}`.trim()
      : `${dur}m`;
    return (
      <View style={{ flex: 1, backgroundColor: paper.warm }}>
        <StatusBar barStyle={dark ? "light-content" : "dark-content"} />

        {/* Aurora pools — the same quiet light as the rest of the app */}
        <View pointerEvents="none" style={{
          position: "absolute", top: -120, right: -90,
          width: 300, height: 300, borderRadius: 150,
          backgroundColor: fx.auroraMint,
        }} />
        <View pointerEvents="none" style={{
          position: "absolute", bottom: -130, left: -100,
          width: 280, height: 280, borderRadius: 140,
          backgroundColor: fx.auroraClay,
        }} />

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 24, paddingBottom: 20 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header — editorial */}
          <View style={{ marginBottom: 26 }}>
            <Text style={{
              fontFamily: FF.kicker, fontSize: 10, letterSpacing: 2.4,
              color: ink.faint, marginBottom: 6,
            }}>
              DEEP FOCUS
            </Text>
            <Text style={{ fontFamily: FF.display, fontSize: 40, color: ink.deep, letterSpacing: -0.4 }}>
              Drift in
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 8, gap: 8 }}>
              <Text style={{ fontFamily: FF.body, fontSize: 14, color: ink.mid, lineHeight: 20, flexShrink: 1 }}>
                One task, full attention. The rest can wait.
              </Text>
              <TouchableOpacity
                onPress={() => setShowInfo(v => !v)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                activeOpacity={0.7}
                style={{
                  width: 20, height: 20, borderRadius: 10,
                  borderWidth: 1.2, borderColor: showInfo ? earn.sage : ink.faint,
                  alignItems: "center", justifyContent: "center",
                  backgroundColor: showInfo ? earn.sageLo : "transparent",
                }}
              >
                <Text style={{
                  fontFamily: FF.serifReg, fontSize: 12, lineHeight: 15,
                  color: showInfo ? earn.sage : ink.faint,
                }}>
                  i
                </Text>
              </TouchableOpacity>
            </View>
            {showInfo && (
              <View style={{
                marginTop: 12,
                backgroundColor: paper.card,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: ink.border,
                padding: 16,
              }}>
                <Text style={s.fieldKicker(ink)}>HOW IT WORKS</Text>
                <Text style={{ fontFamily: FF.body, fontSize: 13, color: ink.mid, lineHeight: 20 }}>
                  Name the one thing you want to focus on and choose a length.
                  While you're drifted in, your blocked apps stay locked and the
                  timer keeps running even if you close Drift. Finish the session
                  and half of your focused time comes back as screen time — up to
                  a maximum of 60 minutes — plus experience toward your tier,
                  which isn't capped. Abandoning early earns nothing.
                </Text>
              </View>
            )}
          </View>

          {/* Session card — one composed object, not a stack of form fields */}
          <View style={{
            backgroundColor: paper.card,
            borderRadius: 26,
            borderWidth: 1,
            borderColor: ink.border,
            padding: 22,
            overflow: "hidden",
          }}>
            {/* Sprout watermark tucked behind the corner */}
            <View pointerEvents="none" style={{
              position: "absolute", right: -18, top: -14,
              opacity: dark ? 0.10 : 0.08,
            }}>
              <Sprout size={110} tone={dark ? "night" : "fresh"} />
            </View>

            {/* Length */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <Text style={[s.fieldKicker(ink), { marginBottom: 0 }]}>LENGTH</Text>
              <Text style={{ fontFamily: FF.display, fontSize: 24, color: ink.deep, letterSpacing: -0.4 }}>
                {durLabel}
              </Text>
            </View>
            <PlantSlider
              minimumValue={15}
              maximumValue={300}
              step={15}
              value={dur}
              onValueChange={setDur}
              accent={earn.sage}
              track={ink.ghost}
              soil={ink.border}
              textColor={ink.faint}
              leftLabel="15m"
              rightLabel="5h"
            />

            <View style={s.divider(ink)} />

            {/* Earn preview — a quiet divided row, not two shouting boxes */}
            <Text style={s.fieldKicker(ink)}>YOU'LL EARN</Text>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: FF.display, fontSize: 26, color: earn.sage, letterSpacing: -0.4 }}>
                  {Math.min(MAX_EARN_MINS, Math.floor(dur / 2))}m
                </Text>
                <Text style={{ fontFamily: FF.body, fontSize: 11, color: ink.mid, marginTop: 2 }}>
                  {Math.floor(dur / 2) > MAX_EARN_MINS ? "screen time (max)" : "screen time"}
                </Text>
              </View>
              <View style={{ width: 1, height: 36, backgroundColor: ink.hairline, marginHorizontal: 16 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: FF.display, fontSize: 26, color: earn.clay, letterSpacing: -0.4 }}>
                  +{Math.round(dur * 1.5 * 0.45 + 8)}
                </Text>
                <Text style={{ fontFamily: FF.body, fontSize: 11, color: ink.mid, marginTop: 2 }}>
                  experience
                </Text>
              </View>
            </View>
          </View>
        </ScrollView>

        {/* Bottom dock — the task input lives down here, in thumb reach */}
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 100 : 0}
        >
          <View style={{ paddingHorizontal: 22, paddingTop: 8, paddingBottom: 14 }}>
            <View style={{
              backgroundColor: paper.card,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: ink.border,
              padding: 14,
            }}>
              <TextInput
                value={task}
                onChangeText={setTask}
                placeholder="What needs your attention?"
                placeholderTextColor={ink.faint}
                maxLength={80}
                style={{
                  backgroundColor: paper.sand,
                  borderWidth: 1.2,
                  borderColor: ready ? earn.sage : "transparent",
                  borderRadius: 16,
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  fontFamily: FF.bodyMed,
                  fontSize: 15,
                  color: ink.deep,
                }}
                multiline={false}
                returnKeyType="go"
                onSubmitEditing={() => { if (ready) startSession(); }}
                autoFocus={false}
              />
              <TouchableOpacity
                onPress={startSession}
                disabled={!ready}
                activeOpacity={0.85}
                style={[
                  {
                    height: 54,
                    borderRadius: 18,
                    alignItems: "center",
                    justifyContent: "center",
                    flexDirection: "row",
                    gap: 9,
                    marginTop: 10,
                    backgroundColor: ready ? earn.deep : ink.ghost,
                  },
                  ready && fx.glow,
                ]}
              >
                {ready && <LeafGlyph size={15} color={dark ? "#16261C" : "#FAF6EE"} />}
                <Text style={{
                  fontFamily: FF.bodyMed, fontSize: 15, letterSpacing: 0.2,
                  color: ready ? (dark ? "#16261C" : "#FAF6EE") : ink.faint,
                }}>
                  {ready ? "Drift in" : "Name your task first"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    );
  }

  // ──────────────────────────────────────────────────────────
  // ACTIVE SESSION — the night greenhouse
  // ──────────────────────────────────────────────────────────
  if (phase === "active") return (
    <View style={{ flex: 1, backgroundColor: focusInk.void }}>
      <StatusBar barStyle="light-content" />

      {/* Aurora — the focus room breathes the same night-greenhouse air */}
      <View pointerEvents="none" style={{
        position: "absolute", top: -110, right: -80,
        width: 280, height: 280, borderRadius: 140,
        backgroundColor: focusTheme.fx.auroraMint,
      }} />
      <View pointerEvents="none" style={{
        position: "absolute", bottom: -120, left: -90,
        width: 260, height: 260, borderRadius: 130,
        backgroundColor: focusTheme.fx.auroraClay,
      }} />

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
          width: 260,
          height: 260,
          alignItems: "center", justifyContent: "center",
          transform: [{ scale: pulseAnim }],
        }}>
          <ProgressRing
            progress={progress}
            accent={focusEarn.sage}
            track="rgba(198,242,160,0.10)"
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

        {/* Quiet stat tiles — ghost surfaces, no chrome */}
        <View style={s.focusStats}>
          <View style={[s.focusStat, { backgroundColor: focusInk.ghost }]}>
            <Text style={[s.focusStatValue, { color: focusEarn.sage }]}>{Math.max(0, Math.floor(secLeft / 60))}m</Text>
            <Text style={[s.focusStatLabel, { color: focusInk.mid }]}>remaining</Text>
          </View>
          <View style={[s.focusStat, { backgroundColor: focusInk.ghost }]}>
            <Text style={[s.focusStatValue, { color: focusEarn.clay }]}>{Math.round(progress * 100)}%</Text>
            <Text style={[s.focusStatLabel, { color: focusInk.mid }]}>complete</Text>
          </View>
        </View>
      </View>

      <View style={s.focusActions}>
        <TouchableOpacity onPress={completeEarly} style={[s.completeBtn, { backgroundColor: focusEarn.deep }, focusTheme.fx.glow]}>
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
          <Text style={[s.abandonText, { color: focusInk.faint }]}>Abandon session</Text>
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

      <View pointerEvents="none" style={{
        position: "absolute", top: -100, right: -80,
        width: 260, height: 260, borderRadius: 130,
        backgroundColor: focusTheme.fx.auroraMint,
      }} />
      <View pointerEvents="none" style={{
        position: "absolute", bottom: -110, left: -80,
        width: 240, height: 240, borderRadius: 120,
        backgroundColor: focusTheme.fx.auroraClay,
      }} />

      <View style={[s.doneHero, { backgroundColor: focusEarn.sageLo, borderColor: focusInk.border }]}>
        <Sprout size={116} tone="night" />
      </View>
      <Text style={[s.doneKicker, { color: focusInk.faint }]}>SESSION COMPLETE</Text>
      <Text style={[s.doneTitle, { color: focusInk.deep }]}>Good work.</Text>
      <Text style={[s.doneTask, { color: focusInk.mid }]} numberOfLines={2}>
        {"“"}{task}{"”"}
      </Text>

      {/* Stats — same ghost tiles as the focus room */}
      <View style={s.doneStats}>
        <View style={[s.doneCard, { backgroundColor: focusInk.ghost }]}>
          <Text style={[s.doneVal, { color: focusEarn.sage }]}>{creditsEarned}m</Text>
          <Text style={[s.doneCardLabel, { color: focusInk.mid }]}>screen time</Text>
        </View>
        <View style={[s.doneCard, { backgroundColor: focusInk.ghost }]}>
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
        style={[s.collectBtn, { backgroundColor: focusEarn.deep }, focusTheme.fx.glow]}
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
const s = {
  // Setup helpers (functions of ink so they follow the theme)
  fieldKicker: (ink) => ({
    fontFamily: FF.kicker, fontSize: 9, color: ink.faint,
    letterSpacing: 2.4, marginBottom: 10,
  }),
  divider: (ink) => ({
    height: 1, backgroundColor: ink.hairline, marginVertical: 20,
  }),

  // Active
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
    borderRadius: 18,
    paddingVertical: 15,
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
  abandonText: { fontFamily: FF.body, fontSize: 13 },

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
  doneTitle: { fontFamily: FF.display, fontSize: 38, letterSpacing: -0.5, marginBottom: 10 },
  doneTask:  {
    fontFamily: "PlayfairDisplay_700Bold_Italic", fontSize: 16,
    lineHeight: 22, textAlign: "center", marginBottom: 30,
  },
  doneStats: { flexDirection: "row", gap: 12, width: "100%", marginBottom: 34 },
  doneCard: {
    flex: 1,
    borderRadius: 18,
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
};

export default React.memo(DriftInScreen);
