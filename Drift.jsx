import React, { useState, useEffect, useRef, useCallback, useContext, createContext } from "react";
import {
  View, Text, TouchableOpacity, TextInput, ScrollView,
  StyleSheet, SafeAreaView, KeyboardAvoidingView,
  StatusBar, Platform, Alert, AppState, Modal, PanResponder, Animated,
  ActivityIndicator, Linking,
} from "react-native";
import { getTheme } from "./theme";
import AICheckModal from "./AICheckModal";
import { evaluateTask } from "./aiEvaluate";
import { useSubscription, createCheckoutSession } from "./useSubscription";
import BlockedAppsModal from "./BlockedAppsModal";
import { applyBlocking, clearBlocking } from "./blockedApps";
import { useFonts } from "expo-font";
import {
  Orbitron_400Regular,
  Orbitron_700Bold,
} from "@expo-google-fonts/orbitron";
import {
  Oswald_400Regular,
  Oswald_700Bold,
} from "@expo-google-fonts/oswald";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Svg, { Path, Circle as SvgCircle, Rect } from "react-native-svg";
import { supabase, syncScreenTime } from "./supabase";
import SocialScreen from "./SocialScreen";
import PaywallScreen, { initTrial, getTrialStatus } from "./PaywallScreen";
import OnboardingScreen from "./OnboardingScreen";
import DriftInScreen from "./DriftInScreen";

// ── Theme context ─────────────────────────────────────────────
export const ThemeContext = createContext({ dark: false, theme: getTheme(false) });
const useTheme = () => useContext(ThemeContext);

// ── Design tokens (light defaults — components use useTheme()) ─
const ink = {
  void: "#0B1A11", deep: "#1A2B1F", mid: "#6B8A78",
  faint: "#A8BFB5", ghost: "rgba(26,43,31,0.07)", border: "rgba(26,43,31,0.09)",
};
const paper = { warm: "#F4F9F6", card: "#FFFFFF" };
const earn = {
  terra: "#2FAB72", terraLo: "#E4F5EE",
  green: "#1A8050", greenLo: "#DDF2EA", greenD: "#0E5434",
  blue: "#5AB4D4", blueLo: "#E6F4FB",
};
const FO  = "Orbitron_700Bold";    // display headings
const FOM = "Orbitron_400Regular"; // medium display
const FK  = "Oswald_700Bold";      // Oswald bold — subheadings + task names
const FKR = "Oswald_400Regular";   // Oswald regular
const FB  = undefined;             // system sans-serif body

// ── Data constants ───────────────────────────────────────────
const CATS = {
  work:     { e: "💼", c: "#3A7AB8", l: "Work" },
  physical: { e: "💪", c: "#2FAB72", l: "Physical" },
  outdoor:  { e: "🌿", c: "#3DA870", l: "Outdoor" },
  learning: { e: "📚", c: "#7B6EC8", l: "Learning" },
  life:     { e: "🏠", c: "#5AB4D4", l: "Life" },
  social:   { e: "💬", c: "#3A9BB5", l: "Social" },
};

const EFFORT = [
  { id: 1, label: "Light",    mult: 0.5,  desc: "Quick task, easy admin, low exertion" },
  { id: 2, label: "Moderate", mult: 0.75, desc: "Focused work, gym, cooking, studying" },
  { id: 3, label: "Intense",  mult: 1.25, desc: "Hard workout, deep sprint, long outdoor" },
];


const LEVELS = [
  { name: "Seedling",   min: 0,    e: "🌱" },
  { name: "Sprout",     min: 150,  e: "🌿" },
  { name: "Sapling",    min: 400,  e: "🌳" },
  { name: "Grove",      min: 900,  e: "🏕️" },
  { name: "Canopy",     min: 2000, e: "🌲" },
  { name: "Forest",     min: 4000, e: "🌾" },
  { name: "Old Growth", min: 8000, e: "🏔️" },
];

// ── Helpers ──────────────────────────────────────────────────
const calcCredits = (mins, effort) => Math.round(mins * (EFFORT.find(e => e.id === effort)?.mult || 1));
const calcXp      = (mins, effort) => Math.round(mins * (EFFORT.find(e => e.id === effort)?.mult || 1) * 0.45 + 8);
const fmtMins = m => m <= 0 ? "0m" : m < 60 ? `${m}m` : m % 60 > 0 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}h`;
const fmtSecs = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const getLevel  = xp => [...LEVELS].reverse().find(l => xp >= l.min) || LEVELS[0];
const xpProg    = xp => { const lv = getLevel(xp); const ni = LEVELS.findIndex(l => l.min > xp); if (ni === -1) return 1; return (xp - lv.min) / (LEVELS[ni].min - lv.min); };
const xpToNext  = xp => { const ni = LEVELS.findIndex(l => l.min > xp); return ni === -1 ? 0 : LEVELS[ni].min - xp; };
const todayKey    = () => new Date().toISOString().slice(0, 10);
const clockStr    = () => new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
const fmtSecLeft  = s => {
  if (s <= 0)   return "locked";
  if (s < 60)   return `0:${String(s).padStart(2, "0")}`;
  if (s < 3600) return `${Math.floor(s/60)}:${String(s%60).padStart(2, "0")}`;
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
};

// ── Storage (in-memory) ──────────────────────────────────────
const _store = {};
const storage = {
  get: async (key) => ({ value: _store[key] ?? null }),
  set: async (key, value) => { _store[key] = value; },
};

// ── Credit Ticker ────────────────────────────────────────────
function CreditTicker({ value, textColor }) {
  const prevRef = useRef(value);
  const [show, setShow] = useState(value);
  const animRef = useRef(null);
  useEffect(() => {
    if (value === prevRef.current) return;
    if (animRef.current) clearInterval(animRef.current);
    const start = prevRef.current, diff = value - start;
    const steps = Math.min(Math.abs(diff), 18);
    let step = 0;
    animRef.current = setInterval(() => {
      step++;
      const cur = Math.round(start + diff * (step / steps));
      setShow(cur); prevRef.current = cur;
      if (step >= steps) { clearInterval(animRef.current); setShow(value); prevRef.current = value; }
    }, 40);
    return () => { if (animRef.current) clearInterval(animRef.current); };
  }, [value]);
  return (
    <Text style={{ fontFamily: FO, fontSize: 38, color: textColor || "#FFFFFF", letterSpacing: 1 }}>
      {fmtMins(show)}
    </Text>
  );
}

// Heuristic fallback when AI eval is unavailable (no sub)
function heuristicCredits(title, mins, category) {
  const t = (title || "").toLowerCase();
  let mult = 0.6;
  if (/deep work|study|exam|sprint|workout|gym|run|interview|writing|build|code/i.test(t)) mult = 1.0;
  else if (/walk|read|cook|clean|chores|errand|practice/i.test(t)) mult = 0.75;
  else if (/scroll|browse|chat|text|nap/i.test(t)) mult = 0.35;
  if (category === "physical" || category === "learning") mult = Math.max(mult, 0.85);
  const credits = Math.max(1, Math.round(mins * mult));
  const xp      = Math.max(5, Math.round(credits * 0.6 + 8));
  return { credits, xp, reasoning: "Estimated locally (no AI)." };
}

// ── Add Task Overlay ─────────────────────────────────────────
function AddTaskOverlay({ onSave, onClose, userId, isSubActive, onOpenPaywall }) {
  const { dark, theme } = useTheme();
  const { ink, paper, earn } = theme;

  const [title,    setTitle]    = useState("");
  const [cat,      setCat]      = useState("work");
  const [mins,     setMins]     = useState(30);
  const [aiCheck,  setAiCheck]  = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [evalError,  setEvalError]  = useState("");

  // Swipe right to dismiss
  const slideX   = useRef(new Animated.Value(0)).current;
  const swipeRef = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) =>
        gs.dx > 0 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.8 && gs.dx > 12,
      onPanResponderMove: (_, gs) => {
        if (gs.dx > 0) slideX.setValue(gs.dx);
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dx > 100) {
          Animated.timing(slideX, { toValue: 400, duration: 180, useNativeDriver: true }).start(onClose);
        } else {
          Animated.spring(slideX, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  useEffect(() => {
    if (title.length < 4) return;
    const lo = title.toLowerCase();
    const minM = title.match(/(\d+)\s*(?:min|m\b)/i);
    const hrM  = title.match(/(\d+)\s*(?:hr|h\b)/i);
    if (minM) setMins(parseInt(minM[1]));
    else if (hrM) setMins(parseInt(hrM[1]) * 60);
    if      (/gym|run|push|squat|lift|workout|swim|yoga/i.test(lo)) setCat("physical");
    else if (/walk|outside|park|hike|garden/i.test(lo))             setCat("outdoor");
    else if (/work|meeting|email|report|code|call|zoom/i.test(lo))  setCat("work");
    else if (/read|study|learn|book|practice/i.test(lo))            setCat("learning");
    else if (/friend|dinner|date|mom|dad|drinks/i.test(lo))         setCat("social");
  }, [title]);

  const save = async () => {
    if (!title.trim() || evaluating) return;
    setEvaluating(true);
    setEvalError("");

    const buildTask = ({ credits, xp, reasoning, aiValued }) => ({
      id: `t_${Date.now()}`,
      title:   title.trim(),
      cat,
      minutes: mins,
      done:    false,
      credits,
      xp,
      aiCheck:  aiCheck && isSubActive, // can't claim AI check if not subscribed
      aiValued: !!aiValued,
      aiReasoning: reasoning || "",
    });

    // Free user → heuristic credits, no AI eval call
    if (!isSubActive) {
      const { credits, xp, reasoning } = heuristicCredits(title.trim(), mins, cat);
      onSave(buildTask({ credits, xp, reasoning, aiValued: false }));
      onClose();
      return;
    }

    // Subscribed → server-side AI eval
    try {
      const { credits, xp, reasoning } = await evaluateTask({
        title:    title.trim(),
        mins,
        category: cat,
      });
      onSave(buildTask({ credits, xp, reasoning, aiValued: true }));
      onClose();
    } catch (e) {
      if (e?.code === "subscription_required") {
        const { credits, xp, reasoning } = heuristicCredits(title.trim(), mins, cat);
        onSave(buildTask({ credits, xp, reasoning, aiValued: false }));
        onClose();
        return;
      }
      setEvalError(e?.message || "AI evaluation failed. Try again.");
      setEvaluating(false);
    }
  };

  const safeTop = Platform.OS === "ios" ? 54 : (StatusBar.currentHeight || 24) + 8;

  return (
    <Animated.View style={{ flex: 1, transform: [{ translateX: slideX }] }}
      {...swipeRef.panHandlers}>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: paper.warm }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {/* Header — pushed below status bar */}
        <View style={{
          flexDirection: "row", alignItems: "center",
          paddingTop: safeTop, paddingBottom: 14, paddingHorizontal: 20,
          backgroundColor: paper.card,
          borderBottomWidth: 0.5, borderBottomColor: ink.border,
        }}>
          <TouchableOpacity onPress={onClose} style={{ marginRight: 12 }}>
            <Text style={{ fontSize: 22, color: ink.mid, lineHeight: 26 }}>×</Text>
          </TouchableOpacity>
          <Text style={{ fontFamily: FK, fontSize: 17, color: ink.deep, flex: 1 }}>Add task</Text>
          <View style={{
            flexDirection: "row", alignItems: "center", gap: 5,
            backgroundColor: isSubActive ? earn.blueLo : ink.ghost, borderRadius: 10,
            paddingVertical: 4, paddingHorizontal: 10,
          }}>
            <Text style={{ fontSize: 11 }}>{isSubActive ? "✦" : "·"}</Text>
            <Text style={{ fontFamily: FOM, fontSize: 9, color: isSubActive ? earn.blue : ink.mid, letterSpacing: 1 }}>
              {isSubActive ? "AI VALUED" : "STANDARD"}
            </Text>
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
          {/* AI-valued notice or upgrade prompt */}
          {isSubActive ? (
            <View style={{
              flexDirection: "row", alignItems: "center", gap: 10,
              padding: 14, backgroundColor: earn.blueLo, borderRadius: 12, marginBottom: 14,
              borderWidth: 1, borderColor: "rgba(90,180,212,0.2)",
            }}>
              <Text style={{ fontSize: 22 }}>✦</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: FK, fontSize: 13, color: earn.blue, marginBottom: 2 }}>AI sets the credits</Text>
                <Text style={{ fontFamily: FB, fontSize: 11, color: "#2A7FA0", lineHeight: 16 }}>
                  Reward is calculated based on the task and duration when you save.
                </Text>
              </View>
            </View>
          ) : (
            <TouchableOpacity onPress={onOpenPaywall} style={{
              flexDirection: "row", alignItems: "center", gap: 10,
              padding: 14, backgroundColor: ink.ghost, borderRadius: 12, marginBottom: 14,
              borderWidth: 1, borderColor: ink.border,
            }}>
              <Text style={{ fontSize: 22 }}>🔒</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: FK, fontSize: 13, color: ink.deep, marginBottom: 2 }}>Unlock AI evaluation</Text>
                <Text style={{ fontFamily: FB, fontSize: 11, color: ink.mid, lineHeight: 16 }}>
                  Tap to upgrade — credits are estimated locally until then.
                </Text>
              </View>
              <Text style={{ fontFamily: FO, fontSize: 9, color: earn.terra, letterSpacing: 1 }}>UPGRADE ›</Text>
            </TouchableOpacity>
          )}

          {/* Title */}
          <View style={{ marginBottom: 14 }}>
            <Text style={[s.label, { color: ink.faint }]}>What needs doing?</Text>
            <TextInput
              value={title} onChangeText={setTitle}
              placeholder='e.g. "30 min gym" or "finish report"'
              placeholderTextColor={ink.faint}
              returnKeyType="done"
              blurOnSubmit={true}
              style={{
                padding: 11, paddingHorizontal: 14, borderRadius: 10,
                borderWidth: 1, borderColor: ink.border,
                fontFamily: FB, fontSize: 14,
                backgroundColor: paper.card, color: ink.deep,
              }}
            />
          </View>

          {/* Category */}
          <View style={{ marginBottom: 14 }}>
            <Text style={[s.label, { color: ink.faint }]}>Category</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
              {Object.entries(CATS).map(([k, v]) => (
                <TouchableOpacity key={k} onPress={() => setCat(k)} style={{
                  paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20,
                  borderWidth: 1.5,
                  borderColor: cat === k ? v.c : ink.border,
                  backgroundColor: cat === k ? `${v.c}18` : "transparent",
                }}>
                  <Text style={{ fontFamily: FB, fontSize: 11, fontWeight: cat === k ? "600" : "400", color: cat === k ? v.c : ink.mid }}>
                    {v.e} {v.l}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Duration */}
          <View style={{ marginBottom: 14 }}>
            <Text style={[s.label, { color: ink.faint }]}>Duration</Text>
            <View style={{ flexDirection: "row", gap: 7 }}>
              {[15, 30, 45, 60, 90, 120].map(d => (
                <TouchableOpacity key={d} onPress={() => setMins(d)} style={{
                  flex: 1, paddingVertical: 9, borderRadius: 10,
                  borderWidth: 1.5,
                  borderColor: mins === d ? earn.terra : ink.border,
                  backgroundColor: mins === d ? earn.terraLo : "transparent",
                }}>
                  <Text style={{ fontFamily: FB, fontSize: 12, fontWeight: mins === d ? "600" : "400", color: mins === d ? earn.terra : ink.mid, textAlign: "center" }}>
                    {d < 60 ? `${d}m` : `${d / 60}h`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* ── AI Check toggle ── */}
          <TouchableOpacity
            onPress={() => isSubActive ? setAiCheck(v => !v) : onOpenPaywall?.()}
            style={{
              flexDirection: "row", alignItems: "center", gap: 12,
              paddingVertical: 13, paddingHorizontal: 14, borderRadius: 12, marginBottom: 10,
              borderWidth: 1.5,
              borderColor: aiCheck && isSubActive ? earn.blue : ink.border,
              backgroundColor: aiCheck && isSubActive ? earn.blueLo : "transparent",
              opacity: isSubActive ? 1 : 0.7,
            }}
          >
            <Text style={{ fontSize: 20 }}>{isSubActive ? "✦" : "🔒"}</Text>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={{ fontFamily: FK, fontSize: 14, fontWeight: "600", color: aiCheck && isSubActive ? earn.blue : ink.deep }}>
                  AI Check
                </Text>
                <View style={{ backgroundColor: isSubActive ? earn.blueLo : ink.ghost, borderRadius: 6, paddingVertical: 1, paddingHorizontal: 6 }}>
                  <Text style={{ fontFamily: FOM, fontSize: 8, color: isSubActive ? earn.blue : ink.mid, letterSpacing: 1 }}>
                    {isSubActive ? "BETA" : "PRO"}
                  </Text>
                </View>
              </View>
              <Text style={{ fontFamily: FB, fontSize: 11, color: ink.mid, marginTop: 2 }}>
                {isSubActive
                  ? "Must submit photo or text proof to earn credits"
                  : "Subscribe to verify completions with AI"}
              </Text>
            </View>
            {/* Toggle pill (only when subscribed) */}
            {isSubActive && (
              <View style={{
                width: 40, height: 24, borderRadius: 12,
                backgroundColor: aiCheck ? earn.blue : ink.ghost,
                justifyContent: "center",
                paddingHorizontal: 3,
              }}>
                <View style={{
                  width: 18, height: 18, borderRadius: 9, backgroundColor: "#fff",
                  alignSelf: aiCheck ? "flex-end" : "flex-start",
                }} />
              </View>
            )}
          </TouchableOpacity>

          {/* Add bottom spacing where Lock Phone toggle used to be */}
          <View style={{ marginBottom: 10 }} />

          {!!evalError && (
            <View style={{
              padding: 11, borderRadius: 10, marginBottom: 10,
              backgroundColor: "rgba(224,80,80,0.1)",
              borderWidth: 1, borderColor: "rgba(224,80,80,0.2)",
            }}>
              <Text style={{ fontFamily: FB, fontSize: 12, color: "#A32D2D", textAlign: "center" }}>
                {evalError}
              </Text>
            </View>
          )}

          <TouchableOpacity
            onPress={save}
            disabled={!title.trim() || evaluating}
            style={{
              paddingVertical: 14, borderRadius: 14,
              backgroundColor: !title.trim() ? ink.faint : (evaluating ? "rgba(47,171,114,0.5)" : earn.terra),
              flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
            }}
          >
            {evaluating && <ActivityIndicator color="#fff" size="small" />}
            <Text style={{ fontFamily: FK, fontSize: 15, fontWeight: "600", color: "#fff", textAlign: "center" }}>
              {evaluating ? "AI is evaluating…" : "Add task"}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

// ── Task Verify Modal ─────────────────────────────────────────
// Asks 2 honest questions before awarding credits.
function TaskVerifyModal({ task, onConfirm, onCancel, dark }) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;
  const [step, setStep] = useState(0); // 0 = q1, 1 = q2, 2 = confirmed

  if (!task) return null;

  const QUESTIONS = [
    {
      q: `Did you actually spend ~${task.minutes} minutes on this?`,
      sub: "Be honest — estimates are fine, but it should be real time.",
      emoji: "⏱",
    },
    {
      q: "Was it focused, quality time?",
      sub: "Not half-distracted, not just started and stopped.",
      emoji: "🎯",
    },
  ];

  const confirm = () => {
    if (step < QUESTIONS.length - 1) { setStep(s => s + 1); return; }
    onConfirm();
  };

  const q = QUESTIONS[step];

  return (
    <Modal visible={!!task} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "flex-end" }}>
        <View style={{
          width: "100%", backgroundColor: paper.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
          padding: 28, paddingBottom: Platform.OS === "ios" ? 44 : 28,
        }}>
          {/* Step dots */}
          <View style={{ flexDirection: "row", justifyContent: "center", gap: 6, marginBottom: 24 }}>
            {QUESTIONS.map((_, i) => (
              <View key={i} style={{
                width: i === step ? 20 : 6, height: 6, borderRadius: 3,
                backgroundColor: i <= step ? earn.green : ink.ghost,
              }} />
            ))}
          </View>

          <Text style={{ fontSize: 36, textAlign: "center", marginBottom: 16 }}>{q.emoji}</Text>
          <Text style={{ fontFamily: FK, fontSize: 20, color: ink.deep, textAlign: "center", marginBottom: 8 }}>{q.q}</Text>
          <Text style={{ fontFamily: FB, fontSize: 13, color: ink.mid, textAlign: "center", lineHeight: 20, marginBottom: 28 }}>{q.sub}</Text>

          <TouchableOpacity onPress={confirm} style={{
            paddingVertical: 15, borderRadius: 14, backgroundColor: earn.green, alignItems: "center", marginBottom: 10,
          }}>
            <Text style={{ fontFamily: FK, fontSize: 16, color: "#fff" }}>
              {step < QUESTIONS.length - 1 ? "Yes, next →" : "Yes — claim credits"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={onCancel} style={{ paddingVertical: 12, alignItems: "center" }}>
            <Text style={{ fontFamily: FB, fontSize: 13, color: ink.mid }}>
              {step === 0 ? "Not really, cancel" : "No, cancel"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Today View ───────────────────────────────────────────────
function TodayView({ tasks, credits, totalXp, onComplete, onAdd, onSimSpend, dark }) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;

  const [verifyTask,   setVerifyTask]   = useState(null); // task being verified via prompts
  const [aiCheckTask,  setAiCheckTask]  = useState(null); // task being verified via AI

  const pending       = tasks.filter(t => !t.done);
  const done          = tasks.filter(t => t.done);
  const unlocked      = credits.balance > 0;
  const lv            = getLevel(totalXp);
  const stillEarnable = pending.reduce((s, t) => s + t.credits, 0);

  const handleTaskTap = (t) => {
    if (t.aiCheck) setAiCheckTask(t);
    else setVerifyTask(t);
  };

  return (
    <>
    {/* Task verify modal */}
    <TaskVerifyModal
      task={verifyTask}
      onConfirm={() => { onComplete(verifyTask.id); setVerifyTask(null); }}
      onCancel={() => setVerifyTask(null)}
      dark={dark}
    />
    {/* AI Check modal */}
    <AICheckModal
      visible={!!aiCheckTask}
      task={aiCheckTask}
      onVerified={() => { onComplete(aiCheckTask.id); setAiCheckTask(null); }}
      onCancel={() => setAiCheckTask(null)}
      dark={dark}
    />
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 18, paddingBottom: 110 }}>
      {/* Credit bank */}
      <View style={{
        borderRadius: 20, padding: 20, marginBottom: 12,
        backgroundColor: unlocked ? earn.terra : paper.card,
        overflow: "hidden",
        borderWidth: unlocked ? 0 : 1,
        borderColor: ink.border,
      }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View>
            <Text style={{
              fontFamily: FB, fontSize: 11, fontWeight: "600",
              color: unlocked ? "rgba(255,255,255,0.7)" : ink.faint,
              textTransform: "uppercase", letterSpacing: 1, marginBottom: 6,
            }}>
              {unlocked ? "Screen time balance" : "No time earned yet"}
            </Text>
            <CreditTicker value={credits.balance} textColor={unlocked ? "#FFFFFF" : ink.deep} />
            <Text style={{ fontFamily: FB, fontSize: 12, color: unlocked ? "rgba(255,255,255,0.6)" : ink.faint, marginTop: 4 }}>
              {unlocked ? "Available now" : "Complete a task below"}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: 28 }}>{unlocked ? "🔓" : "🔒"}</Text>
            <View style={{ backgroundColor: unlocked ? "rgba(255,255,255,0.15)" : earn.greenLo, borderRadius: 8, paddingVertical: 3, paddingHorizontal: 10, marginTop: 6 }}>
              <Text style={{ fontFamily: FB, fontSize: 10, fontWeight: "600", color: unlocked ? "rgba(255,255,255,0.8)" : earn.greenD }}>
                {lv.e} {lv.name}
              </Text>
            </View>
          </View>
        </View>

        {credits.earned > 0 && (
          <View style={{ flexDirection: "row", gap: 20, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: unlocked ? "rgba(255,255,255,0.15)" : ink.border }}>
            {[["Earned", fmtMins(credits.earned)], ["Used", fmtMins(credits.spent)], stillEarnable > 0 ? ["Earnable", fmtMins(stillEarnable)] : null]
              .filter(Boolean)
              .map(([l, v]) => (
                <View key={l}>
                  <Text style={{ fontFamily: FB, fontSize: 10, color: unlocked ? "rgba(255,255,255,0.5)" : ink.faint, marginBottom: 2 }}>{l}</Text>
                  <Text style={{ fontFamily: FO, fontSize: 13, color: unlocked ? "rgba(255,255,255,0.9)" : ink.deep, letterSpacing: 0.5 }}>{v}</Text>
                </View>
              ))}
          </View>
        )}
      </View>

      {unlocked && (
        <TouchableOpacity
          onPress={onSimSpend}
          style={{
            padding: 9, borderRadius: 10,
            borderWidth: 1, borderColor: earn.blue,
            backgroundColor: earn.blueLo, marginBottom: 12,
          }}
        >
          <Text style={{ fontFamily: FB, fontWeight: "500", fontSize: 12, color: earn.blue, textAlign: "center" }}>
            📱 Use 10 min of screen time (demo)
          </Text>
        </TouchableOpacity>
      )}

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <Text style={{ fontFamily: FK, fontSize: 18, color: ink.deep, fontStyle: "italic" }}>Today's work</Text>
        <TouchableOpacity
          onPress={onAdd}
          style={{
            flexDirection: "row", alignItems: "center", gap: 5,
            paddingVertical: 5, paddingHorizontal: 13,
            borderRadius: 20, borderWidth: 1.5, borderColor: earn.terra,
            backgroundColor: earn.terraLo,
          }}
        >
          <Text style={{ fontFamily: FB, fontWeight: "600", fontSize: 11, color: earn.terra }}>+ Add task</Text>
        </TouchableOpacity>
      </View>

      {tasks.length === 0 && (
        <View style={{ alignItems: "center", paddingVertical: 28 }}>
          <Text style={{ fontSize: 36, marginBottom: 10 }}>📋</Text>
          <Text style={{ fontFamily: FK, fontSize: 17, color: ink.mid, marginBottom: 6 }}>Nothing to earn from yet</Text>
          <Text style={{ fontFamily: FB, fontSize: 13, color: ink.faint, marginBottom: 22, textAlign: "center" }}>
            Add the work you actually need to do today.
          </Text>
          <TouchableOpacity
            onPress={onAdd}
            style={{
              paddingVertical: 16, paddingHorizontal: 28, borderRadius: 16,
              backgroundColor: earn.terra,
              flexDirection: "row", alignItems: "center", gap: 10,
              shadowColor: earn.terra, shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.25, shadowRadius: 12, elevation: 6,
            }}
          >
            <Text style={{ fontFamily: FO, fontSize: 18, color: "#fff" }}>+</Text>
            <Text style={{ fontFamily: FK, fontSize: 16, color: "#fff" }}>Add First Task</Text>
          </TouchableOpacity>
        </View>
      )}

      {pending.map(t => {
        const cat = CATS[t.cat] || CATS.life;
        return (
          <TouchableOpacity
            key={t.id}
            onPress={() => handleTaskTap(t)}
            style={{
              flexDirection: "row", alignItems: "center",
              backgroundColor: paper.card, borderRadius: 16,
              marginBottom: 8, overflow: "hidden",
              borderWidth: 0.5, borderColor: ink.border,
            }}
          >
            {(() => {
              const ratio = t.credits / Math.max(1, t.minutes);
              const intensity = ratio >= 1.0 ? 3 : ratio >= 0.7 ? 2 : 1;
              const h = intensity === 1 ? 24 : intensity === 2 ? 36 : 48;
              return (
                <View style={{
                  width: 3, backgroundColor: cat.c, height: h,
                  borderRadius: 2, marginLeft: 12, marginRight: 12,
                  alignSelf: "center", flexShrink: 0,
                }} />
              );
            })()}
            <View style={{ flex: 1, paddingVertical: 12 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <Text style={{ fontFamily: FB, fontSize: 14, fontWeight: "500", color: ink.deep, lineHeight: 19, flex: 1 }}>{t.title}</Text>
                <View style={{ flexDirection: "row", gap: 5, alignItems: "center" }}>
                  {t.aiCheck && (
                    <View style={{ backgroundColor: earn.blueLo, borderRadius: 6, paddingVertical: 2, paddingHorizontal: 5 }}>
                      <Text style={{ fontFamily: FOM, fontSize: 7, color: earn.blue, letterSpacing: 1 }}>AI</Text>
                    </View>
                  )}
                  <View style={{ backgroundColor: `${cat.c}16`, borderRadius: 6, paddingVertical: 2, paddingHorizontal: 6 }}>
                    <Text style={{ fontSize: 14 }}>{cat.e}</Text>
                  </View>
                </View>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Text style={{ fontSize: 11, color: ink.mid }}>{t.minutes}m</Text>
                <View style={{ flexDirection: "row", gap: 3 }}>
                  {(() => {
                    const ratio = t.credits / Math.max(1, t.minutes);
                    const intensity = ratio >= 1.0 ? 3 : ratio >= 0.7 ? 2 : 1;
                    return [1, 2, 3].map(d => (
                      <View key={d} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: d <= intensity ? cat.c : ink.ghost }} />
                    ));
                  })()}
                </View>
                <View style={{ flex: 1, alignItems: "flex-end" }}>
                  <Text style={{ fontSize: 11, fontWeight: "600", color: earn.green }}>+{fmtMins(t.credits)}</Text>
                </View>
              </View>
            </View>
            <View style={{
              width: 28, height: 28, borderRadius: 14,
              borderWidth: 1.5, borderColor: t.aiCheck ? earn.blue : earn.green,
              alignItems: "center", justifyContent: "center",
              marginRight: 14, flexShrink: 0,
            }}>
              <Text style={{ color: t.aiCheck ? earn.blue : earn.green, fontSize: 12 }}>
                {t.aiCheck ? "✦" : "✓"}
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}

      {done.length > 0 && (
        <View style={{ marginTop: 10 }}>
          <Text style={{ fontFamily: FB, fontSize: 11, fontWeight: "600", color: ink.faint, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
            Done today
          </Text>
          {done.map(t => {
            const cat = CATS[t.cat] || CATS.life;
            return (
              <View key={t.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: ink.border, opacity: 0.55 }}>
                <Text style={{ fontSize: 18 }}>{cat.e}</Text>
                <Text style={{ flex: 1, fontFamily: FB, fontSize: 13, color: ink.mid, textDecorationLine: "line-through" }}>{t.title}</Text>
                <Text style={{ fontSize: 11, fontWeight: "600", color: earn.green }}>+{fmtMins(t.credits)}</Text>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
    </>
  );
}

// ── Progress View ────────────────────────────────────────────
function ProgressView({ tasks, totalXp, skips, dark }) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;
  const lv        = getLevel(totalXp);
  const prog      = xpProg(totalXp);
  const toNext    = xpToNext(totalXp);
  const done      = tasks.filter(t => t.done);
  const catCounts = done.reduce((a, t) => { a[t.cat] = (a[t.cat] || 0) + t.credits; return a; }, {});
  const maxCat    = Math.max(...Object.values(catCounts), 1);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 18, paddingBottom: 110 }}>
      {/* Level card */}
      <View style={{ backgroundColor: paper.card, borderRadius: 16, padding: 20, borderWidth: 0.5, borderColor: ink.border, marginBottom: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 14 }}>
          <Text style={{ fontSize: 36 }}>{lv.e}</Text>
          <View>
            <Text style={{ fontFamily: FK, fontSize: 20, color: earn.green }}>{lv.name}</Text>
            <Text style={{ fontFamily: FB, fontSize: 12, color: ink.mid }}>{totalXp.toLocaleString()} XP total</Text>
          </View>
        </View>
        {toNext > 0 && (
          <>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 5 }}>
              <Text style={{ fontFamily: FB, fontSize: 11, color: ink.faint }}>Progress to next level</Text>
              <Text style={{ fontFamily: FB, fontSize: 11, color: ink.faint }}>{toNext} XP to go</Text>
            </View>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: ink.ghost, overflow: "hidden" }}>
              <View style={{ height: "100%", width: `${prog * 100}%`, backgroundColor: earn.terra, borderRadius: 4 }} />
            </View>
          </>
        )}
      </View>

      {/* Stats */}
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}>
        {[["Earned", fmtMins(done.reduce((s, t) => s + t.credits, 0))], ["Done", `${done.length}`]].map(([l, v]) => (
          <View key={l} style={{ flex: 1, alignItems: "center", paddingVertical: 12, backgroundColor: paper.card, borderRadius: 16, padding: 20, borderWidth: 0.5, borderColor: ink.border }}>
            <Text style={{ fontFamily: FO, fontSize: 18, color: ink.deep, letterSpacing: 0.5 }}>{v}</Text>
            <Text style={{ fontFamily: FB, fontSize: 10, color: ink.mid, marginTop: 2 }}>{l}</Text>
          </View>
        ))}
      </View>

      {/* Category chart */}
      {Object.keys(catCounts).length > 0 && (
        <View style={{ backgroundColor: paper.card, borderRadius: 16, padding: 20, borderWidth: 0.5, borderColor: ink.border, marginBottom: 12 }}>
          <Text style={{ fontFamily: FK, fontSize: 16, color: ink.deep, marginBottom: 12 }}>Earned by type</Text>
          {Object.entries(catCounts).sort((a, b) => b[1] - a[1]).map(([cat, mins]) => {
            const meta = CATS[cat];
            return (
              <View key={cat} style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <Text style={{ fontSize: 18, width: 26, textAlign: "center" }}>{meta.e}</Text>
                <View style={{ flex: 1, height: 8, backgroundColor: ink.ghost, borderRadius: 4, overflow: "hidden" }}>
                  <View style={{ height: "100%", width: `${(mins / maxCat) * 100}%`, backgroundColor: meta.c, borderRadius: 4 }} />
                </View>
                <Text style={{ fontFamily: FB, fontSize: 11, color: ink.mid, width: 34, textAlign: "right" }}>{fmtMins(mins)}</Text>
              </View>
            );
          })}
        </View>
      )}

    </ScrollView>
  );
}

// ── Shared styles ────────────────────────────────────────────
const s = StyleSheet.create({
  card: {
    backgroundColor: paper.card,
    borderRadius: 16,
    padding: 20,
    borderWidth: 0.5,
    borderColor: ink.border,
  },
  label: {
    fontFamily: FB,
    fontSize: 11,
    fontWeight: "600",
    color: ink.faint,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
  },
});


// ── Bottom nav icons ─────────────────────────────────────────
function IconHome({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"
        stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M9 22V12h6v10" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
function IconBolt({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
        stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
function IconChart({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="12" width="4" height="9" rx="1" stroke={color} strokeWidth={2} />
      <Rect x="10" y="7" width="4" height="14" rx="1" stroke={color} strokeWidth={2} />
      <Rect x="17" y="3" width="4" height="18" rx="1" stroke={color} strokeWidth={2} />
    </Svg>
  );
}
function IconPeople({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <SvgCircle cx="9" cy="7" r="4" stroke={color} strokeWidth={2} />
      <Path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M16 3.13a4 4 0 010 7.75" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M21 21v-2a4 4 0 00-3-3.87" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

const TABS = [
  { id: "today",    label: "Today",    Icon: IconHome   },
  { id: "driftin",  label: "Drift In", Icon: IconBolt   },
  { id: "progress", label: "Stats",    Icon: IconChart  },
  { id: "friends",  label: "Friends",  Icon: IconPeople },
];

// ── Root App ─────────────────────────────────────────────────
export default function App() {
  const [fontsLoaded] = useFonts({
    Orbitron_400Regular,
    Orbitron_700Bold,
    Oswald_400Regular,
    Oswald_700Bold,
  });

  const [screen,      setScreen]      = useState("loading");
  const [tab,         setTab]         = useState("today");
  const [tasks,       setTasks]       = useState([]);
  const [credits,     setCredits]     = useState({ balance: 0, earned: 0, spent: 0 });
  const [totalXp,     setTotalXp]     = useState(0);
  const [overlay,     setOverlay]     = useState(null);
  const [popup,       setPopup]       = useState(null);
  const [secLeft,     setSecLeft]     = useState(0);

  const [userId,         setUserId]         = useState(null);
  const [isPremium,      setIsPremium]      = useState(false);
  const [trialDays,      setTrialDays]      = useState(7);
  const [showPaywall,    setShowPaywall]    = useState(false);
  const [onboarding,     setOnboarding]     = useState(false);
  const [signInOnly,     setSignInOnly]     = useState(false); // returning user (skip questionnaire)
  const [showAccount,        setShowAccount]        = useState(false);
  const [showBlockedApps,    setShowBlockedApps]    = useState(false);
  const [firstTimeBlockedApps, setFirstTimeBlockedApps] = useState(false);
  const [userEmail,          setUserEmail]          = useState("");

  // Subscription state (Stripe → Supabase) — server is source of truth
  const { active: subActive } = useSubscription(userId);
  const [driftInActive,  setDriftInActive]  = useState(false);
  const [darkMode,       setDarkMode]       = useState(false);

  const secRef          = useRef(0);
  const tickRef         = useRef(null);
  const tabRef          = useRef(tab);
  const driftInActRef   = useRef(driftInActive);
  useEffect(() => { tabRef.current = tab; }, [tab]);
  useEffect(() => { driftInActRef.current = driftInActive; }, [driftInActive]);

  const stopTick = () => { if (tickRef.current) clearInterval(tickRef.current); };

  // Swipe between tabs
  const tabSwipe = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) =>
        !driftInActRef.current &&
        Math.abs(gs.dx) > Math.abs(gs.dy) * 1.8 && Math.abs(gs.dx) > 18,
      onPanResponderRelease: (_, gs) => {
        if (driftInActRef.current) return;
        const idx = TABS.findIndex(t => t.id === tabRef.current);
        if (gs.dx > 60 && idx > 0)                 setTab(TABS[idx - 1].id);
        else if (gs.dx < -60 && idx < TABS.length - 1) setTab(TABS[idx + 1].id);
      },
    })
  ).current;

  // ── Screen time only drains when user could be on a blocked app ──
  //
  // Reality check: we cannot detect *which* other app the user is in from
  // React Native. So we approximate: time drains ONLY when Drift is NOT
  // in the foreground. When you're inside Drift itself you're not on a
  // blocked app, so nothing is "consumed."
  //
  // When a native blocker (iOS Family Controls / Android UsageStats) is
  // wired in, replace this with: only drain when blocker reports a
  // blocked app is foregrounded.

  const startTick = (initialSec) => {
    stopTick();
    secRef.current = initialSec;
    // (We don't run a setInterval here anymore — drain is computed from
    //  wall-clock delta when the app returns to the foreground.)
  };

  // Keep `secLeft` visually fresh when the app IS active (read-only — no drain)
  useEffect(() => {
    if (screen !== "app") return;
    const i = setInterval(() => setSecLeft(secRef.current), 1000);
    return () => clearInterval(i);
  }, [screen]);

  // Background → drain. Foreground → freeze.
  useEffect(() => {
    let bgTime = null;
    const sub = AppState.addEventListener("change", next => {
      if (next !== "active") {
        // Going to background — start "drain clock"
        bgTime = Date.now();
        stopTick();
      } else if (bgTime && screen === "app") {
        // Returning to Drift — subtract the elapsed background time
        const elapsedSec = Math.floor((Date.now() - bgTime) / 1000);
        const rem = Math.max(0, secRef.current - elapsedSec);
        secRef.current = rem;
        setSecLeft(rem);
        setCredits(c => {
          const nb = rem > 0 ? Math.ceil(rem / 60) : 0;
          const sp = c.spent + Math.min(elapsedSec, secRef.current + elapsedSec);
          return { ...c, balance: nb, spent: Math.min(c.earned, c.spent + Math.floor(elapsedSec / 60)) };
        });
        bgTime = null;
      }
    });
    return () => { sub.remove(); stopTick(); };
  }, [screen]);

  useEffect(() => {
    AsyncStorage.getItem("drift_dark_mode").then(v => { if (v === "1") setDarkMode(true); });
  }, []);

  const toggleDark = () => {
    setDarkMode(d => {
      const next = !d;
      AsyncStorage.setItem("drift_dark_mode", next ? "1" : "0");
      return next;
    });
  };

  useEffect(() => {
    (async () => {
      try {
        await initTrial();
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id ?? null;
        setUserId(uid);
        setUserEmail(session?.user?.email ?? "");
        if (!uid) {
          // Returning users who completed onboarding once just see sign-in
          const hasOnboarded = await AsyncStorage.getItem("drift_onboarded");
          setSignInOnly(hasOnboarded === "1");
          setOnboarding(true);
          return;
        }
        const { isPremium: prem, daysLeft } = await getTrialStatus(uid);
        setIsPremium(prem);
        setTrialDays(daysLeft);
        const d = await storage.get("drift_v4");
        if (d?.value) {
          const p = JSON.parse(d.value);
          if (p.date !== todayKey()) {
            setTotalXp(p.totalXp || 0);
          } else {
            const sc = p.credits || { balance: 0, earned: 0, spent: 0 };
            setTasks(p.tasks || []);
            setCredits(sc);
            setTotalXp(p.totalXp || 0);
            const initSec = (sc.balance || 0) * 60;
            secRef.current = initSec;
            setSecLeft(initSec);
          }
        }
        setScreen("app");
      } catch { setScreen("app"); }
    })();
  }, []);

  const persist = async upd => {
    try {
      await storage.set("drift_v4", JSON.stringify({
        tasks:   upd.tasks   ?? tasks,
        credits: upd.credits ?? credits,
        totalXp: upd.totalXp ?? totalXp,
        date:    todayKey(),
      }));
    } catch {}
  };

  const completeTask = id => {
    const task = tasks.find(t => t.id === id);
    if (!task || task.done) return;
    const nt  = tasks.map(t => t.id === id ? { ...t, done: true } : t);
    const nx  = totalXp + task.xp;
    const newSec = secRef.current + task.credits * 60;
    const nc  = { balance: Math.ceil(newSec / 60), earned: credits.earned + task.credits, spent: credits.spent };
    setTasks(nt); setCredits(nc); setTotalXp(nx);
    setPopup({ credits: task.credits, xp: task.xp });
    setTimeout(() => setPopup(null), 2000);
    startTick(newSec);
    persist({ tasks: nt, credits: nc, totalXp: nx });
  };

  const addTask  = t => { const nt = [...tasks, t]; setTasks(nt); persist({ tasks: nt }); };

  const simSpend = () => {
    const useSec = Math.min(10 * 60, secRef.current);
    const newSec = Math.max(0, secRef.current - useSec);
    const nc = { ...credits, balance: Math.ceil(newSec / 60), spent: credits.spent + Math.floor(useSec / 60) };
    startTick(newSec);
    setCredits(nc);
    persist({ credits: nc });
  };

  const handleDriftInStart  = async () => {
    setDriftInActive(true);
    try {
      const list = await (await import("./blockedApps")).getBlockedApps();
      if (list?.length) applyBlocking(list);
    } catch {}
  };
  const handleDriftInEnd    = () => { setDriftInActive(false); clearBlocking(); };

  const handleDriftInComplete = ({ credits: earned, xp }) => {
    setDriftInActive(false);
    const newSec = secRef.current + earned * 60;
    const nx  = totalXp + xp;
    const nc  = { balance: Math.ceil(newSec / 60), earned: credits.earned + earned, spent: credits.spent };
    setCredits(nc); setTotalXp(nx);
    setPopup({ credits: earned, xp });
    setTimeout(() => setPopup(null), 2500);
    startTick(newSec);
    persist({ credits: nc, totalXp: nx });
    setTimeout(() => setTab("today"), 400);
  };

  const signOut = async () => {
    setShowAccount(false);
    try { await supabase.auth.signOut(); } catch {}
    stopTick();
    setUserId(null);
    setUserEmail("");
    setTasks([]);
    setCredits({ balance: 0, earned: 0, spent: 0 });
    setTotalXp(0);
    secRef.current = 0;
    setSecLeft(0);
    // Drop them straight into the sign-in screen
    setSignInOnly(true);
    setOnboarding(true);
  };

  if (onboarding) return (
    <OnboardingScreen
      signInOnly={signInOnly}
      onComplete={async ({ user }) => {
        setUserId(user?.id ?? null);
        setUserEmail(user?.email ?? "");
        setOnboarding(false);
        const hadOnboarded = await AsyncStorage.getItem("drift_onboarded");
        await AsyncStorage.setItem("drift_onboarded", "1");
        await initTrial();
        const { isPremium: prem, daysLeft } = await getTrialStatus(user?.id);
        setIsPremium(prem);
        setTrialDays(daysLeft);
        setScreen("app");
        // Show blocked-apps picker the very first time only
        if (!hadOnboarded && !signInOnly) {
          setFirstTimeBlockedApps(true);
          setShowBlockedApps(true);
        }
      }}
    />
  );

  if (screen === "loading" || !fontsLoaded) return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: ink.void }}>
      <StatusBar barStyle="light-content" />
      <Text style={{ fontFamily: "Georgia", fontSize: 52, color: "#2FAB72" }}>D</Text>
      <Text style={{ fontFamily: "Georgia", fontSize: 12, color: "#4A8060", letterSpacing: 5, marginTop: 4 }}>DRIFT</Text>
    </View>
  );

  const activeTheme = getTheme(darkMode);
  const { ink: th_ink, paper: th_paper, earn: th_earn } = activeTheme;

  return (
    <ThemeContext.Provider value={{ dark: darkMode, theme: activeTheme }}>
    <SafeAreaView style={{ flex: 1, backgroundColor: driftInActive ? th_ink.void : th_paper.card }}>
      <StatusBar barStyle={driftInActive || darkMode ? "light-content" : "dark-content"} />

      {/* XP / credit popup */}
      {popup && (
        <View style={{
          position: "absolute", top: "18%", left: 0, right: 0,
          alignItems: "center", zIndex: 300,
          flexDirection: "row", justifyContent: "center", gap: 8,
          pointerEvents: "none",
        }}>
          <View style={{ backgroundColor: earn.green, borderRadius: 20, paddingVertical: 7, paddingHorizontal: 14 }}>
            <Text style={{ fontFamily: FO, fontSize: 11, color: "#fff", letterSpacing: 1 }}>+{fmtMins(popup.credits)}</Text>
          </View>
          <View style={{ backgroundColor: earn.blue, borderRadius: 20, paddingVertical: 7, paddingHorizontal: 14 }}>
            <Text style={{ fontFamily: FO, fontSize: 11, color: "#fff", letterSpacing: 1 }}>+{popup.xp} XP</Text>
          </View>
        </View>
      )}

      {/* Header — hidden during active Drift In session */}
      {!driftInActive && (
        <View style={{
          flexDirection: "row", alignItems: "center",
          paddingHorizontal: 18, height: 52,
          backgroundColor: th_paper.card,
          borderBottomWidth: 0.5, borderBottomColor: th_ink.border,
        }}>
          <Text style={{ fontFamily: FO, fontSize: 16, color: th_ink.deep, letterSpacing: 3, flex: 1 }}>DRIFT</Text>
          <View style={{
            backgroundColor: secLeft > 0 ? (secLeft < 120 ? "#FDECEA" : th_earn.greenLo) : th_paper.warm,
            borderRadius: 20, paddingVertical: 4, paddingHorizontal: 12, marginRight: 8,
          }}>
            <Text style={{
              fontFamily: FO, fontSize: 10, letterSpacing: 1,
              color: secLeft > 0 ? (secLeft < 120 ? "#C0392B" : th_earn.greenD) : th_ink.faint,
            }}>
              {secLeft > 0 ? fmtSecLeft(secLeft) : "no time"}
            </Text>
          </View>
          {/* Account button */}
          <TouchableOpacity onPress={() => setShowAccount(true)} style={{ marginRight: 10, padding: 4 }}>
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
              <SvgCircle cx="12" cy="8" r="4" stroke={th_earn.green} strokeWidth={2} />
              <Path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"
                stroke={th_earn.green} strokeWidth={2} strokeLinecap="round" />
            </Svg>
          </TouchableOpacity>
          {/* Dark/light toggle — green-toned SVG icons */}
          <TouchableOpacity onPress={toggleDark} style={{ marginRight: 10, padding: 4 }}>
            {darkMode ? (
              // Sun: switch to light
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                <SvgCircle cx="12" cy="12" r="5" stroke={th_earn.green} strokeWidth={2} />
                <Path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
                  stroke={th_earn.green} strokeWidth={2} strokeLinecap="round" />
              </Svg>
            ) : (
              // Moon: switch to dark
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                <Path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
                  stroke={th_earn.green} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Content — DriftIn always rendered so session persists across tab switches */}
      <View style={{ flex: 1, backgroundColor: th_paper.warm }} {...tabSwipe.panHandlers}>
        <View style={{ flex: 1, display: tab === "today" ? "flex" : "none" }}>
          <TodayView tasks={tasks} credits={credits} totalXp={totalXp} onComplete={completeTask} onAdd={() => setOverlay("add")} onSimSpend={simSpend} dark={darkMode} />
        </View>
        <View style={{ flex: 1, display: tab === "driftin" || driftInActive ? "flex" : "none", backgroundColor: driftInActive ? th_ink.void : th_paper.warm }}>
          <DriftInScreen
            onSessionComplete={handleDriftInComplete}
            onSessionStart={handleDriftInStart}
            onSessionEnd={handleDriftInEnd}
            totalXp={totalXp}
            dark={darkMode}
          />
        </View>
        <View style={{ flex: 1, display: tab === "progress" && !driftInActive ? "flex" : "none" }}>
          <ProgressView tasks={tasks} totalXp={totalXp} skips={0} dark={darkMode} />
        </View>
        <View style={{ flex: 1, display: tab === "friends" && !driftInActive ? "flex" : "none" }}>
          <SocialScreen userId={userId} isPremium={isPremium} onOpenPaywall={() => setShowPaywall(true)} dark={darkMode} />
        </View>
      </View>

      {/* ── Floating bubble island ── */}
      {!driftInActive && (
        <View style={{
          paddingHorizontal: 14,
          paddingBottom: Platform.OS === "ios" ? 16 : 8,
          paddingTop: 4,
          backgroundColor: "transparent",
          pointerEvents: "box-none",
        }}>
          <View style={{
            flexDirection: "row",
            backgroundColor: th_paper.card,
            borderRadius: 30,
            paddingVertical: 10,
            paddingHorizontal: 6,
            shadowColor: darkMode ? "#000" : th_ink.deep,
            shadowOffset: { width: 0, height: 6 },
            shadowOpacity: darkMode ? 0.4 : 0.10,
            shadowRadius: 16,
            elevation: 10,
          }}>
            {TABS.map(t => {
              const active    = tab === t.id;
              const isDriftIn = t.id === "driftin";

              if (isDriftIn) return (
                <TouchableOpacity key={t.id} onPress={() => setTab(t.id)}
                  style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                  <View style={{
                    width: 52, height: 34, borderRadius: 17,
                    backgroundColor: active ? th_earn.green : "transparent",
                    alignItems: "center", justifyContent: "center",
                  }}>
                    <t.Icon color={active ? "#fff" : th_ink.mid} size={20} />
                  </View>
                  <Text style={{ fontFamily: FO, fontSize: 7, letterSpacing: 0.8, marginTop: 3,
                    color: active ? th_earn.green : th_ink.mid }}>
                    {t.label.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              );

              return (
                <TouchableOpacity key={t.id} onPress={() => setTab(t.id)}
                  style={{ flex: 1, alignItems: "center", paddingVertical: 2 }}>
                  <View style={{
                    width: 40, height: 34, borderRadius: 14,
                    backgroundColor: active ? th_earn.greenLo : "transparent",
                    alignItems: "center", justifyContent: "center",
                  }}>
                    <t.Icon color={active ? th_earn.green : th_ink.mid} size={20} />
                  </View>
                  <Text style={{ fontFamily: FO, fontSize: 7, letterSpacing: 0.8, marginTop: 3,
                    color: active ? th_earn.green : th_ink.mid }}>
                    {t.label.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {/* Add task overlay */}
      {overlay && (
        <View style={[StyleSheet.absoluteFill, { zIndex: 200 }]}>
          {overlay === "add" && (
            <AddTaskOverlay
              onSave={addTask}
              onClose={() => setOverlay(null)}
              userId={userId}
              isSubActive={subActive}
              onOpenPaywall={() => { setOverlay(null); setShowPaywall(true); }}
            />
          )}
        </View>
      )}

      {/* Paywall modal */}
      {showPaywall && (
        <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPaywall(false)}>
          <PaywallScreen
            userId={userId}
            daysLeft={trialDays}
            onSubscribe={async () => {
              try {
                const url = await createCheckoutSession();
                if (!url) throw new Error("No checkout URL");
                setShowPaywall(false);
                await Linking.openURL(url);
              } catch (e) {
                const raw = (e?.message || "").toLowerCase();
                const friendly = raw.includes("edge function") || raw.includes("send a request")
                  ? "Payments aren't set up yet. Please try again later."
                  : (e?.message || "Try again.");
                Alert.alert("Checkout unavailable", friendly);
              }
            }}
            onClose={() => setShowPaywall(false)}
          />
        </Modal>
      )}

      {/* Account sheet */}
      <Modal visible={showAccount} transparent animationType="fade" onRequestClose={() => setShowAccount(false)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setShowAccount(false)}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{
            backgroundColor: th_paper.card,
            borderTopLeftRadius: 24, borderTopRightRadius: 24,
            padding: 24, paddingBottom: Platform.OS === "ios" ? 40 : 24,
          }}>
            {/* Handle */}
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: th_ink.ghost, alignSelf: "center", marginBottom: 18 }} />

            <Text style={{ fontFamily: FOM, fontSize: 9, color: th_ink.faint, letterSpacing: 2, marginBottom: 6 }}>ACCOUNT</Text>

            {userEmail ? (
              <>
                <Text style={{ fontFamily: FK, fontSize: 18, color: th_ink.deep, marginBottom: 2 }}>{userEmail}</Text>
                <Text style={{ fontFamily: FB, fontSize: 12, color: th_ink.mid, marginBottom: 24 }}>
                  {subActive ? "Pro · active" : "Free"}
                </Text>

                {/* Manage blocked apps */}
                <TouchableOpacity
                  onPress={() => { setShowAccount(false); setFirstTimeBlockedApps(false); setShowBlockedApps(true); }}
                  style={{
                    flexDirection: "row", alignItems: "center", gap: 10,
                    paddingVertical: 13, paddingHorizontal: 14, borderRadius: 12, marginBottom: 10,
                    borderWidth: 1, borderColor: th_ink.border, backgroundColor: th_paper.warm,
                  }}
                >
                  <Text style={{ fontSize: 18 }}>🔐</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: FK, fontSize: 14, color: th_ink.deep }}>Blocked apps</Text>
                    <Text style={{ fontFamily: FB, fontSize: 11, color: th_ink.mid }}>Apps to block during focus sessions</Text>
                  </View>
                  <Text style={{ color: th_ink.faint, fontSize: 18 }}>›</Text>
                </TouchableOpacity>

                {/* Manage subscription */}
                {!subActive && (
                  <TouchableOpacity
                    onPress={async () => {
                      setShowAccount(false);
                      try {
                        const url = await createCheckoutSession();
                        if (url) await Linking.openURL(url);
                      } catch (e) {
                        const raw = (e?.message || "").toLowerCase();
                        const friendly = raw.includes("edge function") || raw.includes("send a request")
                          ? "Payments aren't set up yet. Please try again later."
                          : (e?.message || "Try again.");
                        Alert.alert("Checkout unavailable", friendly);
                      }
                    }}
                    style={{
                      flexDirection: "row", alignItems: "center", gap: 10,
                      paddingVertical: 13, paddingHorizontal: 14, borderRadius: 12, marginBottom: 10,
                      borderWidth: 1, borderColor: th_earn.terra, backgroundColor: th_earn.terraLo,
                    }}
                  >
                    <Text style={{ fontSize: 18 }}>✦</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: FK, fontSize: 14, color: th_earn.terra }}>Upgrade to Pro</Text>
                      <Text style={{ fontFamily: FB, fontSize: 11, color: th_ink.mid }}>AI evaluation + AI Check</Text>
                    </View>
                    <Text style={{ fontFamily: FO, fontSize: 9, color: th_earn.terra, letterSpacing: 1 }}>UPGRADE</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  onPress={() => {
                    Alert.alert("Sign out?", "You'll need to sign back in to access your data.", [
                      { text: "Cancel", style: "cancel" },
                      { text: "Sign out", style: "destructive", onPress: signOut },
                    ]);
                  }}
                  style={{
                    paddingVertical: 14, borderRadius: 12,
                    backgroundColor: "rgba(224,80,80,0.1)",
                    borderWidth: 1, borderColor: "rgba(224,80,80,0.2)",
                    alignItems: "center",
                  }}
                >
                  <Text style={{ fontFamily: FK, fontSize: 14, color: "#A32D2D" }}>Sign out</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={{ fontFamily: FK, fontSize: 16, color: th_ink.deep, marginBottom: 4 }}>Not signed in</Text>
                <Text style={{ fontFamily: FB, fontSize: 12, color: th_ink.mid, marginBottom: 24 }}>
                  Sign in to sync progress and add friends.
                </Text>

                <TouchableOpacity
                  onPress={() => {
                    setShowAccount(false);
                    setSignInOnly(true);
                    setOnboarding(true);
                  }}
                  style={{
                    paddingVertical: 14, borderRadius: 12,
                    backgroundColor: th_earn.green, alignItems: "center",
                  }}
                >
                  <Text style={{ fontFamily: FO, fontSize: 12, color: "#fff", letterSpacing: 2 }}>SIGN IN</Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity onPress={() => setShowAccount(false)} style={{ paddingVertical: 14, alignItems: "center", marginTop: 6 }}>
              <Text style={{ fontFamily: FB, fontSize: 13, color: th_ink.mid }}>Close</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Blocked apps modal (onboarding + ongoing management) */}
      <BlockedAppsModal
        visible={showBlockedApps}
        firstTime={firstTimeBlockedApps}
        dark={darkMode}
        onClose={() => { setShowBlockedApps(false); setFirstTimeBlockedApps(false); }}
      />
    </SafeAreaView>
    </ThemeContext.Provider>
  );
}
