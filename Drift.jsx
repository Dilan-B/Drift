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
import { useSubscription, createCheckoutSession, confirmCheckoutSession } from "./useSubscription";
import BlockedAppsModal from "./BlockedAppsModal";
import UsernameSetupModal from "./UsernameSetupModal";
import Swipeable from "./Swipeable";
import {
  fetchTasks, insertTask, completeTaskRow, softDeleteTask,
  appendLedgerEntry, syncProfileStats, fetchProfileStats,
  cache,
} from "./sync";
import { applyBlocking, clearBlocking } from "./blockedApps";
import { Spinner } from "./Skeleton";
import Slider from "@react-native-community/slider";
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
import {
  CategoryIcon, LevelIcon, LockIcon, UnlockIcon, SparkleIcon, CheckIcon,
  ShieldKeyIcon, ClipboardIcon, ChartIcon, PhoneIcon,
} from "./Icons";
import {
  requestScreenTimeAuth, getScreenTimeAuthStatus,
} from "./blockedApps";
import { startBalanceMonitoring, stopBalanceMonitoring, consumeDepletedFlag } from "./screenTime";
import { supabase, syncScreenTime, safeGetSession } from "./supabase";
import SocialScreen from "./SocialScreen";
import PaywallScreen, { initTrial, getTrialStatus } from "./PaywallScreen";
import OnboardingScreen from "./OnboardingScreen";
import DriftInScreen from "./DriftInScreen";
import ProfileScreen from "./ProfileScreen";
import StripeCheckoutModal from "./StripeCheckoutModal";
import { cached, rateLimited } from "./apiGuards";
import { useBetaMode } from "./useBetaMode";

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
  work:     { c: "#3A7AB8", l: "Work" },
  physical: { c: "#2FAB72", l: "Physical" },
  outdoor:  { c: "#3DA870", l: "Outdoor" },
  learning: { c: "#7B6EC8", l: "Learning" },
  life:     { c: "#5AB4D4", l: "Life" },
  social:   { c: "#3A9BB5", l: "Social" },
};

const EFFORT = [
  { id: 1, label: "Light",    mult: 0.5,  desc: "Quick task, easy admin, low exertion" },
  { id: 2, label: "Moderate", mult: 0.75, desc: "Focused work, gym, cooking, studying" },
  { id: 3, label: "Intense",  mult: 1.25, desc: "Hard workout, deep sprint, long outdoor" },
];


const LEVELS = [
  { name: "Seedling",   min: 0    },
  { name: "Sprout",     min: 150  },
  { name: "Sapling",    min: 400  },
  { name: "Grove",      min: 900  },
  { name: "Canopy",     min: 2000 },
  { name: "Forest",     min: 4000 },
  { name: "Old Growth", min: 8000 },
];

// ── Helpers ──────────────────────────────────────────────────
const calcCredits = (mins, effort) => Math.round(mins * (EFFORT.find(e => e.id === effort)?.mult || 1));
const calcXp      = (mins, effort) => Math.round(mins * (EFFORT.find(e => e.id === effort)?.mult || 1) * 0.45 + 8);
const fmtMins = m => m <= 0 ? "0m" : m < 60 ? `${m}m` : m % 60 > 0 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}h`;
const fmtSecs = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const getLevel  = xp => [...LEVELS].reverse().find(l => xp >= l.min) || LEVELS[0];
const getLevelIdx = xp => { const i = LEVELS.findIndex(l => l.name === getLevel(xp).name); return i < 0 ? 0 : i; };
const xpProg    = xp => { const lv = getLevel(xp); const ni = LEVELS.findIndex(l => l.min > xp); if (ni === -1) return 1; return (xp - lv.min) / (LEVELS[ni].min - lv.min); };
const xpToNext  = xp => { const ni = LEVELS.findIndex(l => l.min > xp); return ni === -1 ? 0 : LEVELS[ni].min - xp; };
const todayKey    = () => new Date().toISOString().slice(0, 10);
const clockStr    = () => new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
const pad2         = n => String(n).padStart(2, "0");
const timeToMins   = t => {
  const m = String(t || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
};
const minsToTime   = mins => `${pad2(Math.floor((((mins % 1440) + 1440) % 1440) / 60))}:${pad2((((mins % 1440) + 1440) % 1440) % 60)}`;
const prettyTime   = t => {
  const mins = timeToMins(t);
  if (mins == null) return t || "";
  const h = Math.floor(mins / 60), m = mins % 60;
  const hr = h % 12 || 12;
  return `${hr}:${pad2(m)} ${h >= 12 ? "PM" : "AM"}`;
};
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const recurrenceDaysFor = frequency => {
  if (frequency === "weekdays") return [1, 2, 3, 4, 5];
  if (frequency === "weekends") return [0, 6];
  return null;
};
const recurrenceLabel = item => {
  const frequency = item?.frequency || "daily";
  if (frequency === "daily") return "Daily";
  if (frequency === "weekdays") return "Weekdays";
  if (frequency === "weekends") return "Weekends";
  if (frequency === "custom") {
    const days = (item.days || []).map(d => WEEKDAY_NAMES[d]).filter(Boolean);
    return days.length ? days.join(", ") : "Custom";
  }
  return "Repeats";
};
const recurrenceMatchesDate = (item, date = new Date()) => {
  const frequency = item?.frequency || "daily";
  if (frequency === "daily") return true;
  const day = date.getDay();
  const preset = recurrenceDaysFor(frequency);
  if (preset) return preset.includes(day);
  if (frequency === "custom") return (item.days || []).includes(day);
  return false;
};
const isBlockedHourNow = (rules) => {
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  return (rules || []).some(r => {
    if (!r?.enabled) return false;
    const start = timeToMins(r.start);
    const end = timeToMins(r.end);
    if (start == null || end == null || start === end) return false;
    return start < end ? cur >= start && cur < end : cur >= start || cur < end;
  });
};
const fmtSecLeft  = s => {
  if (s < 0)    return `-${fmtSecLeft(Math.abs(s))}`;
  if (s === 0)  return "locked";
  if (s < 60)   return `0:${String(s).padStart(2, "0")}`;
  if (s < 3600) return `${Math.floor(s/60)}:${String(s%60).padStart(2, "0")}`;
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
};
const mergeCompletedTasks = (...groups) => {
  const seen = new Set();
  return groups
    .flat()
    .filter(t => t?.done)
    .filter(t => {
      const key = String(t.id || `${t.title}-${t.completedAt || ""}`);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

// ── Storage (in-memory) ──────────────────────────────────────
const storage = {
  get: async (key) => ({ value: await AsyncStorage.getItem(key) }),
  set: async (key, value) => { await AsyncStorage.setItem(key, value); },
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

// Free-tier credit formula.
//
// Free users don't get AI access, so we don't grade the task at all — credits
// are a flat multiplier of the chosen duration. This is deliberate:
//   - It's predictable: the user can see exactly what they'll earn before saving.
//   - It avoids any title/category "review" that would feel like a lighter AI.
//   - Upgrading to Pro unlocks the AI valuation, which is the actual value-add.
//
// FREE_TIER_MULTIPLIER tunes how generous the floor is — 0.6 matches the
// existing default and keeps balance with paid users (whose AI typically lands
// in the 0.5-1.0 range depending on task quality).
const FREE_TIER_MULTIPLIER = 0.6;

function freeTierCredits(mins) {
  const credits = Math.max(1, Math.round(mins * FREE_TIER_MULTIPLIER));
  const xp      = Math.max(5, Math.round(credits * 0.6 + 8));
  return {
    credits,
    xp,
    reasoning: "Credits based on duration. Upgrade for AI-valued rewards.",
  };
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
  const [recur,    setRecur]    = useState("none");
  const [recurDays, setRecurDays] = useState([new Date().getDay()]);
  const [recurTime, setRecurTime] = useState(() => {
    const d = new Date();
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  });

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
    const recurrence = recur !== "none" && isSubActive
      ? { frequency: recur, time: recurTime, days: recur === "custom" ? recurDays : recurrenceDaysFor(recur) }
      : null;

    // Free user → flat duration-based credits, no AI eval call.
    // (Free tier doesn't get any AI grading — credits are purely mins × multiplier.)
    if (!isSubActive) {
      const { credits, xp, reasoning } = freeTierCredits(mins);
      onSave(buildTask({ credits, xp, reasoning, aiValued: false }), recurrence);
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
      onSave(buildTask({ credits, xp, reasoning, aiValued: true }), recurrence);
      onClose();
    } catch (e) {
      if (e?.code === "subscription_required") {
        // Server told us their sub lapsed mid-session — fall back to the
        // free-tier duration formula (same path a free user would take).
        const { credits, xp, reasoning } = freeTierCredits(mins);
        onSave(buildTask({ credits, xp, reasoning, aiValued: false }), recurrence);
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
            {isSubActive
              ? <SparkleIcon size={12} color={earn.blue} />
              : <Text style={{ fontSize: 11, color: ink.mid }}>·</Text>}
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
              <SparkleIcon size={22} color={earn.blue} />
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
              <LockIcon size={22} color={ink.mid} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: FK, fontSize: 13, color: ink.deep, marginBottom: 2 }}>Unlock AI evaluation</Text>
                <Text style={{ fontFamily: FB, fontSize: 11, color: ink.mid, lineHeight: 16 }}>
                  Tap to upgrade — credits are based on duration until then.
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

          {/* Category — clean horizontal text-only row */}
          <View style={{ marginBottom: 14 }}>
            <Text style={[s.label, { color: ink.faint }]}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 18, paddingVertical: 4 }}>
              {Object.entries(CATS).map(([k, v]) => (
                <TouchableOpacity key={k} onPress={() => setCat(k)} style={{ paddingVertical: 4 }}>
                  <Text style={{
                    fontFamily: FK, fontSize: 14,
                    color: cat === k ? v.c : ink.mid,
                    letterSpacing: 0.3,
                  }}>
                    {v.l}
                  </Text>
                  {cat === k && (
                    <View style={{
                      height: 2, backgroundColor: v.c, borderRadius: 1,
                      marginTop: 4,
                    }} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Duration — slider 15m to 5h, 15m steps */}
          <View style={{ marginBottom: 14 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <Text style={[s.label, { color: ink.faint, marginBottom: 0 }]}>Duration</Text>
              <Text style={{ fontFamily: FO, fontSize: 14, color: earn.terra, letterSpacing: 0.5 }}>
                {mins >= 60 ? `${Math.floor(mins/60)}h ${mins%60 ? `${mins%60}m` : ""}`.trim() : `${mins}m`}
              </Text>
            </View>
            <Slider
              minimumValue={15}
              maximumValue={300}
              step={15}
              value={mins}
              onValueChange={setMins}
              minimumTrackTintColor={earn.terra}
              maximumTrackTintColor={ink.ghost}
              thumbTintColor={earn.terra}
              style={{ width: "100%", height: 36 }}
            />
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: -4 }}>
              <Text style={{ fontFamily: FB, fontSize: 10, color: ink.faint }}>15m</Text>
              <Text style={{ fontFamily: FB, fontSize: 10, color: ink.faint }}>5h</Text>
            </View>
          </View>

          {/* ── AI Check toggle ── */}
          <View style={{ marginBottom: 14 }}>
            <Text style={[s.label, { color: ink.faint }]}>Repeat</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: recur !== "none" && isSubActive ? 10 : 0 }}>
              {[
                ["none", "Once"],
                ["daily", "Daily"],
                ["weekdays", "Weekdays"],
                ["weekends", "Weekends"],
                ["custom", "Custom"],
              ].map(([value, label]) => {
                const active = recur === value;
                return (
                  <TouchableOpacity
                    key={value}
                    onPress={() => {
                      if (value !== "none" && !isSubActive) {
                        onOpenPaywall?.();
                        return;
                      }
                      setRecur(value);
                    }}
                    style={{
                      minWidth: value === "none" ? 82 : 96,
                      flexGrow: 1,
                      paddingVertical: 11,
                      paddingHorizontal: 10,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: active ? earn.terra : ink.border,
                      backgroundColor: active ? earn.terraLo : paper.card,
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ fontFamily: FK, fontSize: 13, color: active ? earn.greenD : ink.mid }}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {!isSubActive && (
              <TouchableOpacity
                onPress={onOpenPaywall}
                style={{
                  marginTop: 10,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  padding: 12,
                  borderRadius: 12,
                  backgroundColor: ink.ghost,
                  borderWidth: 1,
                  borderColor: ink.border,
                }}
              >
                <LockIcon size={16} color={ink.mid} />
                <Text style={{ flex: 1, fontFamily: FB, fontSize: 12, color: ink.mid }}>
                  Recurring task schedules are a Pro feature.
                </Text>
                <Text style={{ fontFamily: FOM, fontSize: 9, color: earn.terra, letterSpacing: 1 }}>UPGRADE</Text>
              </TouchableOpacity>
            )}
            {recur !== "none" && isSubActive && (
              <View style={{
                gap: 10,
                padding: 12,
                borderRadius: 12,
                backgroundColor: paper.card,
                borderWidth: 1,
                borderColor: ink.border,
              }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Text style={{ fontFamily: FB, fontSize: 12, color: ink.mid, flex: 1 }}>
                    Create this task at
                  </Text>
                  <TextInput
                    value={recurTime}
                    onChangeText={(t) => setRecurTime(t.replace(/[^\d:]/g, "").slice(0, 5))}
                    onBlur={() => {
                      const mins = timeToMins(recurTime);
                      setRecurTime(mins == null ? "09:00" : minsToTime(mins));
                    }}
                    keyboardType="numbers-and-punctuation"
                    placeholder="09:00"
                    placeholderTextColor={ink.faint}
                    style={{
                      width: 78,
                      paddingVertical: 8,
                      paddingHorizontal: 10,
                      borderRadius: 10,
                      backgroundColor: paper.warm,
                      borderWidth: 1,
                      borderColor: ink.border,
                      color: ink.deep,
                      fontFamily: FO,
                      fontSize: 12,
                      textAlign: "center",
                    }}
                  />
                </View>
                {recur === "custom" && (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
                    {WEEKDAY_NAMES.map((name, idx) => {
                      const active = recurDays.includes(idx);
                      return (
                        <TouchableOpacity
                          key={name}
                          onPress={() => setRecurDays(days => {
                            if (active && days.length <= 1) return days;
                            return active ? days.filter(d => d !== idx) : [...days, idx].sort((a, b) => a - b);
                          })}
                          style={{
                            minWidth: 40,
                            paddingVertical: 8,
                            paddingHorizontal: 9,
                            borderRadius: 10,
                            borderWidth: 1,
                            borderColor: active ? earn.terra : ink.border,
                            backgroundColor: active ? earn.terraLo : paper.warm,
                            alignItems: "center",
                          }}
                        >
                          <Text style={{ fontFamily: FK, fontSize: 11, color: active ? earn.greenD : ink.mid }}>
                            {name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            )}
          </View>

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
            {isSubActive
              ? <SparkleIcon size={20} color={aiCheck ? earn.blue : ink.mid} />
              : <LockIcon size={20} color={ink.mid} />}
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
            {evaluating && <Spinner size={20} color="#fff" />}
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
      Icon: ({ size, color }) => (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <SvgCircle cx="12" cy="13" r="8" stroke={color} strokeWidth={2} />
          <Path d="M12 9v4l3 2 M9 3h6" stroke={color} strokeWidth={2} strokeLinecap="round" />
        </Svg>
      ),
    },
    {
      q: "Was it focused, quality time?",
      sub: "Not half-distracted, not just started and stopped.",
      Icon: ({ size, color }) => (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <SvgCircle cx="12" cy="12" r="9" stroke={color} strokeWidth={2} />
          <SvgCircle cx="12" cy="12" r="5" stroke={color} strokeWidth={2} />
          <SvgCircle cx="12" cy="12" r="1.5" fill={color} />
        </Svg>
      ),
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

          <View style={{ alignItems: "center", marginBottom: 16 }}>
            <q.Icon size={40} color={earn.green} />
          </View>
          <Text style={{ fontFamily: FK, fontSize: 20, color: ink.deep, textAlign: "center", marginBottom: 8 }}>{q.q}</Text>
          <Text style={{ fontFamily: FB, fontSize: 13, color: ink.mid, textAlign: "center", lineHeight: 20, marginBottom: 28 }}>{q.sub}</Text>

          <TouchableOpacity onPress={confirm} style={{
            paddingVertical: 15, borderRadius: 14, backgroundColor: earn.green, alignItems: "center", marginBottom: 10,
          }}>
            <Text style={{ fontFamily: FK, fontSize: 16, color: "#fff" }}>
              {step < QUESTIONS.length - 1 ? "Yes, next" : "Yes — claim credits"}
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
function ReduceScreenTimeModal({ visible, balanceSec, dark, onClose, onReduce }) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;
  const maxMins = Math.floor(Math.max(0, balanceSec || 0) / 60);
  const options = [5, 10, 15, 30, 60].filter(m => m <= maxMins);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (visible) setSelected(options[0] || null);
  }, [visible, maxMins]);

  if (!visible) return null;

  const confirm = () => {
    if (!selected || selected > maxMins) return;
    onReduce?.(selected);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s2.backdrop}>
        <View style={[s2.panel, { backgroundColor: paper.card, borderColor: ink.border }]}>
          <Text style={[s2.kicker, { color: earn.green }]}>SCREEN TIME</Text>
          <Text style={[s2.panelTitle, { color: ink.deep }]}>Reduce your balance</Text>
          <Text style={[s2.panelText, { color: ink.mid }]}>
            Choose how much time to give back. This can only subtract from what you already have.
          </Text>
          {maxMins < 1 ? (
            <Text style={[s2.emptyText, { color: ink.faint }]}>You do not have any screen time to reduce.</Text>
          ) : (
            <View style={s2.amountGrid}>
              {options.map(m => (
                <TouchableOpacity
                  key={m}
                  onPress={() => setSelected(m)}
                  style={[
                    s2.amountPill,
                    { borderColor: ink.border, backgroundColor: paper.warm },
                    selected === m && { borderColor: earn.green, backgroundColor: earn.greenLo },
                  ]}
                >
                  <Text style={[s2.amountText, { color: selected === m ? earn.greenD : ink.deep }]}>{m}m</Text>
                </TouchableOpacity>
              ))}
              {maxMins > 0 && !options.includes(maxMins) && (
                <TouchableOpacity
                  onPress={() => setSelected(maxMins)}
                  style={[
                    s2.amountPill,
                    { borderColor: ink.border, backgroundColor: paper.warm },
                    selected === maxMins && { borderColor: earn.green, backgroundColor: earn.greenLo },
                  ]}
                >
                  <Text style={[s2.amountText, { color: selected === maxMins ? earn.greenD : ink.deep }]}>All</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          <View style={s2.actions}>
            <TouchableOpacity onPress={onClose} style={[s2.ghostBtn, { borderColor: ink.border }]}>
              <Text style={[s2.ghostText, { color: ink.mid }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={confirm} disabled={!selected} style={[s2.solidBtn, { backgroundColor: selected ? earn.green : ink.faint }]}>
              <Text style={s2.solidText}>Reduce</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const QUICK_SLIDES = [
  {
    title: "Pause for a second.",
    body: "This button is meant for real resets, not autopilot. A task will feel better if you can do one.",
  },
  {
    title: "This is unearned time.",
    body: "You can take it, but it will not give XP or progress. It is only a shortcut to more screen time.",
  },
  {
    title: "Your future self still pays for it.",
    body: "Fifteen minutes can disappear fast. Make sure this is worth giving away your attention.",
  },
  {
    title: "You only get three today.",
    body: "Using one now means having fewer emergency resets later when you may actually need it.",
  },
  {
    title: "Try the smallest useful task first.",
    body: "Two minutes of cleanup, stretching, water, or planning might unlock time without using a reset.",
  },
  {
    title: "Check the urge.",
    body: "Are you opening an app because you chose to, or because the app pulled you back in?",
  },
  {
    title: "This will not solve avoidance.",
    body: "If there is one thing you are dodging, name it before you continue.",
  },
  {
    title: "Screen time is easier to spend than earn.",
    body: "If you take this, spend it on purpose. Do not let it become background scrolling.",
  },
  {
    title: "You can still back out.",
    body: "Canceling now is a win if you were about to click through without thinking.",
  },
  {
    title: "Final check.",
    body: "Only continue if you intentionally want these 15 minutes more than you want to earn them.",
  },
];

function QuickGrantModal({ visible, usedToday, dark, onClose, onGrant }) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;
  const [step, setStep] = useState(0);
  const [breathing, setBreathing] = useState(false);
  const [seconds, setSeconds] = useState(15);
  const scale = useRef(new Animated.Value(0.96)).current;
  const breath = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    setStep(0);
    setBreathing(false);
    setSeconds(15);
    scale.setValue(0.96);
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 80, friction: 10 }).start();
  }, [visible, scale]);

  useEffect(() => {
    if (!breathing) return;
    breath.setValue(0);
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(breath, { toValue: 1, duration: 3200, useNativeDriver: true }),
      Animated.timing(breath, { toValue: 0, duration: 3200, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [breathing, breath]);

  useEffect(() => {
    if (!breathing || seconds <= 0) return;
    const id = setTimeout(() => setSeconds(s => s - 1), 1000);
    return () => clearTimeout(id);
  }, [breathing, seconds]);

  if (!visible) return null;

  const next = () => {
    if (step < QUICK_SLIDES.length - 1) {
      Animated.sequence([
        Animated.timing(scale, { toValue: 0.985, duration: 120, useNativeDriver: true }),
      ]).start();
      setTimeout(() => {
        setStep(s => s + 1);
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 90, friction: 9 }).start();
      }, 130);
      return;
    }
    setBreathing(true);
  };

  const finish = () => {
    if (seconds > 0) return;
    onGrant?.();
  };

  const breathScale = breath.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1.1] });
  const breathOpacity = breath.interpolate({ inputRange: [0, 1], outputRange: [0.28, 0.68] });
  const progress = breathing ? 1 : (step + 1) / QUICK_SLIDES.length;
  const primaryText = dark ? "#F4FFF8" : ink.deep;
  const secondaryText = dark ? "#B8D8C5" : ink.mid;
  const disabledBtn = dark ? "#31483F" : "#A8BFB5";
  const disabledBtnText = dark ? "#DDEFE5" : "#FFFFFF";
  const slide = QUICK_SLIDES[step] || QUICK_SLIDES[0];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s2.backdrop}>
        <Animated.View style={[s2.panel, { backgroundColor: paper.card, borderColor: ink.border, transform: [{ scale }] }]}>
          <Text style={[s2.kicker, { color: earn.green }]}>RESET MINUTES</Text>
          <View style={[s2.progressTrack, { backgroundColor: ink.ghost }]}>
            <Animated.View style={[s2.progressFill, { width: `${progress * 100}%`, backgroundColor: earn.green }]} />
          </View>
          {!breathing ? (
            <View>
              <Text style={[s2.panelTitle, { color: primaryText }]}>{slide.title}</Text>
              <Text style={[s2.panelText, { color: secondaryText }]}>
                {slide.body}
              </Text>
              <Text style={[s2.footerHint, { color: secondaryText, textAlign: "left", marginTop: -6, marginBottom: 12 }]}>
                Step {step + 1} of {QUICK_SLIDES.length}
              </Text>
            </View>
          ) : (
            <View style={{ alignItems: "center", paddingVertical: 8 }}>
              <Animated.View style={[s2.breathOrb, { backgroundColor: earn.green, opacity: breathOpacity, transform: [{ scale: breathScale }] }]} />
              <Text style={[s2.panelTitle, { color: primaryText, textAlign: "center" }]}>Take deep breaths</Text>
              <Text style={[s2.panelText, { color: secondaryText, textAlign: "center" }]}>
                In through the nose. Out slowly. You can continue in {seconds}s.
              </Text>
            </View>
          )}
          <View style={s2.actions}>
            <TouchableOpacity onPress={onClose} style={[s2.ghostBtn, { borderColor: ink.border }]}>
              <Text style={[s2.ghostText, { color: ink.mid }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={breathing ? finish : next} disabled={breathing && seconds > 0} style={[s2.solidBtn, { backgroundColor: breathing && seconds > 0 ? disabledBtn : earn.green }]}>
              <Text style={[s2.solidText, { color: breathing && seconds > 0 ? disabledBtnText : "#FFFFFF" }]}>{breathing ? "Claim 15m" : "Continue"}</Text>
            </TouchableOpacity>
          </View>
          <Text style={[s2.footerHint, { color: ink.faint }]}>{Math.max(0, 3 - usedToday)} left today</Text>
        </Animated.View>
      </View>
    </Modal>
  );
}

function FloatingFeedback({ popup }) {
  const scale = useRef(new Animated.Value(0.88)).current;
  const y = useRef(new Animated.Value(18)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!popup) return;
    scale.setValue(0.88);
    y.setValue(18);
    opacity.setValue(0);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 120, friction: 8 }),
      Animated.spring(y, { toValue: 0, useNativeDriver: true, tension: 110, friction: 9 }),
      Animated.timing(opacity, { toValue: 1, duration: 140, useNativeDriver: true }),
    ]).start();
  }, [popup, scale, y, opacity]);

  if (!popup) return null;
  return (
    <Animated.View style={{
      position: "absolute", top: "18%", left: 0, right: 0,
      alignItems: "center", zIndex: 300,
      flexDirection: "row", justifyContent: "center", gap: 8,
      pointerEvents: "none",
      opacity,
      transform: [{ translateY: y }, { scale }],
    }}>
      {popup.credits > 0 && (
        <View style={{ backgroundColor: earn.green, borderRadius: 20, paddingVertical: 7, paddingHorizontal: 14 }}>
          <Text style={{ fontFamily: FO, fontSize: 11, color: "#fff", letterSpacing: 1 }}>+{fmtMins(popup.credits)}</Text>
        </View>
      )}
      {popup.loss > 0 && (
        <View style={{ backgroundColor: "#C0392B", borderRadius: 20, paddingVertical: 7, paddingHorizontal: 14 }}>
          <Text style={{ fontFamily: FO, fontSize: 11, color: "#fff", letterSpacing: 1 }}>-{fmtMins(popup.loss)}</Text>
        </View>
      )}
      {popup.xp > 0 && (
        <View style={{ backgroundColor: earn.blue, borderRadius: 20, paddingVertical: 7, paddingHorizontal: 14 }}>
          <Text style={{ fontFamily: FO, fontSize: 11, color: "#fff", letterSpacing: 1 }}>+{popup.xp} XP</Text>
        </View>
      )}
    </Animated.View>
  );
}

function TodayView({ tasks, credits, totalXp, onComplete, onDelete, onAdd, onReduceScreenTime, onQuickGrant, quickGrantCount, dark }) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;

  const [verifyTask,   setVerifyTask]   = useState(null); // task being verified via prompts
  const [aiCheckTask,  setAiCheckTask]  = useState(null); // task being verified via AI

  const pending       = tasks.filter(t => !t.done);
  const done          = tasks.filter(t => t.done);
  const unlocked      = credits.balance > 0;
  const inDebt        = credits.balance < 0;
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
              {unlocked ? "Screen time balance" : inDebt ? "Screen time debt" : "No time earned yet"}
            </Text>
            <CreditTicker value={credits.balance} textColor={unlocked ? "#FFFFFF" : inDebt ? "#C0392B" : ink.deep} />
            <Text style={{ fontFamily: FB, fontSize: 12, color: unlocked ? "rgba(255,255,255,0.6)" : ink.faint, marginTop: 4 }}>
              {unlocked ? "Available now" : inDebt ? "Earn this back to unlock time" : "Complete a task below"}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            {unlocked
              ? <UnlockIcon size={28} color="#fff" />
              : <LockIcon size={28} color={earn.green} />}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: unlocked ? "rgba(255,255,255,0.15)" : earn.greenLo, borderRadius: 8, paddingVertical: 3, paddingHorizontal: 10, marginTop: 6 }}>
              <LevelIcon index={getLevelIdx(totalXp)} size={12} color={unlocked ? "#fff" : earn.greenD} />
              <Text style={{ fontFamily: FB, fontSize: 10, fontWeight: "600", color: unlocked ? "rgba(255,255,255,0.8)" : earn.greenD }}>
                {lv.name}
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

      <View style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}>
        <TouchableOpacity
          onPress={onReduceScreenTime}
          disabled={credits.balance <= 0}
          activeOpacity={0.75}
          style={{
            flex: 1,
            minHeight: 58,
            paddingVertical: 13,
            borderRadius: 16,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: credits.balance > 0 ? ink.border : "transparent",
            backgroundColor: credits.balance > 0 ? paper.card : ink.ghost,
          }}
        >
          <Text style={{ fontFamily: FK, fontSize: 14, textAlign: "center", color: credits.balance > 0 ? ink.deep : ink.faint }}>Reduce time</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onQuickGrant}
          disabled={quickGrantCount >= 3}
          activeOpacity={0.75}
          style={{
            flex: 1,
            minHeight: 58,
            paddingVertical: 13,
            borderRadius: 16,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: quickGrantCount < 3 ? earn.greenLo : ink.ghost,
            borderWidth: 1,
            borderColor: quickGrantCount < 3 ? "rgba(47,171,114,0.22)" : "transparent",
          }}
        >
          <Text style={{ fontFamily: FK, fontSize: 14, textAlign: "center", color: quickGrantCount < 3 ? earn.greenD : ink.faint }}>Take 15m</Text>
          <Text style={{ fontFamily: FB, fontSize: 10, textAlign: "center", color: quickGrantCount < 3 ? ink.mid : ink.faint, marginTop: 2 }}>{Math.max(0, 3 - quickGrantCount)} left today</Text>
        </TouchableOpacity>
      </View>

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
          <View style={{ marginBottom: 10 }}><ClipboardIcon size={42} color={ink.faint} /></View>
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
          <View key={t.id} style={{ marginBottom: 8 }}>
          <Swipeable
            onDelete={() => onDelete?.(t.id)}
            confirmTitle="Delete this task?"
            confirmMessage={`"${t.title}" will be removed.`}
          >
          <TouchableOpacity
            onPress={() => handleTaskTap(t)}
            style={{
              flexDirection: "row", alignItems: "center",
              backgroundColor: paper.card, borderRadius: 16,
              overflow: "hidden",
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
                  <View style={{ backgroundColor: `${cat.c}16`, borderRadius: 6, paddingVertical: 3, paddingHorizontal: 5 }}>
                    <CategoryIcon cat={t.cat} size={14} color={cat.c} />
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
              marginRight: 10, flexShrink: 0,
            }}>
              {t.aiCheck
                ? <SparkleIcon size={14} color={earn.blue} />
                : <CheckIcon size={14} color={earn.green} />}
            </View>
            {/* Inline delete button — also revealable via swipe-left */}
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation?.();
                Alert.alert("Delete this task?", `"${t.title}" will be removed.`, [
                  { text: "Cancel", style: "cancel" },
                  { text: "Delete", style: "destructive", onPress: () => onDelete?.(t.id) },
                ]);
              }}
              hitSlop={{ top: 12, bottom: 12, left: 6, right: 12 }}
              style={{
                width: 22, height: 22, borderRadius: 11,
                alignItems: "center", justifyContent: "center",
                marginRight: 12, flexShrink: 0,
                backgroundColor: ink.ghost,
              }}
            >
              <Text style={{ fontSize: 13, color: ink.mid, lineHeight: 15, fontWeight: "600" }}>×</Text>
            </TouchableOpacity>
          </TouchableOpacity>
          </Swipeable>
          </View>
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
                <CategoryIcon cat={t.cat} size={18} color={cat.c} />
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
function ProgressView({ tasks, totalXp, skips, onAddTask, dark }) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;
  const lv        = getLevel(totalXp);
  const prog      = xpProg(totalXp);
  const toNext    = xpToNext(totalXp);
  const done      = tasks.filter(t => t.done);
  const catCounts = done.reduce((a, t) => { a[t.cat] = (a[t.cat] || 0) + t.credits; return a; }, {});
  const maxCat    = Math.max(...Object.values(catCounts), 1);

  // Empty state — no tasks completed yet today
  if (done.length === 0 && tasks.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
        <View style={{ marginBottom: 14 }}><ChartIcon size={62} color={ink.faint} /></View>
        <Text style={{ fontFamily: FK, fontSize: 22, color: ink.deep, marginBottom: 6 }}>No stats yet</Text>
        <Text style={{ fontFamily: FB, fontSize: 13, color: ink.mid, textAlign: "center", marginBottom: 28, lineHeight: 19 }}>
          Add a task to start tracking{"\n"}your progress today.
        </Text>
        <TouchableOpacity onPress={onAddTask} style={{
          paddingVertical: 16, paddingHorizontal: 28, borderRadius: 16,
          backgroundColor: earn.terra,
          flexDirection: "row", alignItems: "center", gap: 10,
          shadowColor: earn.terra, shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.25, shadowRadius: 12, elevation: 6,
        }}>
          <Text style={{ fontFamily: FO, fontSize: 18, color: "#fff" }}>+</Text>
          <Text style={{ fontFamily: FK, fontSize: 16, color: "#fff" }}>Do a Task</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 18, paddingBottom: 110 }}>
      {/* Level card */}
      <View style={{ backgroundColor: paper.card, borderRadius: 16, padding: 20, borderWidth: 0.5, borderColor: ink.border, marginBottom: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 14 }}>
          <LevelIcon index={getLevelIdx(totalXp)} size={40} color={earn.green} />
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
                <View style={{ width: 26, alignItems: "center" }}><CategoryIcon cat={cat} size={18} color={meta.c} /></View>
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
function BlockedHoursModal({ visible, rules, dark, onClose, onSave }) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;
  const [draft, setDraft] = useState(rules || []);
  const [start, setStart] = useState("22:00");
  const [end, setEnd] = useState("07:00");

  useEffect(() => {
    if (visible) setDraft(rules || []);
  }, [visible, rules]);

  const addRule = () => {
    const sM = timeToMins(start);
    const eM = timeToMins(end);
    if (sM == null || eM == null || sM === eM) {
      Alert.alert("Blocked hours", "Use valid 24-hour times like 22:00 and 07:00.");
      return;
    }
    setDraft(list => [
      ...list,
      { id: `bh_${Date.now()}`, start: minsToTime(sM), end: minsToTime(eM), enabled: true },
    ]);
  };

  const save = () => {
    onSave(draft);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s2.backdrop}>
        <View style={[s2.panel, { backgroundColor: paper.card, borderColor: ink.border }]}>
          <Text style={[s2.kicker, { color: ink.faint }]}>BLOCKED HOURS</Text>
          <Text style={[s2.panelTitle, { color: ink.deep }]}>Recurring zero-time windows</Text>
          <Text style={[s2.panelText, { color: ink.mid }]}>
            During these hours Drift treats your available screen time as 0 and keeps blocked apps shielded.
          </Text>

          <View style={{ gap: 8, marginBottom: 14 }}>
            {draft.length === 0 ? (
              <Text style={[s2.emptyText, { color: ink.faint }]}>No blocked hours yet.</Text>
            ) : draft.map(rule => (
              <View
                key={rule.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  padding: 12,
                  borderRadius: 14,
                  backgroundColor: paper.warm,
                  borderWidth: 1,
                  borderColor: ink.border,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: FK, fontSize: 15, color: ink.deep }}>
                    {prettyTime(rule.start)} - {prettyTime(rule.end)}
                  </Text>
                  <Text style={{ fontFamily: FB, fontSize: 11, color: ink.mid, marginTop: 2 }}>
                    Repeats every day
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setDraft(list => list.map(r => r.id === rule.id ? { ...r, enabled: !r.enabled } : r))}
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 12,
                    backgroundColor: rule.enabled ? earn.terraLo : ink.ghost,
                  }}
                >
                  <Text style={{ fontFamily: FK, fontSize: 12, color: rule.enabled ? earn.greenD : ink.mid }}>
                    {rule.enabled ? "On" : "Off"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setDraft(list => list.filter(r => r.id !== rule.id))}
                  style={{ paddingVertical: 8, paddingHorizontal: 8 }}
                >
                  <Text style={{ fontFamily: FK, fontSize: 18, color: "#E05050" }}>x</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
            {[
              ["Start", start, setStart],
              ["End", end, setEnd],
            ].map(([label, value, setter]) => (
              <View key={label} style={{ flex: 1 }}>
                <Text style={[s.label, { color: ink.faint }]}>{label}</Text>
                <TextInput
                  value={value}
                  onChangeText={(t) => setter(t.replace(/[^\d:]/g, "").slice(0, 5))}
                  onBlur={() => {
                    const mins = timeToMins(value);
                    setter(mins == null ? (label === "Start" ? "22:00" : "07:00") : minsToTime(mins));
                  }}
                  keyboardType="numbers-and-punctuation"
                  placeholder="22:00"
                  placeholderTextColor={ink.faint}
                  style={{
                    paddingVertical: 12,
                    paddingHorizontal: 12,
                    borderRadius: 13,
                    backgroundColor: paper.warm,
                    borderWidth: 1,
                    borderColor: ink.border,
                    color: ink.deep,
                    fontFamily: FO,
                    fontSize: 13,
                    textAlign: "center",
                  }}
                />
              </View>
            ))}
            <TouchableOpacity
              onPress={addRule}
              style={{
                alignSelf: "flex-end",
                paddingHorizontal: 16,
                height: 44,
                borderRadius: 14,
                backgroundColor: earn.green,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontFamily: FK, fontSize: 14, color: "#fff" }}>Add</Text>
            </TouchableOpacity>
          </View>

          <View style={s2.actions}>
            <TouchableOpacity onPress={onClose} style={[s2.ghostBtn, { borderColor: ink.border }]}>
              <Text style={[s2.ghostText, { color: ink.mid }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={save} style={[s2.solidBtn, { backgroundColor: earn.green }]}>
              <Text style={s2.solidText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function RecurringTasksModal({ visible, templates, dark, onClose, onSave }) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;
  const [draft, setDraft] = useState(templates || []);

  useEffect(() => {
    if (visible) setDraft(templates || []);
  }, [visible, templates]);

  const save = () => {
    onSave(draft);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s2.backdrop}>
        <View style={[s2.panel, { backgroundColor: paper.card, borderColor: ink.border }]}>
          <Text style={[s2.kicker, { color: ink.faint }]}>RECURRING TASKS</Text>
          <Text style={[s2.panelTitle, { color: ink.deep }]}>Task schedule</Text>
          <Text style={[s2.panelText, { color: ink.mid }]}>
            These tasks appear automatically on Today when their scheduled time and repeat pattern match.
          </Text>

          <View style={{ gap: 8, marginBottom: 16 }}>
            {draft.length === 0 ? (
              <Text style={[s2.emptyText, { color: ink.faint }]}>No recurring tasks yet.</Text>
            ) : draft.map(item => (
              <View
                key={item.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  padding: 12,
                  borderRadius: 14,
                  backgroundColor: paper.warm,
                  borderWidth: 1,
                  borderColor: ink.border,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: FK, fontSize: 15, color: ink.deep }} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={{ fontFamily: FB, fontSize: 11, color: ink.mid, marginTop: 2 }}>
                    {recurrenceLabel(item)} at {prettyTime(item.time)} - {fmtMins(item.credits)} reward
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setDraft(list => list.map(t => t.id === item.id ? { ...t, enabled: t.enabled === false } : t))}
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 12,
                    backgroundColor: item.enabled === false ? ink.ghost : earn.terraLo,
                  }}
                >
                  <Text style={{ fontFamily: FK, fontSize: 12, color: item.enabled === false ? ink.mid : earn.greenD }}>
                    {item.enabled === false ? "Off" : "On"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setDraft(list => list.filter(t => t.id !== item.id))}
                  style={{ paddingVertical: 8, paddingHorizontal: 8 }}
                >
                  <Text style={{ fontFamily: FK, fontSize: 18, color: "#E05050" }}>x</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>

          <View style={s2.actions}>
            <TouchableOpacity onPress={onClose} style={[s2.ghostBtn, { borderColor: ink.border }]}>
              <Text style={[s2.ghostText, { color: ink.mid }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={save} style={[s2.solidBtn, { backgroundColor: earn.green }]}>
              <Text style={s2.solidText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

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

const s2 = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.48)",
    alignItems: "center",
    justifyContent: "flex-end",
    padding: 16,
  },
  panel: {
    width: "100%",
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 22,
    paddingBottom: Platform.OS === "ios" ? 30 : 22,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.18,
    shadowRadius: 30,
    elevation: 18,
  },
  kicker: { fontFamily: FO, fontSize: 9, letterSpacing: 2, marginBottom: 8 },
  panelTitle: { fontFamily: FK, fontSize: 24, fontStyle: "italic", marginBottom: 8 },
  panelText: { fontFamily: FB, fontSize: 14, lineHeight: 21, marginBottom: 18 },
  emptyText: { fontFamily: FB, fontSize: 13, marginVertical: 14 },
  amountGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 18 },
  amountPill: {
    minWidth: 72,
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
  },
  amountText: { fontFamily: FO, fontSize: 13 },
  actions: { flexDirection: "row", gap: 10, marginTop: 4 },
  ghostBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: "center",
  },
  ghostText: { fontFamily: FK, fontSize: 15 },
  solidBtn: { flex: 1, borderRadius: 16, paddingVertical: 15, alignItems: "center" },
  solidText: { fontFamily: FK, fontSize: 15, color: "#fff" },
  progressTrack: { height: 6, borderRadius: 3, overflow: "hidden", marginBottom: 20 },
  progressFill: { height: "100%", borderRadius: 3 },
  breathOrb: { width: 120, height: 120, borderRadius: 60, marginBottom: 22 },
  footerHint: { marginTop: 14, textAlign: "center", fontSize: 11 },
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
  const [taskHistory, setTaskHistory] = useState([]);
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
  const [showBlockedHours,   setShowBlockedHours]   = useState(false);
  const [showRecurringTasks, setShowRecurringTasks] = useState(false);
  const [firstTimeBlockedApps, setFirstTimeBlockedApps] = useState(false);
  const [showUsernameSetup,  setShowUsernameSetup]  = useState(false);
  const [showReduceTime,     setShowReduceTime]     = useState(false);
  const [showQuickGrant,     setShowQuickGrant]     = useState(false);
  const [quickGrantCount,    setQuickGrantCount]    = useState(0);
  const [checkoutUrl,        setCheckoutUrl]        = useState("");
  const [showCheckout,       setShowCheckout]       = useState(false);
  const [userEmail,          setUserEmail]          = useState("");
  const [myUsername,         setUserName]           = useState("");
  const [screenTimeStatus,   setScreenTimeStatus]   = useState("unknown");
  const [childSwipeLocked,   setChildSwipeLocked]   = useState(false);
  const [blockedHours,       setBlockedHours]       = useState([]);
  const [blockedHoursActive, setBlockedHoursActive] = useState(false);
  const [recurringTasks,     setRecurringTasks]     = useState([]);
  const [minuteTick,         setMinuteTick]         = useState(0);

  // Subscription state (Stripe → Supabase) — server is source of truth
  const { active: subActive, refresh: refreshSub } = useSubscription(userId);
  // Beta tester flow: code redemption grants REAL Pro access via the server
  // (sets profiles.beta_unlocked_at). The previewAsFree toggle then lets the
  // tester flip the UI between Pro and Free for testing — server-side they
  // remain Pro the whole time, so AI features keep working even while
  // previewing the Free UI (they'd just hit the paywall in-app).
  const beta = useBetaMode(userId);
  const rawProAccess = isPremium || subActive;
  const proAccess = (beta.unlocked && beta.previewAsFree) ? false : rawProAccess;
  const [driftInActive,  setDriftInActive]  = useState(false);
  const [darkMode,       setDarkMode]       = useState(false);

  const secRef          = useRef(0);
  const tickRef         = useRef(null);
  const tabRef          = useRef(tab);
  const driftInActRef   = useRef(driftInActive);
  const swipeBlockedRef = useRef(false);
  useEffect(() => { tabRef.current = tab; }, [tab]);
  useEffect(() => { driftInActRef.current = driftInActive; }, [driftInActive]);

  // Block tab swipes whenever an overlay/popup/nested swipe UI is active.
  useEffect(() => {
    swipeBlockedRef.current =
      driftInActive ||
      !!overlay ||
      !!popup ||
      showAccount ||
      showBlockedApps ||
      showBlockedHours ||
      showRecurringTasks ||
      showPaywall ||
      showReduceTime ||
      showQuickGrant ||
      showCheckout ||
      (tab === "friends" && childSwipeLocked);
  }, [driftInActive, overlay, popup, showAccount, showBlockedApps, showBlockedHours, showRecurringTasks, showPaywall, showReduceTime, showQuickGrant, showCheckout, tab, childSwipeLocked]);

  const stopTick = () => { if (tickRef.current) clearInterval(tickRef.current); };

  // Swipe between tabs
  const tabSwipe = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) => {
        if (swipeBlockedRef.current) return false;
        // Require a clearly-horizontal gesture with enough travel.
        // The high ratio prevents accidental triggers when a child component
        // (e.g. a horizontal ScrollView of challenges) is being swiped.
        if (tabRef.current === "friends") return false;
        return Math.abs(gs.dx) > Math.abs(gs.dy) * 3 && Math.abs(gs.dx) > 42;
      },
      // If a child wants the gesture (any horizontal ScrollView/FlatList),
      // let it have it — never wrest control back.
      onPanResponderTerminationRequest: () => true,
      onShouldBlockNativeResponder: () => false,
      onPanResponderRelease: (_, gs) => {
        if (swipeBlockedRef.current) return;
        const idx = TABS.findIndex(t => t.id === tabRef.current);
        if (gs.dx > 80 && idx > 0)                       setTab(TABS[idx - 1].id);
        else if (gs.dx < -80 && idx < TABS.length - 1)   setTab(TABS[idx + 1].id);
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
    // Sync the displayed value immediately so the header doesn't show stale
    // balance for up to a second after a task completes / session ends.
    setSecLeft(initialSec);
    // (No setInterval — drain is computed from wall-clock delta on foreground.)
  };

  // Keep `secLeft` visually fresh when the app IS active (read-only — no drain)
  useEffect(() => {
    if (screen !== "app") return;
    const i = setInterval(() => setSecLeft(secRef.current), 1000);
    return () => clearInterval(i);
  }, [screen]);

  // ── Screen-time drain (works across background AND full kill) ──
  //
  // The model: whenever Drift is NOT in the foreground, we assume the user
  // is spending their earned balance on other apps. To make this work even
  // when the JS context is killed (swipe-up close), we persist a
  // `drift_last_alive` timestamp constantly. On launch, we compare to wall
  // clock to compute elapsed time.
  //
  // We update last_alive:
  //   - every 15s while foregrounded ("I'm still alive")
  //   - immediately when backgrounded
  //   - immediately when returning to foreground (after draining)
  //
  // We DO drain when:
  //   - user backgrounds (live foreground→background transition)
  //   - app launches with credits > 0 and last_alive is older than now
  //
  // We DON'T drain when:
  //   - a Drift In focus session is active (the shield is up)
  //   - no credits to drain
  const bgTimeRef = useRef(null);

  const persistLastAlive = useCallback(() => {
    AsyncStorage.setItem("drift_last_alive", String(Date.now())).catch(() => {});
  }, []);

  const drainBy = useCallback((elapsedSec) => {
    // JS cannot know which background app is foregrounded. Only Apple's
    // DeviceActivity monitor can count selected restricted apps, so do not
    // subtract balance from generic background/closed-app time.
  }, []);

  // 1. Heartbeat while foregrounded — every 15s, write "I'm alive" timestamp
  useEffect(() => {
    if (screen !== "app") return;
    persistLastAlive();
    const id = setInterval(persistLastAlive, 15_000);
    return () => clearInterval(id);
  }, [screen, persistLastAlive]);

  // 2. AppState transitions: drain on foregrounding, stamp on backgrounding
  useEffect(() => {
    const sub = AppState.addEventListener("change", next => {
      if (next !== "active") {
        bgTimeRef.current = Date.now();
        persistLastAlive();   // stamp NOW so kill-while-bg still measures correctly
        stopTick();
      } else if (bgTimeRef.current && screen === "app") {
        const elapsedSec = Math.floor((Date.now() - bgTimeRef.current) / 1000);
        bgTimeRef.current = null;
        try { refreshSub?.(); } catch {}
        drainBy(elapsedSec);
        persistLastAlive();
      }
    });
    return () => { sub.remove(); stopTick(); };
  }, [screen, drainBy, persistLastAlive]);

  // 3. Launch-time catch-up: app just opened — drain by (now - last_alive)
  // Runs once when we transition into "app" screen (i.e. user is signed-in
  // and ready). Compares wall clock to the persisted heartbeat, drains the
  // delta. Handles the swipe-up-to-close case.
  const launchDrainRanRef = useRef(false);
  useEffect(() => {
    if (screen !== "app" || launchDrainRanRef.current) return;
    launchDrainRanRef.current = true;
    (async () => {
      try {
        const lastStr = await AsyncStorage.getItem("drift_last_alive");
        if (!lastStr) { persistLastAlive(); return; }
        const last = parseInt(lastStr, 10);
        if (!Number.isFinite(last)) { persistLastAlive(); return; }
        const elapsedSec = Math.floor((Date.now() - last) / 1000);
        // Cap absurd values (clock changes, multi-day kill) at 24h to avoid
        // wiping a freshly-earned balance because of bad clock math.
        const capped = Math.min(elapsedSec, 86_400);
        if (capped > 0) drainBy(capped);
        persistLastAlive();
      } catch {}
    })();
  }, [screen, drainBy, persistLastAlive]);

  useEffect(() => {
    AsyncStorage.getItem("drift_dark_mode").then(v => { if (v === "1") setDarkMode(true); });
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(`drift_quick_grants_${todayKey()}`)
      .then(v => setQuickGrantCount(Number(v || 0)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!userId) return;
    AsyncStorage.getItem(`drift_blocked_hours_${userId}`)
      .then(v => {
        const parsed = JSON.parse(v || "[]");
        setBlockedHours(Array.isArray(parsed) ? parsed : []);
      })
      .catch(() => {});
    AsyncStorage.getItem(`drift_recurring_tasks_${userId}`)
      .then(v => {
        const parsed = JSON.parse(v || "[]");
        setRecurringTasks(Array.isArray(parsed) ? parsed : []);
      })
      .catch(() => {});
  }, [userId]);

  useEffect(() => {
    const update = () => setBlockedHoursActive(isBlockedHourNow(blockedHours));
    if (!proAccess) {
      setBlockedHoursActive(false);
      return;
    }
    update();
    const id = setInterval(() => { update(); setMinuteTick(t => t + 1); }, 30_000);
    return () => clearInterval(id);
  }, [blockedHours, proAccess]);

  useEffect(() => {
    if (screen !== "app" || !userId || !proAccess || !recurringTasks.length) return;
    const today = todayKey();
    const existing = new Set(tasks.map(t => t.id));
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const due = recurringTasks
      .filter(t => t?.enabled !== false)
      .filter(t => t.createdDate !== today)
      .filter(t => recurrenceMatchesDate(t, now))
      .filter(t => {
        const scheduled = timeToMins(t.time);
        return scheduled == null || nowMins >= scheduled;
      })
      .filter(t => !existing.has(`rt_${t.id}_${today}`));
    if (!due.length) return;

    const created = due.map(t => ({
      id: `rt_${t.id}_${today}`,
      title: t.title,
      cat: t.cat,
      minutes: t.minutes,
      credits: t.credits,
      xp: t.xp,
      done: false,
      aiCheck: !!t.aiCheck,
      aiValued: !!t.aiValued,
      aiReasoning: t.aiReasoning || "",
      task_date: today,
      recurringTemplateId: t.id,
      scheduledTime: t.time,
    }));
    const nt = [...created, ...tasks];
    setTasks(nt);
    persist({ tasks: nt });
    cache.saveTasks(userId, nt);
    created.forEach(t => insertTask(userId, t).catch(e => {
      console.warn("recurring task sync failed:", e?.message);
    }));
  }, [screen, userId, proAccess, recurringTasks, tasks, minuteTick]);

  // Deep-link friend invites — drift://add-friend/[username]
  useEffect(() => {
    const handleUrl = async (url) => {
      if (!url || !userId) return;
      const m = url.match(/add-friend\/([A-Za-z0-9_]+)/);
      if (!m) return;
      const username = m[1].toLowerCase();
      try {
        const { data: profile } = await rateLimited(`friend_lookup_${userId}`, { limit: 30, windowMs: 60_000 }, () =>
          cached(`profile_lookup_${username}`, 30_000, () =>
            supabase
              .from("profiles").select("id, username")
              .ilike("username", username).maybeSingle()
          )
        );
        if (!profile) { Alert.alert("Not found", `@${username} isn't on Drift yet.`); return; }
        if (profile.id === userId) { Alert.alert("That's you", "You can't add yourself."); return; }
        const { error } = await rateLimited(`friend_request_${userId}`, { limit: 20, windowMs: 60_000 }, () =>
          supabase.from("friendships").insert({
            user_id: userId, friend_id: profile.id, status: "pending",
          })
        );
        if (error && error.code !== "23505") {
          Alert.alert("Couldn't send", error.message);
        } else {
          Alert.alert("Request sent", `Friend request sent to @${username}.`);
        }
      } catch (e) { Alert.alert("Error", e?.message || "Try again."); }
    };
    Linking.getInitialURL().then(handleUrl);
    const sub = Linking.addEventListener("url", ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, [userId]);

  // On app launch / foreground, check whether the DriftMonitor extension
  // already drained the balance to zero while Drift was closed. If so, sync
  // the JS state down to 0 so the UI matches what iOS has enforced.
  useEffect(() => {
    const sync = async () => {
      const depleted = await consumeDepletedFlag();
      if (!depleted) return;
      secRef.current = 0;
      setSecLeft(0);
      await AsyncStorage.removeItem("drift_last_armed_balance").catch(() => {});
      setLastArmedBalance(-1);
      setCredits(c => {
        const nc = { ...c, balance: 0, balanceSec: 0,
          spent: Math.min(c.earned, c.spent + (c.balance || 0)) };
        persist({ credits: nc });
        return nc;
      });
    };
    sync();
    const sub = AppState.addEventListener("change", n => { if (n === "active") sync(); });
    return () => sub.remove();
  }, []);

  // Keep the Apple Screen Time shield in sync with balance.
  // balance == 0 → shield ON (blocked apps shielded)
  // balance > 0  → shield OFF (user has earned time to spend)
  // The Drift In session shield is handled separately and overrides this.
  //
  // Critically: we ONLY re-arm the iOS DeviceActivity timer when balance
  // increases (user just earned). Just opening the app shouldn't restart
  // iOS's cumulative usage counter — that would let users "reset" their
  // remaining time by reopening Drift.
  const shieldStateRef = useRef(null);       // "on" | "off" | null
  // null = not yet loaded; number = last value we armed iOS with; -1 = no current arming.
  const [lastArmedBalance, setLastArmedBalance] = useState(null);
  useEffect(() => {
    AsyncStorage.getItem("drift_last_armed_balance").then(v => {
      setLastArmedBalance(v != null ? Number(v) : -1);
    });
  }, []);

  useEffect(() => {
    if (driftInActive) return; // session handler controls shield
    if (blockedHoursActive) {
      (async () => {
        try {
          await stopBalanceMonitoring();
          await applyBlocking([]);
          if (lastArmedBalance !== -1) {
            await AsyncStorage.removeItem("drift_last_armed_balance");
            setLastArmedBalance(-1);
          }
          shieldStateRef.current = "on";
        } catch {}
      })();
      return;
    }
    if (lastArmedBalance === null) return; // waiting for AsyncStorage

    const desired = credits.balance > 0 ? "off" : "on";
    const prevState = shieldStateRef.current;

    (async () => {
      try {
        if (desired === "on") {
          if (prevState !== "on") {
            await stopBalanceMonitoring();
            await applyBlocking([]);
            if (lastArmedBalance !== -1) {
              await AsyncStorage.removeItem("drift_last_armed_balance");
              setLastArmedBalance(-1);
            }
          }
        } else {
          if (prevState !== "off") await clearBlocking();

          // (Re)arm iOS only when balance went UP — never on launch with the
          // same balance we previously armed for, because iOS already has a
          // monitor running and re-arming would reset its cumulative counter.
          const shouldArm = lastArmedBalance === -1 || credits.balance > lastArmedBalance;
          if (shouldArm) {
            // Pass exact seconds so iOS's threshold matches the displayed
            // balance — passing minutes rounds the threshold up.
            const seconds = typeof credits.balanceSec === "number"
              ? credits.balanceSec
              : credits.balance * 60;
            const res = await startBalanceMonitoring(seconds);
            if (res?.started === false) {
              Alert.alert("Background timer not active", res.reason || "Unknown");
            } else {
              await AsyncStorage.setItem("drift_last_armed_balance", String(credits.balance));
              setLastArmedBalance(credits.balance);
            }
          }
        }
        shieldStateRef.current = desired;
      } catch {}
    })();
  }, [credits.balance, driftInActive, blockedHoursActive, lastArmedBalance]);

  // Refresh Screen Time auth status when the account sheet opens
  useEffect(() => {
    if (!showAccount) return;
    (async () => { setScreenTimeStatus(await getScreenTimeAuthStatus()); })();
  }, [showAccount]);

  // Refetch username whenever the account sheet opens so it's never blank
  useEffect(() => {
    if (!showAccount || !userId) return;
    (async () => {
      try {
        const { data: prof } = await cached(`drift_profile_${userId}`, 30_000, () =>
          supabase
            .from("profiles").select("username").eq("id", userId).maybeSingle()
        );
        if (prof?.username) {
          setUserName(prof.username);
          AsyncStorage.setItem("drift_username", prof.username);
          // OAuth-created accounts may have a placeholder username from the
          // DB trigger ("drifter" + random). Prompt them to pick a real one.
          if (/^drifter[a-z0-9]{6,}$/i.test(prof.username)) {
            setShowUsernameSetup(true);
          }
        } else if (!myUsername) {
          const storedUsername = await AsyncStorage.getItem("drift_username");
          if (storedUsername) setUserName(storedUsername);
        }
      } catch {}
    })();
  }, [showAccount, userId]);

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
        const { data: { session } } = await safeGetSession();
        const uid = session?.user?.id ?? null;
        setUserId(uid);
        setUserEmail(session?.user?.email ?? "");
        if (uid) {
          try {
            const { data: prof, error: pErr } = await cached(`drift_profile_${uid}`, 30_000, () =>
              supabase
                .from("profiles").select("username").eq("id", uid).maybeSingle()
            );
            if (pErr) console.warn("profile fetch:", pErr.message);
            if (prof?.username) {
              setUserName(prof.username);
              AsyncStorage.setItem("drift_username", prof.username);
            } else {
              const cached = await AsyncStorage.getItem("drift_username");
              if (cached) setUserName(cached);
            }
          } catch (e) { console.warn("profile fetch err:", e?.message); }
        }
        if (!uid) {
          // Returning users who completed onboarding once just see sign-in
          const hasOnboarded = await AsyncStorage.getItem("drift_onboarded");
          setSignInOnly(hasOnboarded === "1");
          setOnboarding(true);
          return;
        }
        try {
          await rateLimited("claim_trial", { limit: 3, windowMs: 10 * 60_000 }, () =>
            supabase.functions.invoke("claim-trial", {})
          );
        } catch {}

        // ── Server-authoritative state: tasks come from Supabase ──
        // Boot order: show cached state instantly, then refresh from server.
        let remoteTasksApplied = false;
        try {
          const cached = await cache.loadTasks(uid);
          if (cached.length) setTasks(cached);
          const cachedXp = await cache.loadXp(uid);
          if (cachedXp) setTotalXp(cachedXp);
        } catch {}
        try {
          const remote = await fetchTasks(uid);
          if (remote) {
            // Only show tasks from today (matches the existing "today's work" model)
            const today = remote.filter(t => t.task_date === todayKey() || !t.task_date);

            // Merge in any local-only tasks (created while offline and not yet synced).
            // We identify local-only tasks by ID not appearing in the remote set.
            const remoteIds = new Set(today.map(t => t.id));
            const localOnly = (await cache.loadTasks(uid).catch(() => []))?.filter(
              t => !remoteIds.has(t.id) && (t.task_date === todayKey() || !t.task_date)
            ) || [];
            const merged = [...today, ...localOnly];

            setTasks(merged);
            cache.saveTasks(uid, merged);
            remoteTasksApplied = true;
            // Build history from completed tasks across all dates
            const allDone = remote.filter(t => t.done);
            setTaskHistory(prev => mergeCompletedTasks(prev, allDone));

            // Retry-sync any local-only tasks now that we're online
            for (const lt of localOnly) {
              insertTask(uid, lt).catch(e => console.warn("retry insertTask:", e?.message));
            }
          }
        } catch (e) { console.warn("fetchTasks at boot:", e?.message); }

        let remoteStatsApplied = false;
        try {
          const stats = await fetchProfileStats(uid);
          if (stats.totalXp > 0) {
            setTotalXp(stats.totalXp);
            cache.saveXp(uid, stats.totalXp);
            remoteStatsApplied = true;
          }
          if (stats.balanceSeconds > 0) {
            const restoredCredits = {
              balance: Math.ceil(stats.balanceSeconds / 60),
              balanceSec: stats.balanceSeconds,
              earned: Math.ceil(stats.balanceSeconds / 60),
              spent: 0,
            };
            setCredits(restoredCredits);
            secRef.current = stats.balanceSeconds;
            setSecLeft(stats.balanceSeconds);
            remoteStatsApplied = true;
          }
        } catch (e) { console.warn("fetchProfileStats at boot:", e?.message); }

        const { isPremium: prem, daysLeft } = await getTrialStatus(uid);
        setIsPremium(prem);
        setTrialDays(daysLeft);
        const d = await storage.get("drift_v4");
        if (d?.value) {
          const p = JSON.parse(d.value);
          const savedTasks = p.tasks || [];
          const savedHistory = p.taskHistory || [];
          const completedFromSavedTasks = savedTasks
            .filter(t => t.done)
            .map(t => ({ ...t, completedAt: t.completedAt || p.date || todayKey() }));
          const history = mergeCompletedTasks(savedHistory, completedFromSavedTasks);
          setTaskHistory(prev => mergeCompletedTasks(prev, history));
          if (p.date !== todayKey()) {
            if (!remoteStatsApplied) setTotalXp(p.totalXp || 0);
            if (!remoteTasksApplied) {
              setTasks([]);
              persist({ tasks: [], taskHistory: history, totalXp: p.totalXp || 0 });
            }
          } else {
            const sc = p.credits || { balance: 0, earned: 0, spent: 0 };
            if (!remoteTasksApplied) setTasks(savedTasks);
            if (!remoteStatsApplied) {
              setCredits(sc);
              setTotalXp(p.totalXp || 0);
            }
            // Prefer the saved sub-minute precision so closing the app doesn't
            // round you back up to the nearest minute.
            const initSec = typeof sc.balanceSec === "number"
              ? sc.balanceSec
              : (sc.balance || 0) * 60;
            if (!remoteStatsApplied) {
              secRef.current = initSec;
              setSecLeft(initSec);
            }
          }
        }
        setScreen("app");
      } catch { setScreen("app"); }
    })();
  }, []);

  const persist = async upd => {
    try {
      await storage.set("drift_v4", JSON.stringify({
        tasks:       upd.tasks       ?? tasks,
        taskHistory: upd.taskHistory ?? taskHistory,
        credits:     upd.credits     ?? credits,
        totalXp:     upd.totalXp     ?? totalXp,
        date:        todayKey(),
      }));
    } catch {}
  };

  const completeTask = id => {
    const task = tasks.find(t => t.id === id);
    if (!task || task.done) return;
    const completedTask = { ...task, done: true, completedAt: new Date().toISOString(), completedDate: todayKey() };
    const nt  = tasks.map(t => t.id === id ? completedTask : t);
    const nh = mergeCompletedTasks(taskHistory, completedTask);
    const nx  = totalXp + task.xp;
    const newSec = secRef.current + task.credits * 60;
    const nc  = { balance: Math.ceil(newSec / 60), balanceSec: newSec, earned: credits.earned + task.credits, spent: credits.spent };
    setTasks(nt); setTaskHistory(nh); setCredits(nc); setTotalXp(nx);
    setPopup({ credits: task.credits, xp: task.xp });
    setTimeout(() => setPopup(null), 2000);
    startTick(newSec);
    persist({ tasks: nt, taskHistory: nh, credits: nc, totalXp: nx });

    // ── Server-of-truth writes ──
    if (userId) {
      completeTaskRow(userId, id).catch(e => console.warn("completeTaskRow:", e?.message));
      appendLedgerEntry(userId, {
        delta: task.credits,
        reason: "task_complete",
        refId: id,
        balanceAfter: nc.balance,
      }).catch(() => {});
      syncProfileStats(userId, { totalXp: nx, balanceSeconds: newSec }).catch(() => {});
      cache.saveTasks(userId, nt);
      cache.saveXp(userId, nx);
    }

    // Belt-and-suspenders: explicitly clear the Screen Time shield the
    // moment we earn balance, instead of waiting on the useEffect to
    // notice the credits change.
    if (nc.balance > 0 && !driftInActive) {
      shieldStateRef.current = "off";
      clearBlocking();
    }
  };

  const addTask  = (t, recurrence) => {
    const nt = [...tasks, t];
    setTasks(nt); persist({ tasks: nt });
    if (userId) {
      // Sync to Supabase. If offline, the local cache + persisted state still
      // shows the task, and the next foreground will re-sync via fetchTasks.
      insertTask(userId, t).catch(e => {
        console.warn("insertTask sync failed (will retry on next fetch):", e?.message);
      });
      cache.saveTasks(userId, nt);
    }
    if (userId && proAccess && recurrence?.frequency && recurrence.frequency !== "none") {
      const template = {
        id: `rt_${Date.now()}`,
        title: t.title,
        cat: t.cat,
        minutes: t.minutes,
        credits: t.credits,
        xp: t.xp,
        aiCheck: !!t.aiCheck,
        aiValued: !!t.aiValued,
        aiReasoning: t.aiReasoning || "",
        frequency: recurrence.frequency || "daily",
        time: recurrence.time || "09:00",
        days: recurrence.days || recurrenceDaysFor(recurrence.frequency) || null,
        enabled: true,
        createdDate: todayKey(),
        createdAt: new Date().toISOString(),
      };
      setRecurringTasks(prev => {
        const next = [...prev, template];
        AsyncStorage.setItem(`drift_recurring_tasks_${userId}`, JSON.stringify(next)).catch(() => {});
        return next;
      });
    }
  };

  // SOFT delete only — Supabase row stays for audit / recovery.
  const deleteTask = id => {
    const target = tasks.find(t => t.id === id);
    if (!target) return;
    const nt = tasks.filter(t => t.id !== id);
    setTasks(nt);
    persist({ tasks: nt });
    if (userId) {
      softDeleteTask(userId, id).catch(e => console.warn("softDeleteTask:", e?.message));
      cache.saveTasks(userId, nt);
    }
  };

  const handleDriftInStart  = async () => {
    setDriftInActive(true);
    try { await stopBalanceMonitoring(); } catch {}
    await AsyncStorage.removeItem("drift_last_armed_balance").catch(() => {});
    setLastArmedBalance(-1);

    // Warn if no apps are blocked — common foot-gun where users skip the picker
    // and assume the focus session is enforced. Beta testers will report this.
    try {
      const list = await (await import("./blockedApps")).getBlockedApps();
      if (!list || list.length === 0) {
        Alert.alert(
          "No apps to block",
          "You haven't picked any apps yet. Drift In will still run, but distracting apps won't be blocked. Open Profile → Blocked apps to pick some.",
          [{ text: "OK" }]
        );
      }
    } catch {}

    try {
      // Always call applyBlocking — on iOS the native side reads the user's
      // FamilyActivityPicker selection from UserDefaults, not AsyncStorage.
      const res = await applyBlocking([]);
      if (res && res.applied === false && res.reason) {
        // In Expo Go this always fails — don't bother the user with the alert.
        if (!/Expo Go|unavailable/i.test(res.reason)) {
          Alert.alert("Couldn't block apps", res.reason);
        }
      }
    } catch (e) {
      Alert.alert("Block error", e?.message || String(e));
    }
  };
  const handleDriftInEnd    = () => {
    setDriftInActive(false);
    if (secRef.current > 0) clearBlocking();
    else applyBlocking([]);
  };

  const handleDriftInComplete = ({ credits: earned, xp }) => {
    setDriftInActive(false);
    clearBlocking();
    const newSec = secRef.current + earned * 60;
    const nx  = totalXp + xp;
    const nc  = { balance: Math.ceil(newSec / 60), balanceSec: newSec, earned: credits.earned + earned, spent: credits.spent };
    setCredits(nc); setTotalXp(nx);
    setPopup({ credits: earned, xp });
    setTimeout(() => setPopup(null), 2500);
    startTick(newSec);
    persist({ credits: nc, totalXp: nx });
    setTimeout(() => setTab("today"), 400);
  };

  const handleChallengeResolved = ({ won, xp, penaltyMins }) => {
    if (won) {
      const nx = totalXp + xp;
      setTotalXp(nx);
      setPopup({ credits: 0, xp });
      setTimeout(() => setPopup(null), 2200);
      persist({ totalXp: nx });
      return;
    }

    const penaltySec = Math.max(0, penaltyMins || 0) * 60;
    const newSec = secRef.current - penaltySec;
    const lostMins = penaltyMins || 0;
    secRef.current = newSec;
    setSecLeft(newSec);
    AsyncStorage.removeItem("drift_last_armed_balance").catch(() => {});
    setLastArmedBalance(-1);
    const nc = {
      ...credits,
      balance: Math.ceil(newSec / 60),
      balanceSec: newSec,
      spent: credits.spent + lostMins,
    };
    setCredits(nc);
    persist({ credits: nc });
  };

  const applyBalanceSeconds = useCallback((newSec, nextCredits, popupData) => {
    secRef.current = newSec;
    setSecLeft(newSec);
    setCredits(nextCredits);
    if (popupData) {
      setPopup(popupData);
      setTimeout(() => setPopup(null), 2200);
    }
    startTick(newSec);
    persist({ credits: nextCredits });
    if (userId) {
      syncProfileStats(userId, { totalXp, balanceSeconds: newSec }).catch(() => {});
    }
  }, [credits, totalXp, userId]);

  const handleReduceScreenTime = (mins) => {
    const requestedSec = Math.max(0, Math.floor(mins || 0) * 60);
    const availableSec = Math.max(0, secRef.current);
    if (!requestedSec || requestedSec > availableSec) return;
    const newSec = availableSec - requestedSec;
    const reducedMins = requestedSec / 60;
    const nextCredits = {
      ...credits,
      balance: Math.ceil(newSec / 60),
      balanceSec: newSec,
      spent: credits.spent + reducedMins,
    };
    setShowReduceTime(false);
    applyBalanceSeconds(newSec, nextCredits, { loss: reducedMins });
    if (userId) {
      appendLedgerEntry(userId, {
        delta: -reducedMins,
        reason: "self_reduce",
        balanceAfter: nextCredits.balance,
      }).catch(() => {});
    }
  };

  const handleQuickGrant = async () => {
    const key = `drift_quick_grants_${todayKey()}`;
    const latest = Number((await AsyncStorage.getItem(key).catch(() => "0")) || 0);
    if (latest >= 3) {
      setQuickGrantCount(3);
      setShowQuickGrant(false);
      return;
    }
    const newCount = latest + 1;
    await AsyncStorage.setItem(key, String(newCount)).catch(() => {});
    setQuickGrantCount(newCount);
    setShowQuickGrant(false);

    const addedMins = 15;
    const newSec = secRef.current + addedMins * 60;
    const nextCredits = {
      ...credits,
      balance: Math.ceil(newSec / 60),
      balanceSec: newSec,
      earned: credits.earned + addedMins,
    };
    applyBalanceSeconds(newSec, nextCredits, { credits: addedMins, xp: 0 });
    if (userId) {
      appendLedgerEntry(userId, {
        delta: addedMins,
        reason: "daily_grant",
        balanceAfter: nextCredits.balance,
      }).catch(() => {});
    }
  };

  const openCheckout = async () => {
    const url = await createCheckoutSession();
    if (!url) throw new Error("No checkout URL");
    setCheckoutUrl(url);
    setShowPaywall(false);
    setShowCheckout(true);
  };

  const handleCheckoutSuccess = async (sessionId) => {
    setShowCheckout(false);
    setCheckoutUrl("");
    try {
      if (sessionId) {
        const confirmed = await confirmCheckoutSession(sessionId);
        if (confirmed?.active) setIsPremium(true);
      }
      await refreshSub?.();
      if (userId) {
        const { isPremium: prem, daysLeft } = await getTrialStatus(userId, { force: true });
        setIsPremium(prem);
        setTrialDays(daysLeft);
      }
    } catch (e) {
      Alert.alert(
        "Payment pending",
        "Stripe received the checkout return, but Drift could not verify the subscription yet. If payment succeeded, access should unlock when Stripe's webhook arrives."
      );
    }
  };

  const signOut = async () => {
    setShowAccount(false);
    try { await supabase.auth.signOut(); } catch {}
    try { await stopBalanceMonitoring(); } catch {}
    try { await clearBlocking(); } catch {}
    stopTick();
    setUserId(null);
    setUserEmail("");
    setUserName("");
    // Clear ALL user-scoped local state so the next account on this device
    // starts with a clean slate (no preview-toggle bleed, no stale balance, etc.).
    await AsyncStorage.multiRemove([
      "drift_username",
      "drift_v4",
      "drift_beta_preview_as_free",
      "drift_blocked_apps",
      "drift_last_armed_balance",
      "drift_last_alive",
    ]).catch(() => {});
    launchDrainRanRef.current = false;
    setTasks([]);
    setTaskHistory([]);
    setCredits({ balance: 0, earned: 0, spent: 0 });
    setTotalXp(0);
    setBlockedHours([]);
    setBlockedHoursActive(false);
    setRecurringTasks([]);
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
        if (user?.id) {
          try {
            const { data: prof } = await cached(`drift_profile_${user.id}`, 30_000, () =>
              supabase
                .from("profiles").select("username").eq("id", user.id).maybeSingle()
            );
            if (prof?.username) {
              setUserName(prof.username);
              AsyncStorage.setItem("drift_username", prof.username);
            }
          } catch {}
        }
        setOnboarding(false);
        const hadOnboarded = await AsyncStorage.getItem("drift_onboarded");
        await AsyncStorage.setItem("drift_onboarded", "1");
        await initTrial();
        try {
          await rateLimited("claim_trial", { limit: 3, windowMs: 10 * 60_000 }, () =>
            supabase.functions.invoke("claim-trial", {})
          );
        } catch {}
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
  const statsTasks = mergeCompletedTasks(taskHistory, tasks.filter(t => t.done));
  const displaySecLeft = blockedHoursActive ? 0 : secLeft;
  const displayCredits = blockedHoursActive ? { ...credits, balance: 0, balanceSec: 0 } : credits;

  return (
    <ThemeContext.Provider value={{ dark: darkMode, theme: activeTheme }}>
    <SafeAreaView style={{ flex: 1, backgroundColor: driftInActive ? th_ink.void : th_paper.card }}>
      <StatusBar barStyle={driftInActive || darkMode ? "light-content" : "dark-content"} />

      {/* XP / credit popup */}
      <FloatingFeedback popup={popup} />

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
            backgroundColor: blockedHoursActive ? "rgba(224,80,80,0.12)" : displaySecLeft < 0 ? "rgba(224,80,80,0.12)" : displaySecLeft > 0 ? (displaySecLeft < 120 ? "#FDECEA" : th_earn.greenLo) : th_paper.warm,
            borderRadius: 20, paddingVertical: 4, paddingHorizontal: 12, marginRight: 8,
          }}>
            <Text style={{
              fontFamily: FO, fontSize: 10, letterSpacing: 1,
              color: blockedHoursActive ? "#C0392B" : displaySecLeft < 0 ? "#C0392B" : displaySecLeft > 0 ? (displaySecLeft < 120 ? "#C0392B" : th_earn.greenD) : th_ink.faint,
            }}>
              {blockedHoursActive ? "blocked" : displaySecLeft !== 0 ? fmtSecLeft(displaySecLeft) : "no time"}
            </Text>
          </View>
          {/* Account button */}
          <TouchableOpacity
            onPress={() => setShowAccount(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{ marginRight: 6, width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22 }}
            activeOpacity={0.7}
          >
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
              <SvgCircle cx="12" cy="8" r="4" stroke={th_earn.green} strokeWidth={2} />
              <Path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"
                stroke={th_earn.green} strokeWidth={2} strokeLinecap="round" />
            </Svg>
          </TouchableOpacity>
          {/* Dark/light toggle — green-toned SVG icons */}
          <TouchableOpacity
            onPress={toggleDark}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{ marginRight: 4, width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22 }}
            activeOpacity={0.7}
          >
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
          <TodayView
            tasks={tasks}
            credits={displayCredits}
            totalXp={totalXp}
            onComplete={completeTask}
            onDelete={deleteTask}
            onAdd={() => setOverlay("add")}
            onReduceScreenTime={() => setShowReduceTime(true)}
            onQuickGrant={() => setShowQuickGrant(true)}
            quickGrantCount={quickGrantCount}
            dark={darkMode}
          />
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
          <ProgressView tasks={statsTasks} totalXp={totalXp} skips={0} onAddTask={() => setOverlay("add")} dark={darkMode} />
        </View>
        <View style={{ flex: 1, display: tab === "friends" && !driftInActive ? "flex" : "none" }}>
          <SocialScreen
            userId={userId}
            isPremium={isPremium}
            onOpenPaywall={() => setShowPaywall(true)}
            onSwipeLockChange={setChildSwipeLocked}
            onChallengeResolved={handleChallengeResolved}
            dark={darkMode}
          />
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
              isSubActive={proAccess}
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
                await openCheckout();
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

      {/* Profile page */}
      <Modal visible={showAccount} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setShowAccount(false)}>
        <ProfileScreen
          userId={userId}
          userEmail={userEmail}
          username={myUsername}
          subActive={proAccess}
          trialDays={trialDays}
          screenTimeStatus={screenTimeStatus}
          dark={darkMode}
          beta={beta}
          onClose={() => setShowAccount(false)}
          onProfileChange={(profile) => {
            if (profile?.username) {
              setUserName(profile.username);
              AsyncStorage.setItem("drift_username", profile.username);
            }
          }}
          onOpenBlockedApps={() => { setShowAccount(false); setFirstTimeBlockedApps(false); setShowBlockedApps(true); }}
          onOpenBlockedHours={() => {
            setShowAccount(false);
            if (!proAccess) setShowPaywall(true);
            else setShowBlockedHours(true);
          }}
          onOpenRecurringTasks={() => {
            setShowAccount(false);
            if (!proAccess) setShowPaywall(true);
            else setShowRecurringTasks(true);
          }}
          onRequestScreenTime={async () => {
            const next = await requestScreenTimeAuth();
            setScreenTimeStatus(next);
            if (next !== "approved") {
              Alert.alert("Screen Time", `Status: ${next}. Open Settings -> Screen Time to grant access.`);
            }
          }}
          onUpgrade={async () => {
            setShowAccount(false);
            try {
              await openCheckout();
            } catch (e) {
              const raw = (e?.message || "").toLowerCase();
              const friendly = raw.includes("edge function") || raw.includes("send a request")
                ? "Payments aren't set up yet. Please try again later."
                : (e?.message || "Try again.");
              Alert.alert("Checkout unavailable", friendly);
            }
          }}
          onSignOut={signOut}
        />
      </Modal>
      {/* Blocked apps modal (onboarding + ongoing management) */}
      <BlockedAppsModal
        visible={showBlockedApps}
        firstTime={firstTimeBlockedApps}
        dark={darkMode}
        onClose={() => { setShowBlockedApps(false); setFirstTimeBlockedApps(false); }}
      />
      <BlockedHoursModal
        visible={showBlockedHours}
        rules={blockedHours}
        dark={darkMode}
        onClose={() => setShowBlockedHours(false)}
        onSave={(rules) => {
          setBlockedHours(rules);
          if (userId) AsyncStorage.setItem(`drift_blocked_hours_${userId}`, JSON.stringify(rules)).catch(() => {});
        }}
      />
      <RecurringTasksModal
        visible={showRecurringTasks}
        templates={recurringTasks}
        dark={darkMode}
        onClose={() => setShowRecurringTasks(false)}
        onSave={(templates) => {
          setRecurringTasks(templates);
          if (userId) AsyncStorage.setItem(`drift_recurring_tasks_${userId}`, JSON.stringify(templates)).catch(() => {});
        }}
      />
      {/* First-time username setup for OAuth users */}
      <UsernameSetupModal
        visible={showUsernameSetup}
        userId={userId}
        dark={darkMode}
        onDone={(u) => {
          setUserName(u);
          AsyncStorage.setItem("drift_username", u);
          setShowUsernameSetup(false);
        }}
      />
      <ReduceScreenTimeModal
        visible={showReduceTime}
        balanceSec={Math.max(0, secRef.current)}
        dark={darkMode}
        onClose={() => setShowReduceTime(false)}
        onReduce={handleReduceScreenTime}
      />
      <QuickGrantModal
        visible={showQuickGrant}
        usedToday={quickGrantCount}
        dark={darkMode}
        onClose={() => setShowQuickGrant(false)}
        onGrant={handleQuickGrant}
      />
      <StripeCheckoutModal
        visible={showCheckout}
        checkoutUrl={checkoutUrl}
        onClose={() => { setShowCheckout(false); setCheckoutUrl(""); }}
        onCancel={() => { setShowCheckout(false); setCheckoutUrl(""); }}
        onSuccess={handleCheckoutSuccess}
      />
    </SafeAreaView>
    </ThemeContext.Provider>
  );
}
