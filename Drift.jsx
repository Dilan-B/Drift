import React, { useState, useEffect, useRef, useCallback, useContext, createContext, useMemo } from "react";
import {
  View, Text, TouchableOpacity, TextInput, ScrollView,
  StyleSheet, KeyboardAvoidingView,
  StatusBar, Platform, Alert, AppState, Modal, PanResponder, Animated, Easing,
  ActivityIndicator, Linking, Dimensions, Pressable,
} from "react-native";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { getTheme } from "./theme";
import AICheckModal from "./AICheckModal";
import { evaluateTask } from "./aiEvaluate";
import BlockedAppsModal from "./BlockedAppsModal";
import UsernameSetupModal from "./UsernameSetupModal";
import Swipeable from "./Swipeable";
import {
  fetchTasks, insertTask, updateTaskCredits, completeTaskRow, softDeleteTask,
  appendLedgerEntry, syncProfileStats, fetchProfileStats, flushPendingStats,
  clearPendingBalance, cache,
} from "./sync";
import { registerBackgroundRefresh } from "./backgroundRefresh";
import { requestNotificationPermission, notifyOutOfTime, notifyLowTime, resetTimeNotices, scheduleDailyReminder, cancelAllNotifications } from "./notifications";
import { applyBlocking, clearBlocking } from "./blockedApps";
// Importing places.js at module scope registers the geofence background task,
// which iOS may wake the app directly into on a cold start.
import { syncGeofences, isSuggestionsEnabled } from "./places";
import { fetchTodayEvents, markImported, isCalendarSyncEnabled, isCalendarAutoImportEnabled } from "./calendarSync";
import SuggestedTaskModal from "./SuggestedTaskModal";
import AutoTasksModal from "./AutoTasksModal";
import { Spinner } from "./Skeleton";
import Slider from "@react-native-community/slider";
import { selectionTick } from "./haptics";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useFonts } from "expo-font";
import {
  Orbitron_400Regular,
  Orbitron_700Bold,
} from "@expo-google-fonts/orbitron";
import {
  Oswald_400Regular,
  Oswald_700Bold,
} from "@expo-google-fonts/oswald";
import {
  PlayfairDisplay_400Regular,
  PlayfairDisplay_500Medium,
  PlayfairDisplay_700Bold,
  PlayfairDisplay_700Bold_Italic,
} from "@expo-google-fonts/playfair-display";
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_700Bold,
} from "@expo-google-fonts/dm-sans";
import Sprout, { LeafGlyph, Sprig, SeedDots } from "./SproutArt";
import { FF } from "./theme";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Svg, { Path, Circle as SvgCircle, Rect } from "react-native-svg";
import {
  CategoryIcon, LevelIcon, LockIcon, UnlockIcon, SparkleIcon, CheckIcon,
  ShieldKeyIcon, ClipboardIcon, ChartIcon, PhoneIcon,
} from "./Icons";
import {
  requestScreenTimeAuth, getScreenTimeAuthStatus, isNativeBlockingAvailable,
  openNativeAppPicker,
} from "./blockedApps";
import {
  startBalanceMonitoring, stopBalanceMonitoring, consumeDepletedFlag, consumeUsedSeconds,
  getDiagnostics, updateSharedBalance, startDriftInLiveActivity, updateDriftInLiveActivity,
  endDriftInLiveActivity, consumePendingHealthEarn, setProStatus, setAppearance,
} from "./screenTime";
import { supabase, syncScreenTime, safeGetSession, saveOnboardingResponses, getAppConfig, isVersionOutdated, fetchAppStoreLatest } from "./supabase";
import ForceUpdateModal from "./ForceUpdateModal";
import { handleSupabaseAuthCallback } from "./authLinks";
import SocialScreen from "./SocialScreen";
import LabScreen from "./LabScreen";
import OnboardingScreen from "./OnboardingScreen";
import DriftInScreen from "./DriftInScreen";
import ProfileScreen from "./ProfileScreen";
import ReviewPromptScreen from "./ReviewPromptScreen";
import TutorialOverlay from "./TutorialOverlay";
// PaywallScreen + useSubscription removed — app is fully free for now
// import PaywallScreen from "./PaywallScreen";
// import { useSubscription } from "./useSubscription";
import ParentShell from "./ParentShell";
import ChildShell from "./ChildShell";
import { cached, rateLimited } from "./apiGuards";
import {
  TouchTracker, OriginPanel, OriginSheet, Backdrop, Pop, FadeInUp, Pulse, useCountUp, getLastTouch,
} from "./Anim";

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
// Legacy aliases, remapped onto the organic-editorial system (theme.js FF).
// Older corners of this file still reference these names; pointing them at the
// current typefaces migrates every remaining usage without touching each line.
const FO  = FF.bodyBold;  // was Orbitron bold — stat values, popup numbers
const FOM = FF.kicker;    // small letterspaced labels (Orbitron stays the kicker voice)
const FK  = FF.bodyMed;   // was Oswald bold — subheadings, row titles
const FKR = FF.body;      // was Oswald regular
const FB  = FF.body;      // body text joins the brand sans instead of system default

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
  { name: "Seedling",   min: 0     },
  { name: "Sprout",     min: 150   },
  { name: "Sapling",    min: 400   },
  { name: "Grove",      min: 900   },
  { name: "Canopy",     min: 2000  },
  { name: "Forest",     min: 4000  },
  { name: "Old Growth", min: 8000  },
  { name: "Redwood",    min: 15000 },
  { name: "Ancient",    min: 25000 },
  { name: "Eternal",    min: 50000 },
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
// Use LOCAL date, not UTC. Using ISO/UTC caused tasks to disappear mid-day
// for users in non-UTC timezones (the "day" would flip while they were still
// awake, triggering the reset branch on next launch).
const dayKeyOfDate = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const todayKey    = () => dayKeyOfDate(new Date());

// ── Weekly insights helpers (derived client-side from completed tasks) ──
// A completed task's day = its task_date (YYYY-MM-DD) or the local date of
// completedAt. We only have reliable history for EARNED time (completed tasks);
// per-day "spent" (blocked-app usage) isn't recorded anywhere, so insights
// focus on earned/day, by-category, and streak.
const taskDayKey = (t) => {
  if (t.task_date) return String(t.task_date).slice(0, 10);
  const ms = t.completedAt
    ? (typeof t.completedAt === "number" ? t.completedAt : Date.parse(t.completedAt))
    : null;
  return ms ? dayKeyOfDate(new Date(ms)) : null;
};
const last7DayKeys = () => {
  const out = [];
  const base = new Date();
  for (let i = 6; i >= 0; i--) {
    const x = new Date(base);
    x.setDate(base.getDate() - i);
    out.push(dayKeyOfDate(x));
  }
  return out;
};
const computeWeekly = (completed) => {
  const keys = last7DayKeys();
  const inWeek = new Set(keys);
  const perDay = Object.fromEntries(keys.map(k => [k, 0]));
  const byCat = {};
  let total = 0;
  for (const t of (completed || [])) {
    const k = taskDayKey(t);
    if (!k || !inWeek.has(k)) continue;
    const mins = t.credits || 0;
    perDay[k] += mins;
    byCat[t.cat] = (byCat[t.cat] || 0) + mins;
    total += mins;
  }
  return { keys, perDay: keys.map(k => perDay[k]), byCat, total };
};
const computeStreak = (completed) => {
  const days = new Set((completed || []).map(taskDayKey).filter(Boolean));
  let streak = 0;
  const cursor = new Date();
  // If nothing completed today yet, the streak can still stand from yesterday.
  if (!days.has(dayKeyOfDate(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dayKeyOfDate(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
};
const makeUuid = () => {
  if (typeof Crypto.randomUUID === "function") return Crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16);
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};
const clockStr    = () => new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
const pad2         = n => String(n).padStart(2, "0");
const timeToMins   = t => {
  const raw = String(t || "").trim();
  const m12 = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m?\.?$/i);
  if (m12) {
    let h = Number(m12[1]);
    const min = Number(m12[2] || 0);
    if (h < 1 || h > 12 || min < 0 || min > 59) return null;
    const pm = m12[3].toLowerCase() === "p";
    if (h === 12) h = 0;
    return (pm ? h + 12 : h) * 60 + min;
  }
  const m24 = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m24) return null;
  const h = Number(m24[1]), min = Number(m24[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
};
const minsToTime   = mins => {
  const n = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(n / 60);
  const min = n % 60;
  return `${h % 12 || 12}:${pad2(min)} ${h >= 12 ? "PM" : "AM"}`;
};
const prettyTime   = t => {
  const mins = timeToMins(t);
  if (mins == null) return t || "";
  return minsToTime(mins);
};
const minsToDate = mins => {
  const n = ((mins % 1440) + 1440) % 1440;
  const d = new Date();
  d.setHours(Math.floor(n / 60), n % 60, 0, 0);
  return d;
};
const dateToMins = d => d.getHours() * 60 + d.getMinutes();

function TimePickerButton({ value, onChange, fallback = "9:00 AM", dark = false, theme, style, textStyle }) {
  const th = theme || getTheme(dark);
  const { ink, paper, earn } = th;
  const currentMins = timeToMins(value) ?? timeToMins(fallback) ?? 540;
  const [iosOpen, setIosOpen] = useState(false);
  const [draftDate, setDraftDate] = useState(() => minsToDate(currentMins));

  const openPicker = () => {
    const pickerDate = minsToDate(currentMins);
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: pickerDate,
        mode: "time",
        is24Hour: false,
        onChange: (event, selectedDate) => {
          if (event.type === "set" && selectedDate) onChange?.(minsToTime(dateToMins(selectedDate)));
        },
      });
      return;
    }
    setDraftDate(pickerDate);
    setIosOpen(true);
  };

  const confirmIos = () => {
    onChange?.(minsToTime(dateToMins(draftDate)));
    setIosOpen(false);
  };

  return (
    <>
      <TouchableOpacity
        onPress={openPicker}
        activeOpacity={0.85}
        style={[{
          minWidth: 104,
          paddingVertical: 8,
          paddingHorizontal: 10,
          borderRadius: 10,
          backgroundColor: paper.warm,
          borderWidth: 1,
          borderColor: ink.border,
          alignItems: "center",
          justifyContent: "center",
        }, style]}
      >
        <Text style={[{
          color: ink.deep,
          fontFamily: FO,
          fontSize: 12,
          textAlign: "center",
        }, textStyle]}>
          {prettyTime(value || fallback)}
        </Text>
      </TouchableOpacity>
      {Platform.OS === "ios" && (
        <Modal visible={iosOpen} transparent animationType="fade" onRequestClose={() => setIosOpen(false)}>
          <Pressable
            onPress={() => setIosOpen(false)}
            style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.42)", justifyContent: "flex-end" }}
          >
            <Pressable
              onPress={(e) => e.stopPropagation?.()}
              style={{
                backgroundColor: paper.card,
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                paddingTop: 16,
                paddingHorizontal: 18,
                paddingBottom: 32,
                borderWidth: 1,
                borderColor: ink.border,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <TouchableOpacity onPress={() => setIosOpen(false)} style={{ paddingVertical: 10, paddingHorizontal: 4 }}>
                  <Text style={{ fontFamily: FB, fontSize: 15, color: ink.mid }}>Cancel</Text>
                </TouchableOpacity>
                <Text style={{ fontFamily: FK, fontSize: 18, color: ink.deep }}>Choose time</Text>
                <TouchableOpacity onPress={confirmIos} style={{ paddingVertical: 10, paddingHorizontal: 4 }}>
                  <Text style={{ fontFamily: FK, fontSize: 15, color: earn.green }}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={draftDate}
                mode="time"
                display="spinner"
                is24Hour={false}
                textColor={ink.deep}
                themeVariant={dark ? "dark" : "light"}
                onChange={(_, selectedDate) => {
                  if (selectedDate) setDraftDate(selectedDate);
                }}
                style={{ alignSelf: "stretch" }}
              />
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </>
  );
}
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
  // Negative balance is intentionally never shown — there is no "debt" model.
  if (s < 0) s = 0;
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
const isTodayTask = (task, day = todayKey()) => {
  const taskDay = task?.task_date || task?.createdAt?.slice?.(0, 10);
  return taskDay ? taskDay === day : true;
};
const mergeTaskRecords = (...groups) => {
  const byId = new Map();
  groups.flat().filter(Boolean).forEach(task => {
    const key = String(task.id || `${task.title}-${task.createdAt || task.task_date || ""}`);
    byId.set(key, { ...(byId.get(key) || {}), ...task });
  });
  return [...byId.values()];
};
const cacheFullTasks = async (uid, nextVisibleTasks, knownTasks = []) => {
  if (!uid) return;
  const existing = knownTasks.length ? knownTasks : await cache.loadTasks(uid).catch(() => []);
  return cache.saveTasks(uid, mergeTaskRecords(existing, nextVisibleTasks));
};

// Fields a server fetch (rowToTask) may return undefined, which must not clobber
// a value the local cache still holds. `scheduledTime` has no column at all.
// `recurringTemplateId` gained one in schema_v5 and now comes back from the
// server — but rows created before that migration have it NULL, so the cache
// still backfills those. Once no pre-v5 rows remain in any live task window,
// recurringTemplateId can drop off this list.
const CLIENT_ONLY_TASK_FIELDS = ["recurringTemplateId", "scheduledTime"];
const rehydrateClientFields = (remoteTasks, cachedTasks) => {
  const cachedById = new Map((cachedTasks || []).map(t => [t.id, t]));
  return (remoteTasks || []).map(t => {
    const c = cachedById.get(t.id);
    if (!c) return t;
    const merged = { ...t };
    for (const f of CLIENT_ONLY_TASK_FIELDS) {
      if (merged[f] == null && c[f] != null) merged[f] = c[f];
    }
    return merged;
  });
};

// Collapse accidental duplicate instances of the same task on the same day.
// An older dedup bug let a recurring template materialize several times (the
// template link was stripped by the server round-trip, so the guard missed
// it), leaving the user with the same task repeated in one day's list. Keep the
// earliest pending instance per signature; return the extra ids so callers can
// tombstone them. Completed tasks are never collapsed — they're history.
// Content identity for a task on a given day. Deliberately excludes the
// template link: that field is client-only (the server has no column for it),
// so it survives a round-trip only if the local cache still holds the row.
// Anything that must be reliable across a cold boot keys off this instead.
const taskSignature = (t, day) =>
  `${t.title}|${t.cat}|${t.minutes}|${day ?? (t.task_date || "")}`;

const collapseDuplicateTasks = (list) => {
  const seen = new Set();
  const kept = [];
  const removedIds = [];
  for (const t of (list || [])) {
    if (t.done) { kept.push(t); continue; }
    // Two identical pending tasks on the same day collapse to one.
    const sig = taskSignature(t);
    if (seen.has(sig)) { removedIds.push(t.id); continue; }
    seen.add(sig);
    kept.push(t);
  }
  return { kept, removedIds };
};

// ── Deleted-task tombstone ───────────────────────────────────
// The task cache (cacheFullTasks) is append-only and the boot loader merges any
// cached task missing from the server back into the visible list. After a
// soft-delete the row is gone from the server but can linger in the cache, so it
// reappears on reopen. A persisted set of deleted ids, filtered at boot,
// guarantees a deleted task stays gone regardless of cache/server lag.
const deletedIdsKey = (uid) => `drift_deleted_ids_${uid}`;
const loadDeletedIds = async (uid) => {
  if (!uid) return new Set();
  try { return new Set(JSON.parse((await AsyncStorage.getItem(deletedIdsKey(uid))) || "[]")); }
  catch { return new Set(); }
};
const addDeletedId = async (uid, id) => {
  if (!uid || !id) return;
  try {
    const ids = await loadDeletedIds(uid);
    ids.add(id);
    await AsyncStorage.setItem(deletedIdsKey(uid), JSON.stringify([...ids].slice(-500)));
  } catch {}
};
const removeDeletedId = async (uid, id) => {
  if (!uid || !id) return;
  try {
    const ids = await loadDeletedIds(uid);
    if (ids.delete(id)) await AsyncStorage.setItem(deletedIdsKey(uid), JSON.stringify([...ids]));
  } catch {}
};

const storage = {
  get: async (key) => ({ value: await AsyncStorage.getItem(key) }),
  set: async (key, value) => { await AsyncStorage.setItem(key, value); },
};

// ── Credit Ticker ────────────────────────────────────────────
function CreditTicker({ value, seconds, textColor }) {
  const color = textColor || "#1A2820";
  const totalSec = Math.max(0, seconds != null ? seconds : (value || 0) * 60);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  const primary = hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", flexWrap: "nowrap" }}>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.78}
        style={{
          fontFamily: FF.serif,
          fontSize: hrs > 0 ? 52 : 64,
          lineHeight: 76,
          color,
          letterSpacing: -2.4,
        }}
      >
        {primary}
      </Text>
    </View>
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
const MAX_REWARD_RATIO = 0.5;
const MIN_REWARD_RATIO = 0.25;
// Absolute ceiling on what any single task can pay out, in minutes of screen
// time. The ratio-based cap already keeps short tasks in check; this bounds the
// long tail (a 3h+ task tops out here rather than scaling forever).
const MAX_REWARD_MINUTES = 60;
// const FREE_TASK_LIMIT = 5; // removed — no free tier limits for now
// iOS Screen Time re-applies a shield on a ~15-minute granularity, so any grant
// smaller than that doesn't actually block on time — the old per-difficulty
// values (1/3/7 min) all behaved like 15 in practice. One honest constant
// instead of a choice the OS ignores.
const GRANT_MINS = 15;

const BLOCKED_TASK_RE = /\b(goon|gooning|fap|fapping|jerk\s*off|jack\s*off|wank|masturbat|porn|hentai|onlyfans|xvideo|xhamster|nhentai|rule\s*34|edg(e|ing)\b(?!.*code)|69|blow\s*job|hand\s*job|sex(?!t)|nud[ei]|xxx|orgasm|boner|erection|cum\b|suck\s*(my|a|it)|eat\s*ass|anal\b|dildo|vibrator|fleshlight)\b/i;
const VAGUE_TASK_RE = /^(stuff|things?|work|task|do it|idk|whatever|something|nothing|asdf|aaa+|test|hi|hey|lol|bruh|hmm+|ok|yes|no|nah|yep|pls|help|bro|dude|chill|vibe|vibes|blah|meh|ugh|haha|lmao|yolo|swag|based|slay|cap|bet|fr|ngl|tbh|ong|fam|sus|ratio|w|l|x+|z+|\.+|!+|\?+|a{2,}|ha+)$/i;
const MIN_TASK_TITLE_LEN = 4;
const MIN_TASK_TITLE_WORDS = 2;

function capReward(credits, mins) {
  const floor = Math.max(1, Math.ceil(mins * MIN_REWARD_RATIO));
  const cap = Math.max(1, Math.floor(mins * MAX_REWARD_RATIO));
  // MAX_REWARD_MINUTES is applied last so it also clamps the floor — a 4h task
  // must not earn 60min via the floor after the ratio cap was already applied.
  return Math.min(MAX_REWARD_MINUTES, Math.max(floor, Math.min(credits, cap)));
}

function freeTierCredits(mins) {
  const raw = Math.max(1, Math.round(mins * FREE_TIER_MULTIPLIER));
  const credits = capReward(raw, mins);
  const xp      = Math.max(5, Math.round(credits * 0.6 + 8));
  return {
    credits,
    xp,
    reasoning: "Credits based on task duration.",
  };
}

// ── Add Task Overlay ─────────────────────────────────────────
const REPEAT_OPTIONS = [
  ["none", "Just once"],
  ["daily", "Every day"],
  ["weekdays", "Weekdays"],
  ["weekends", "Weekends"],
  ["custom", "Custom days"],
];
const REPEAT_LABELS = Object.fromEntries(REPEAT_OPTIONS);
// Must be multiples of the slider's 15m step so tapping one lands exactly on
// a slider position rather than a value the thumb can't represent.
const QUICK_LENGTHS = [15, 30, 60, 120];

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

  // Step-crossing feedback — mirrors the Drift In slider. See that copy for
  // why the tick is gated on an actual value change.
  const lastValRef = useRef(value);
  const pulse = useRef(new Animated.Value(0)).current;

  const handleChange = (v) => {
    if (v !== lastValRef.current) {
      lastValRef.current = v;
      selectionTick();
      pulse.setValue(1);
      Animated.timing(pulse, { toValue: 0, duration: 180, useNativeDriver: false }).start();
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
        <Text style={{ fontFamily: FB, fontSize: 10, color: textColor }}>{leftLabel}</Text>
        <Text style={{ fontFamily: FB, fontSize: 10, color: textColor }}>{rightLabel}</Text>
      </View>
    </View>
  );
}

function AddTaskOverlay({ onSave, onClose, userId, isSubActive = true, onOpenPaywall, onOpenAutoTasks }) {
  const { dark, theme } = useTheme();
  const { ink, paper, earn } = theme;

  const [title,    setTitle]    = useState("");
  // Provisional only — the AI evaluator classifies the real category
  // server-side and patches it in (see finalizeTaskCredits).
  const [cat]                   = useState("life");
  const [showAiInfo, setShowAiInfo] = useState(false);
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [mins,     setMins]     = useState(30);
  const [aiCheck,  setAiCheck]  = useState(true); // AI Check is mandatory for Pro users
  const [evaluating, setEvaluating] = useState(false);
  const [evalError,  setEvalError]  = useState("");
  const [saved,      setSaved]      = useState(false);
  const [recur,    setRecur]    = useState("none");
  const [recurDays, setRecurDays] = useState([new Date().getDay()]);
  const [recurTime, setRecurTime] = useState(() => {
    const d = new Date();
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
    return minsToTime(d.getHours() * 60 + d.getMinutes());
  });

  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(entrance, {
      toValue: 1,
      useNativeDriver: true,
      damping: 18,
      stiffness: 180,
      mass: 0.8,
    }).start();
  }, [entrance]);

  const closeWithAnimation = useCallback((success = false) => {
    if (success) setSaved(true);
    const delay = success ? 360 : 0;
    setTimeout(() => {
      Animated.timing(entrance, {
        toValue: 0,
        duration: success ? 260 : 210,
        useNativeDriver: true,
      }).start(() => onClose?.());
    }, delay);
  }, [entrance, onClose]);

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
          Animated.timing(slideX, { toValue: 400, duration: 180, useNativeDriver: true }).start(() => closeWithAnimation(false));
        } else {
          Animated.spring(slideX, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  // Duration auto-guess from the title. The CATEGORY guess that used to live
  // here is gone: the AI evaluator classifies it server-side (same round trip
  // that values the task), so there's nothing for the user to pick and no
  // frontend heuristic to disagree with the server.
  useEffect(() => {
    if (title.length < 4) return;
    const lo = title.toLowerCase();
    const minM = title.match(/(\d+)\s*(?:min|m\b)/i);
    const hrM  = title.match(/(\d+)\s*(?:hr|h\b)/i);
    if (minM) setMins(parseInt(minM[1]));
    else if (hrM) setMins(parseInt(hrM[1]) * 60);
    else if (/make.*bed|brush.*teeth|floss|take.*vitamin|drink.*water|unload.*dishwasher|take.*trash|wipe.*counter/i.test(lo)) setMins(2);
    else if (/stretch|meditate|journal|tidy|pick.*up|fold.*laundry|shower|get.*dressed|pack.*lunch|empty.*trash/i.test(lo)) setMins(5);
    else if (/clean|dishes|vacuum|laundry|walk.*dog|cook|meal.*prep/i.test(lo)) setMins(15);
    else if (/read|study|practice|homework|review/i.test(lo)) setMins(20);
    else if (/gym|run|workout|swim|yoga|hike|work|meeting|code/i.test(lo)) setMins(30);
    else if (/no.*phone|deep.*clean|meal.*plan/i.test(lo)) setMins(60);
  }, [title]);

  const save = async () => {
    if (!title.trim() || evaluating) return;
    const trimmed = title.trim();
    if (BLOCKED_TASK_RE.test(trimmed)) {
      setEvalError("That task isn't allowed. Try something productive!");
      return;
    }
    if (trimmed.length < MIN_TASK_TITLE_LEN || trimmed.split(/\s+/).length < MIN_TASK_TITLE_WORDS || VAGUE_TASK_RE.test(trimmed)) {
      setEvalError("Be specific! Describe what you'll actually do (e.g. \"Read 20 pages\" not \"stuff\").");
      return;
    }
    setEvaluating(true);
    setEvalError("");

    const buildTask = ({ credits, xp, reasoning, aiValued, aiPending }) => ({
      id: makeUuid(),
      title:   title.trim(),
      cat,
      minutes: mins,
      done:    false,
      credits,
      xp,
      aiCheck:  isSubActive, // AI Check is mandatory for Pro users (off for free)
      aiValued: !!aiValued,
      aiPending: !!aiPending, // credits are provisional until the bg evaluator finishes
      aiReasoning: reasoning || "",
      task_date: todayKey(),
    });
    const recurrence = recur !== "none" && isSubActive
      ? { frequency: recur, time: recurTime, days: recur === "custom" ? recurDays : recurrenceDaysFor(recur) }
      : null;

    // Free user → flat duration-based credits, no AI eval call.
    // (Free tier doesn't get any AI grading — credits are purely mins × multiplier.)
    if (!isSubActive) {
      const { credits, xp, reasoning } = freeTierCredits(mins);
      onSave(buildTask({ credits, xp, reasoning, aiValued: false }), recurrence);
      closeWithAnimation(true);
      return;
    }

    // Subscribed → don't block the UI on the AI eval. Add the task instantly with
    // provisional credits and an aiPending flag; the parent runs the evaluator in
    // the background and patches the real value in when it finishes.
    const provisional = freeTierCredits(mins);
    onSave(
      buildTask({ credits: provisional.credits, xp: provisional.xp, reasoning: "", aiValued: true, aiPending: true }),
      recurrence,
    );
    closeWithAnimation(true);
  };

  const safeTop = Platform.OS === "ios" ? 62 : (StatusBar.currentHeight || 24) + 12;
  const enterY = entrance.interpolate({ inputRange: [0, 1], outputRange: [28, 0] });
  const enterScale = entrance.interpolate({ inputRange: [0, 1], outputRange: [0.985, 1] });
  const ready = !!title.trim();
  const durLabel = mins >= 60 ? `${Math.floor(mins/60)}h ${mins%60 ? `${mins%60}m` : ""}`.trim() : `${mins}m`;
  // Same duration-based formula the task is created with, so the preview
  // matches what actually lands before AI re-values it.
  const earnPreview = freeTierCredits(mins);
  const fieldKicker = { fontFamily: FF.kicker, fontSize: 9, color: ink.faint, letterSpacing: 2.4, marginBottom: 10 };
  const cardDivider = { height: 1, backgroundColor: ink.hairline, marginVertical: 20 };

  return (
    <Animated.View style={{
      flex: 1,
      opacity: entrance,
      transform: [{ translateX: slideX }, { translateY: enterY }, { scale: enterScale }],
    }}
      {...swipeRef.panHandlers}>
      <View style={{ flex: 1, backgroundColor: paper.warm }}>
        {/* Aurora pools — the same quiet light as the Drift In door */}
        <View pointerEvents="none" style={{
          position: "absolute", top: -120, right: -90,
          width: 300, height: 300, borderRadius: 150,
          backgroundColor: theme.fx.auroraMint,
        }} />
        <View pointerEvents="none" style={{
          position: "absolute", bottom: -130, left: -100,
          width: 280, height: 280, borderRadius: 140,
          backgroundColor: theme.fx.auroraClay,
        }} />

        {/* Saved confirmation — floats over everything during the close beat */}
        {saved && (
          <View pointerEvents="none" style={{
            position: "absolute", top: safeTop, left: 22, right: 22, zIndex: 10,
            padding: 14, borderRadius: 16,
            backgroundColor: earn.terraLo,
            borderWidth: 1, borderColor: "rgba(47,171,114,0.28)",
            alignItems: "center",
          }}>
            <Text style={{ fontFamily: FF.bodyMed, fontSize: 14, color: earn.greenD }}>
              Task added
            </Text>
          </View>
        )}

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          {/* Header — editorial */}
          <View style={{
            flexDirection: "row", alignItems: "flex-start",
            paddingTop: safeTop, paddingHorizontal: 22, marginBottom: 18,
          }}>
            <View style={{ flex: 1 }}>
              <Text style={{
                fontFamily: FF.kicker, fontSize: 10, letterSpacing: 2.4,
                color: ink.faint, marginBottom: 6,
              }}>
                {isSubActive ? "NEW TASK · AI VALUED" : "NEW TASK"}
              </Text>
              <Text style={{ fontFamily: FF.display, fontSize: 36, color: ink.deep, letterSpacing: -0.4 }}>
                Add a task
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => closeWithAnimation(false)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={{
                width: 36, height: 36, borderRadius: 18, marginTop: 6,
                alignItems: "center", justifyContent: "center",
                backgroundColor: ink.ghost,
              }}
            >
              <Text style={{ fontSize: 20, color: ink.mid, lineHeight: 23 }}>×</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 16 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Session card — category, length, repeat as one composed object */}
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
                <Text style={[fieldKicker, { marginBottom: 0 }]}>LENGTH</Text>
                <Text style={{ fontFamily: FF.display, fontSize: 24, color: ink.deep, letterSpacing: -0.4 }}>
                  {durLabel}
                </Text>
              </View>
              <PlantSlider
                minimumValue={15}
                maximumValue={300}
                step={15}
                value={mins}
                onValueChange={setMins}
                accent={earn.sage}
                track={ink.ghost}
                soil={ink.border}
                textColor={ink.faint}
                leftLabel="15m"
                rightLabel="5h"
              />

              {/* Quick lengths — dragging a slider to an exact common value is
                  fiddly; these snap straight to it. */}
              <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
                {QUICK_LENGTHS.map(m => {
                  const active = mins === m;
                  return (
                    <TouchableOpacity
                      key={m}
                      onPress={() => setMins(m)}
                      activeOpacity={0.8}
                      style={{
                        flex: 1,
                        paddingVertical: 9,
                        borderRadius: 12,
                        alignItems: "center",
                        borderWidth: 1.2,
                        borderColor: active ? earn.sage : ink.border,
                        backgroundColor: active ? earn.sageLo : "transparent",
                      }}
                    >
                      <Text style={{ fontFamily: FF.bodyMed, fontSize: 13, color: active ? earn.sage : ink.mid }}>
                        {m >= 60 ? `${m / 60}h` : `${m}m`}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={cardDivider} />

              {/* Repeat — collapsed to a single row showing the current choice.
                  Five pills for something most tasks never change was a lot of
                  visual noise for a one-off decision. */}
              <TouchableOpacity
                onPress={() => setRepeatOpen(v => !v)}
                activeOpacity={0.7}
                style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
              >
                <Text style={[fieldKicker, { marginBottom: 0 }]}>REPEAT</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ fontFamily: FF.bodyMed, fontSize: 14, color: recur === "none" ? ink.mid : earn.sage }}>
                    {REPEAT_LABELS[recur] || "Once"}
                  </Text>
                  <Text style={{
                    fontFamily: FF.body, fontSize: 11, color: ink.faint,
                    transform: [{ rotate: repeatOpen ? "180deg" : "0deg" }],
                  }}>
                    ▾
                  </Text>
                </View>
              </TouchableOpacity>

              {repeatOpen && (
              <View style={{ marginTop: 14, gap: 2 }}>
              {REPEAT_OPTIONS.map(([value, label]) => {
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
                      // Collapse on pick unless there's more to configure.
                      if (value === "none" || !isSubActive) setRepeatOpen(false);
                    }}
                    activeOpacity={0.7}
                    style={{
                      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                      paddingVertical: 12, paddingHorizontal: 14,
                      borderRadius: 14,
                      backgroundColor: active ? earn.sageLo : "transparent",
                    }}
                  >
                    <Text style={{ fontFamily: FF.bodyMed, fontSize: 14, color: active ? earn.sage : ink.mid }}>
                      {label}
                    </Text>
                    {active && <CheckIcon size={15} color={earn.sage} />}
                  </TouchableOpacity>
                );
              })}
              </View>
              )}
              {repeatOpen && !isSubActive && (
              <TouchableOpacity
                onPress={onOpenPaywall}
                style={{
                  marginTop: 12,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  padding: 13,
                  borderRadius: 14,
                  backgroundColor: paper.sand,
                }}
              >
                <LockIcon size={16} color={ink.mid} />
                <Text style={{ flex: 1, fontFamily: FF.body, fontSize: 12, color: ink.mid }}>
                  Recurring task schedules are a Pro feature.
                </Text>
                <Text style={{ fontFamily: FF.kicker, fontSize: 9, color: earn.sage, letterSpacing: 1 }}>UPGRADE</Text>
              </TouchableOpacity>
            )}
            {repeatOpen && recur !== "none" && isSubActive && (
              <View style={{
                marginTop: 12,
                gap: 10,
                padding: 13,
                borderRadius: 14,
                backgroundColor: paper.sand,
              }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Text style={{ fontFamily: FF.body, fontSize: 12, color: ink.mid, flex: 1 }}>
                    Create this task at
                  </Text>
                  <TimePickerButton
                    value={recurTime}
                    onChange={setRecurTime}
                    fallback="9:00 AM"
                    dark={dark}
                    theme={theme}
                    style={{
                      width: 112,
                      paddingVertical: 8,
                      paddingHorizontal: 10,
                      borderRadius: 10,
                      backgroundColor: paper.card,
                      borderWidth: 1,
                      borderColor: ink.border,
                    }}
                    textStyle={{
                      color: ink.deep,
                      fontFamily: FF.bodyMed,
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
                            borderWidth: 1.2,
                            borderColor: active ? earn.sage : ink.border,
                            backgroundColor: active ? earn.sageLo : paper.card,
                            alignItems: "center",
                          }}
                        >
                          <Text style={{ fontFamily: FF.bodyMed, fontSize: 11, color: active ? earn.sage : ink.mid }}>
                            {name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            )}

              <View style={cardDivider} />

              {/* Earn preview — the one thing worth knowing before you commit.
                  The kicker says "estimated" so the numbers need no caption
                  explaining that AI sets the final value. */}
              <Text style={fieldKicker}>ESTIMATED EARNINGS</Text>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: FF.display, fontSize: 26, color: earn.sage, letterSpacing: -0.4 }}>
                    {earnPreview.credits}m
                  </Text>
                  <Text style={{ fontFamily: FF.body, fontSize: 11, color: ink.mid, marginTop: 2 }}>
                    screen time
                  </Text>
                </View>
                <View style={{ width: 1, height: 36, backgroundColor: ink.hairline, marginHorizontal: 16 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: FF.display, fontSize: 26, color: earn.clay, letterSpacing: -0.4 }}>
                    +{earnPreview.xp}
                  </Text>
                  <Text style={{ fontFamily: FF.body, fontSize: 11, color: ink.mid, marginTop: 2 }}>
                    experience
                  </Text>
                </View>
              </View>
            </View>

            {/* AI check — just the mark by default. The explanation is one tap
                away for anyone who wants it, instead of a permanent block of
                text taking up the page. */}
            <View style={{ alignItems: "center", marginTop: 16 }}>
              <TouchableOpacity
                onPress={() => {
                  if (!isSubActive) { onOpenPaywall?.(); return; }
                  setShowAiInfo(v => !v);
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                activeOpacity={0.7}
                style={{
                  width: 38, height: 38, borderRadius: 19,
                  alignItems: "center", justifyContent: "center",
                  backgroundColor: showAiInfo ? earn.blueLo : ink.ghost,
                  borderWidth: 1,
                  borderColor: showAiInfo ? earn.blue : "transparent",
                }}
              >
                {isSubActive
                  ? <SparkleIcon size={17} color={earn.blue} />
                  : <LockIcon size={16} color={ink.mid} />}
              </TouchableOpacity>

              {showAiInfo && isSubActive && (
                <View style={{
                  marginTop: 10,
                  padding: 14, borderRadius: 18,
                  backgroundColor: paper.card,
                  borderWidth: 1, borderColor: ink.border,
                }}>
                  <Text style={{ fontFamily: FF.body, fontSize: 12, color: ink.mid, lineHeight: 18, textAlign: "center" }}>
                    AI reads your task to set its value and sort it into a
                    category for you, then checks your proof before credits
                    are earned.
                  </Text>
                </View>
              )}

              {/* Quiet pointer to the automatic sources — one line of text, and
                  only while neither source is set up. */}
              {onOpenAutoTasks && (
                <TouchableOpacity
                  onPress={onOpenAutoTasks}
                  activeOpacity={0.7}
                  style={{ marginTop: 18, paddingVertical: 6 }}
                >
                  <Text style={{ fontFamily: FF.body, fontSize: 12, color: ink.faint, textAlign: "center" }}>
                    or let Drift add them from your{" "}
                    <Text style={{ fontFamily: FF.bodyMed, color: earn.sage }}>calendar or places</Text>
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>

          {/* Bottom dock — the task name lives down here, in thumb reach */}
          <View style={{ paddingHorizontal: 22, paddingTop: 8, paddingBottom: Platform.OS === "ios" ? 30 : 16 }}>
            <View style={{
              backgroundColor: paper.card,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: ink.border,
              padding: 14,
            }}>
              {!!evalError && (
                <View style={{
                  padding: 11, borderRadius: 12, marginBottom: 10,
                  backgroundColor: theme.danger.bg,
                  borderWidth: 1, borderColor: theme.danger.border,
                }}>
                  <Text style={{ fontFamily: FF.body, fontSize: 12, color: theme.danger.fg, textAlign: "center" }}>
                    {evalError}
                  </Text>
                </View>
              )}
              <TextInput
                value={title} onChangeText={setTitle}
                placeholder='What needs doing? e.g. "30 min gym"'
                placeholderTextColor={ink.faint}
                maxLength={80}
                returnKeyType="go"
                onSubmitEditing={() => { if (ready && !evaluating) save(); }}
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
              />
              <TouchableOpacity
                onPress={save}
                disabled={!ready || evaluating}
                activeOpacity={0.85}
                style={[
                  {
                    height: 54,
                    borderRadius: 18,
                    marginTop: 10,
                    alignItems: "center",
                    justifyContent: "center",
                    flexDirection: "row",
                    gap: 9,
                    backgroundColor: ready ? earn.deep : ink.ghost,
                    opacity: evaluating ? 0.7 : 1,
                  },
                  ready && !evaluating && theme.fx.glow,
                ]}
              >
                {evaluating && <Spinner size={18} color={dark ? "#16261C" : "#FAF6EE"} />}
                <Text style={{
                  fontFamily: FF.bodyMed, fontSize: 15, letterSpacing: 0.2,
                  color: ready ? (dark ? "#16261C" : "#FAF6EE") : ink.faint,
                }}>
                  {evaluating ? "Adding…" : ready ? "Add task" : "Name your task first"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
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
      q: `Spent ~${task.minutes} minutes?`,
      sub: "Close enough is fine. Make it real.",
      Icon: ({ size, color }) => (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <SvgCircle cx="12" cy="13" r="8" stroke={color} strokeWidth={2} />
          <Path d="M12 9v4l3 2 M9 3h6" stroke={color} strokeWidth={2} strokeLinecap="round" />
        </Svg>
      ),
    },
    {
      q: "Focused time?",
      sub: "No background scrolling.",
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
    <OriginSheet visible={!!task} onClose={onCancel} align="bottom"
      sheetStyle={{
        backgroundColor: paper.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
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

      <Pop onPress={confirm} style={{
        paddingVertical: 15, borderRadius: 14, backgroundColor: earn.green, alignItems: "center", marginBottom: 10,
        ...theme.fx.glow,
      }}>
        <Text style={{ fontFamily: FK, fontSize: 16, color: dark ? "#16261C" : "#fff" }}>
          {step < QUESTIONS.length - 1 ? "Yes" : "Claim credits"}
        </Text>
      </Pop>

      <TouchableOpacity onPress={onCancel} style={{ paddingVertical: 12, alignItems: "center" }}>
        <Text style={{ fontFamily: FB, fontSize: 13, color: ink.mid }}>
          {step === 0 ? "Cancel" : "No"}
        </Text>
      </TouchableOpacity>
    </OriginSheet>
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

  // No early return on !visible — OriginSheet manages mount/unmount so the
  // close animation can play out.

  const confirm = () => {
    if (!selected || selected > maxMins) return;
    onReduce?.(selected);
  };

  return (
    <OriginSheet visible={visible} onClose={onClose} align="bottom"
      sheetStyle={[s2.panel, s2.bottomSheetPanel, { backgroundColor: paper.card, borderColor: ink.border }]}>
      <Text style={[s2.kicker, { color: ink.faint }]}>SCREEN TIME</Text>
      <Text style={[s2.panelTitle, { color: ink.deep }]}>Remove time</Text>
      <Text style={[s2.panelText, { color: ink.mid }]}>
        Give back earned minutes.
      </Text>
      {maxMins < 1 ? (
        <Text style={[s2.emptyText, { color: ink.faint }]}>No time to remove.</Text>
      ) : (
        <View style={s2.amountGrid}>
          {options.map(m => (
            <Pop
              key={m}
              onPress={() => setSelected(m)}
              style={[
                s2.amountPill,
                { borderColor: ink.border, backgroundColor: paper.sand },
                selected === m && { borderColor: earn.sage, backgroundColor: earn.sageLo },
              ]}
            >
              <Text style={[s2.amountText, { color: selected === m ? earn.sage : ink.deep }]}>{m}m</Text>
            </Pop>
          ))}
          {maxMins > 0 && !options.includes(maxMins) && (
            <Pop
              onPress={() => setSelected(maxMins)}
              style={[
                s2.amountPill,
                { borderColor: ink.border, backgroundColor: paper.sand },
                selected === maxMins && { borderColor: earn.sage, backgroundColor: earn.sageLo },
              ]}
            >
              <Text style={[s2.amountText, { color: selected === maxMins ? earn.sage : ink.deep }]}>All</Text>
            </Pop>
          )}
        </View>
      )}
      <View style={[s2.actions, s2.quickActions]}>
        <TouchableOpacity onPress={onClose} style={[s2.ghostBtn, s2.quickActionBtn, { borderColor: ink.border }]}>
          <Text numberOfLines={1} style={[s2.ghostText, { color: ink.mid }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={confirm} disabled={!selected} style={[s2.solidBtn, s2.quickActionBtn, { backgroundColor: selected ? earn.deep : ink.faint }, selected && theme.fx.glow]}>
          <Text numberOfLines={1} style={[s2.solidText, { color: dark ? "#1F3A2A" : "#FAF6EE" }]}>Reduce</Text>
        </TouchableOpacity>
      </View>
    </OriginSheet>
  );
}

function QuickGrantModal({ visible, usedToday, dark, onClose, onGrant, grantMins }) {
  const QUICK_SLIDES = [
    { title: "Pause.", body: "This is unearned time." },
    { title: "Use it well.", body: `${grantMins} minute${grantMins === 1 ? "" : "s"} goes fast.` },
    { title: "Final check.", body: `Take ${grantMins} minute${grantMins === 1 ? "" : "s"}?` },
  ];
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;
  const [step, setStep] = useState(0);
  const [breathing, setBreathing] = useState(false);
  const [seconds, setSeconds] = useState(15);
  const scale = useRef(new Animated.Value(0.96)).current;
  const plant = useRef(new Animated.Value(0)).current;

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
    plant.setValue(0);
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(plant, { toValue: 1, duration: 3200, useNativeDriver: true }),
      Animated.timing(plant, { toValue: 0, duration: 3200, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [breathing, plant]);

  useEffect(() => {
    if (!breathing || seconds <= 0) return;
    const id = setTimeout(() => setSeconds(s => s - 1), 1000);
    return () => clearTimeout(id);
  }, [breathing, seconds]);

  // OriginSheet manages mount/unmount; no early return so close anim plays.

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

  const plantScale = plant.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.04] });
  const stemScale = plant.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] });
  const leafScale = plant.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.08] });
  const leftLeafTilt = plant.interpolate({ inputRange: [0, 1], outputRange: ["-34deg", "-18deg"] });
  const rightLeafTilt = plant.interpolate({ inputRange: [0, 1], outputRange: ["34deg", "18deg"] });
  const plantGlow = plant.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.34] });
  const progress = breathing ? 1 : (step + 1) / QUICK_SLIDES.length;
  const primaryText = ink.deep;
  const secondaryText = ink.mid;
  const disabledBtn = ink.ghost;
  const disabledBtnText = ink.faint;
  const slide = QUICK_SLIDES[step] || QUICK_SLIDES[0];

  return (
    <OriginSheet visible={visible} onClose={onClose} align="bottom"
      sheetStyle={[s2.panel, s2.bottomSheetPanel, { backgroundColor: paper.card, borderColor: ink.border }]}>
      <Animated.View style={{ transform: [{ scale }] }}>
          <Text style={[s2.kicker, { color: ink.faint }]}>RESET MINUTES</Text>
          <View style={[s2.progressTrack, { backgroundColor: ink.ghost }]}>
            <Animated.View style={[s2.progressFill, { width: `${progress * 100}%`, backgroundColor: earn.sage }]} />
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
              <Animated.View style={[s2.plantStage, { backgroundColor: paper.sand, borderColor: ink.border, transform: [{ scale: plantScale }] }]}>
                <Animated.View style={[s2.plantGlow, { backgroundColor: earn.sage, opacity: plantGlow }]} />
                <View style={[s2.plantSoil, { backgroundColor: dark ? "rgba(70,55,39,0.72)" : "rgba(116,88,58,0.28)" }]} />
                <View style={[s2.plantPot, { backgroundColor: earn.clay, borderColor: dark ? "rgba(250,246,238,0.14)" : "rgba(71,51,31,0.12)" }]}>
                  <View style={[s2.plantPotLip, { backgroundColor: dark ? "rgba(250,246,238,0.12)" : "rgba(255,255,255,0.22)" }]} />
                </View>
                <Animated.View style={[s2.plantStem, { backgroundColor: earn.sage, transform: [{ scaleY: stemScale }] }]} />
                <Animated.View style={[s2.plantLeaf, s2.plantLeafLeft, { backgroundColor: earn.sage, transform: [{ rotate: leftLeafTilt }, { scale: leafScale }] }]} />
                <Animated.View style={[s2.plantLeaf, s2.plantLeafRight, { backgroundColor: earn.sage, transform: [{ rotate: rightLeafTilt }, { scale: leafScale }] }]} />
                <Animated.View style={[s2.plantLeaf, s2.plantTopLeaf, { backgroundColor: earn.green, transform: [{ scale: leafScale }] }]} />
              </Animated.View>
              <Text style={[s2.panelTitle, { color: primaryText, textAlign: "center" }]}>Take deep breaths</Text>
              <Text style={[s2.panelText, { color: secondaryText, textAlign: "center" }]}>
                Continue in {seconds}s.
              </Text>
            </View>
          )}
          <View style={[s2.actions, s2.quickActions]}>
            <TouchableOpacity onPress={onClose} style={[s2.ghostBtn, s2.quickActionBtn, { borderColor: ink.border }]}>
              <Text numberOfLines={1} style={[s2.ghostText, { color: ink.mid }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={breathing ? finish : next} disabled={breathing && seconds > 0} style={[s2.solidBtn, s2.quickActionBtn, { backgroundColor: breathing && seconds > 0 ? disabledBtn : earn.deep }, !(breathing && seconds > 0) && theme.fx.glow]}>
              <Text numberOfLines={1} adjustsFontSizeToFit style={[s2.solidText, { color: breathing && seconds > 0 ? disabledBtnText : (dark ? "#1F3A2A" : "#FAF6EE") }]}>{breathing ? `Claim ${grantMins}m` : "Continue"}</Text>
            </TouchableOpacity>
          </View>
          <Text style={[s2.footerHint, { color: ink.faint }]}>{Math.max(0, 3 - usedToday)} left today</Text>
      </Animated.View>
    </OriginSheet>
  );
}

function FloatingFeedback({ popup }) {
  const scale = useRef(new Animated.Value(0.4)).current;
  const y = useRef(new Animated.Value(18)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const burst = useRef(new Animated.Value(0)).current;
  const particleRefs = useRef(Array.from({ length: 8 }, () => ({
    t: new Animated.Value(0),
    angle: Math.random() * Math.PI * 2,
    dist: 44 + Math.random() * 30,
  }))).current;

  useEffect(() => {
    if (!popup) return;
    scale.setValue(0.4);
    y.setValue(18);
    opacity.setValue(0);
    burst.setValue(0);
    particleRefs.forEach((p) => p.t.setValue(0));

    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 170, friction: 7 }),
      Animated.spring(y, { toValue: 0, useNativeDriver: true, tension: 140, friction: 9 }),
      Animated.timing(burst, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.stagger(18, particleRefs.map((p) =>
        Animated.timing(p.t, { toValue: 1, duration: 580, easing: Easing.out(Easing.quad), useNativeDriver: true })
      )),
      Animated.sequence([
        Animated.delay(2300),
        Animated.parallel([
          Animated.timing(opacity, { toValue: 0, duration: 260, useNativeDriver: true }),
          Animated.timing(y, { toValue: -10, duration: 260, useNativeDriver: true }),
        ]),
      ]),
    ]).start();
  }, [popup, scale, y, opacity, burst, particleRefs]);

  if (!popup) return null;
  const isLoss = popup.loss > 0 && !(popup.credits > 0 || popup.xp > 0);
  const tint = isLoss ? "#C0392B" : earn.terra;

  const burstScale = burst.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1.6] });
  const burstOpacity = burst.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.5, 0.25, 0] });
  const ringScale = burst.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.0] });
  const ringOpacity = burst.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.6, 0.35, 0] });
  const checkScale = burst.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.5, 1.15, 1] });

  return (
    <View style={{
      position: "absolute", top: "18%", left: 0, right: 0,
      alignItems: "center", zIndex: 300,
      pointerEvents: "none",
    }}>
      {/* radial burst */}
      <Animated.View style={{
        position: "absolute", width: 120, height: 120, borderRadius: 60,
        backgroundColor: tint, opacity: burstOpacity,
        transform: [{ scale: burstScale }],
      }} />
      <Animated.View style={{
        position: "absolute", width: 90, height: 90, borderRadius: 45,
        borderWidth: 3, borderColor: tint, opacity: ringOpacity,
        transform: [{ scale: ringScale }],
      }} />

      {/* particle dots */}
      {particleRefs.map((p, i) => {
        const tx = p.t.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(p.angle) * p.dist] });
        const ty = p.t.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(p.angle) * p.dist] });
        const pOp = p.t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 0] });
        const pSc = p.t.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0.3, 1, 0.4] });
        return (
          <Animated.View key={i} style={{
            position: "absolute", top: 28, width: 6, height: 6, borderRadius: 3,
            backgroundColor: i % 2 === 0 ? tint : earn.green,
            opacity: pOp, transform: [{ translateX: tx }, { translateY: ty }, { scale: pSc }],
          }} />
        );
      })}

      {/* checkmark badge */}
      {!isLoss && (
        <Animated.View style={{
          width: 44, height: 44, borderRadius: 22, backgroundColor: tint,
          alignItems: "center", justifyContent: "center", marginBottom: 10,
          opacity, transform: [{ scale: checkScale }],
        }}>
          <Text style={{ color: "#fff", fontSize: 22, fontWeight: "700" }}>✓</Text>
        </Animated.View>
      )}

      <Animated.View style={{
        flexDirection: "row", justifyContent: "center", gap: 8,
        opacity, transform: [{ translateY: y }, { scale }],
      }}>
        {popup.credits > 0 && (
          <View style={{ backgroundColor: earn.green, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16 }}>
            <Text style={{ fontFamily: FO, fontSize: 12, color: "#fff", letterSpacing: 1 }}>+{fmtMins(popup.credits)}</Text>
          </View>
        )}
        {popup.loss > 0 && (
          <View style={{ backgroundColor: "#C0392B", borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16 }}>
            <Text style={{ fontFamily: FO, fontSize: 12, color: "#fff", letterSpacing: 1 }}>-{fmtMins(popup.loss)}</Text>
          </View>
        )}
        {popup.xp > 0 && (
          <View style={{ backgroundColor: earn.blue, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16 }}>
            <Text style={{ fontFamily: FO, fontSize: 12, color: "#fff", letterSpacing: 1 }}>+{popup.xp} XP</Text>
          </View>
        )}
      </Animated.View>
    </View>
  );
}

function LevelUpModal({ level, dark, onClose }) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;
  const scale = useRef(new Animated.Value(0.82)).current;
  const y = useRef(new Animated.Value(18)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const burst = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!level) return;
    scale.setValue(0.82);
    y.setValue(18);
    opacity.setValue(0);
    burst.setValue(0);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 90, friction: 9 }),
      Animated.spring(y, { toValue: 0, useNativeDriver: true, tension: 90, friction: 9 }),
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.timing(burst, { toValue: 1, duration: 720, useNativeDriver: true }),
    ]).start();
  }, [level, scale, y, opacity, burst]);

  if (!level) return null;
  const levelIdx = LEVELS.findIndex(l => l.name === level.name);
  const dots = [
    [-78, -52, earn.sage], [74, -48, earn.clay], [-92, 12, earn.terra],
    [88, 18, earn.sageDot], [-44, 70, earn.clay], [46, 74, earn.terra],
  ];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={[s2.backdrop, { justifyContent: "center" }]}>
        <Animated.View
          onTouchStart={(e) => e.stopPropagation?.()}
          style={[s2.panel, {
            maxWidth: 360,
            alignSelf: "center",
            backgroundColor: paper.card,
            borderColor: ink.border,
            alignItems: "center",
            opacity,
            transform: [{ translateY: y }, { scale }],
          }]}
        >
          <View style={{ width: 156, height: 124, alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
            {dots.map(([dx, dy, color], i) => (
              <Animated.View
                key={i}
                style={{
                  position: "absolute",
                  width: 9,
                  height: 9,
                  borderRadius: 5,
                  backgroundColor: color,
                  opacity: burst.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0.78] }),
                  transform: [
                    { translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) },
                    { translateY: burst.interpolate({ inputRange: [0, 1], outputRange: [0, dy] }) },
                    { scale: burst.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0.4, 1.18, 0.9] }) },
                  ],
                }}
              />
            ))}
            <View style={{
              width: 92,
              height: 92,
              borderRadius: 46,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: earn.sageLo,
              borderWidth: 1,
              borderColor: ink.hairline,
            }}>
              <LevelIcon index={levelIdx} size={44} color={earn.sage} strokeWidth={1.8} />
            </View>
          </View>

          <Text style={[s2.kicker, { color: ink.faint, textAlign: "center" }]}>LEVEL UP</Text>
          <Text style={[s2.panelTitle, { color: ink.deep, textAlign: "center", marginBottom: 4 }]}>
            {level.name}
          </Text>
          <Text style={[s2.panelText, { color: ink.mid, textAlign: "center", marginBottom: 20 }]}>
            Nice work. Your progress grew into a new tier.
          </Text>
          <Pop onPress={onClose} style={[s2.solidBtn, { width: "100%", backgroundColor: earn.deep }, theme.fx.glow]}>
            <Text style={[s2.solidText, { color: dark ? "#1F3A2A" : "#FAF6EE" }]}>Continue</Text>
          </Pop>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

function TodayView({ tasks, credits, totalXp, onComplete, onDelete, onAdd, heroRef, addRef, scrollRef, onReduceScreenTime, onQuickGrant, quickGrantCount, grantMins, onSwipeLockChange, dark, secLeft, showAutoTasksHint, onOpenAutoTasks, onDismissAutoTasksHint }) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;
  // Text color that sits on a `deep` (primary) button. In dark mode the deep
  // token is a LIGHT green, so cream text would wash out — use dark ink instead.
  const onDeep = dark ? "#16261C" : "#FAF6EE";

  const [verifyTask,   setVerifyTask]   = useState(null); // task being verified via prompts
  const [aiCheckTask,  setAiCheckTask]  = useState(null); // task being verified via AI

  const pending       = tasks.filter(t => !t.done);
  const done          = tasks.filter(t => t.done);
  const unlocked      = credits.balance > 0;
  const inDebt        = credits.balance < 0;
  const lv            = getLevel(totalXp);
  const lvIdx         = getLevelIdx(totalXp);
  const stillEarnable = pending.reduce((s, t) => s + t.credits, 0);
  const subtleActionBg = dark ? "rgba(232,245,236,0.085)" : paper.sand;
  const subtleActionBorder = dark ? "rgba(232,245,236,0.13)" : "transparent";

  const handleTaskTap = (t) => {
    if (t.aiCheck) setAiCheckTask(t);
    else setVerifyTask(t);
  };

  // Staggered entrance — runs once per mount. Sets a "delight" tone without
  // being noisy: card fades up first, then heading, then the list rows.
  const askDeleteTask = (t) => {
    if (!t) return;
    Alert.alert(`Delete ${t.title} task?`, `"${t.title}" will be removed from today.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => onDelete?.(t.id) },
    ]);
  };

  const heroOp = useRef(new Animated.Value(0)).current;
  const heroY  = useRef(new Animated.Value(14)).current;
  const headOp = useRef(new Animated.Value(0)).current;
  const listOp = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.stagger(110, [
      Animated.parallel([
        Animated.timing(heroOp, { toValue: 1, duration: 420, useNativeDriver: true }),
        Animated.timing(heroY,  { toValue: 0, duration: 480, useNativeDriver: true }),
      ]),
      Animated.timing(headOp, { toValue: 1, duration: 360, useNativeDriver: true }),
      Animated.timing(listOp, { toValue: 1, duration: 380, useNativeDriver: true }),
    ]).start();
  }, []);

  const balanceLabel = unlocked
    ? "YOUR TIME"
    : inDebt ? "TIME DEBT" : "YOUR TIME";

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
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1, backgroundColor: paper.warm }}
      contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 130 }}
      showsVerticalScrollIndicator={false}
    >
      {/* ── HERO CARD ────────────────────────────────────────────── */}
      <Animated.View ref={heroRef} style={{
        opacity: heroOp,
        transform: [{ translateY: heroY }],
        backgroundColor: paper.card,
        borderRadius: 28,
        padding: 22,
        marginBottom: 26,
        borderWidth: 1,
        borderColor: dark ? ink.border : ink.hairline,
        shadowColor: dark ? "#000" : "#1F3A2A",
        shadowOffset: { width: 0, height: 14 },
        shadowOpacity: dark ? 0.35 : 0.06,
        shadowRadius: 28,
        elevation: 4,
        overflow: "hidden",
      }}>
        {/* Aurora — soft mint + clay pools behind the sprout so the hero has
            atmosphere instead of a flat panel. Both modes, tuned per theme. */}
        <View pointerEvents="none" style={{
          position: "absolute", top: -95, right: -70,
          width: 250, height: 250, borderRadius: 125,
          backgroundColor: theme.fx.auroraMint,
        }} />
        <View pointerEvents="none" style={{
          position: "absolute", bottom: -110, left: -60,
          width: 220, height: 220, borderRadius: 110,
          backgroundColor: theme.fx.auroraClay,
        }} />
        {/* Current-level emblem — the plant reflects the user's tier
            (Seedling → Old Growth), matching the icon on the Growth page. */}
        <View style={{ position: "absolute", left: -18, bottom: -22, pointerEvents: "none", opacity: dark ? 0.5 : 0.42 }}>
          <LevelIcon index={lvIdx} size={132} color={earn.sage} strokeWidth={1.4} />
        </View>

        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
          <View style={{ flex: 1, paddingRight: 6 }}>
            {/* kicker */}
            <Text style={{
              fontFamily: FF.kicker,
              fontSize: 10,
              letterSpacing: 2.4,
              color: ink.faint,
              marginBottom: 8,
            }}>
              {balanceLabel}
            </Text>

            {/* huge balance display */}
            <CreditTicker
              value={Math.max(0, credits.balance)}
              seconds={secLeft}
              textColor={inDebt ? "#C0392B" : dark ? earn.deepHi : ink.deep}
            />

            <Text style={{
              fontFamily: FF.body,
              fontSize: 13,
              color: ink.mid,
              marginTop: 4,
            }}>
              {unlocked ? "Available now" : inDebt ? "Earn this back to unlock" : "No time earned yet"}
            </Text>

            {/* iOS enforces Screen Time in ~15-minute windows, so blocking can
                kick in slightly after your balance hits zero. Setting this
                expectation avoids "it didn't block instantly" confusion. */}
            {unlocked && (
              <Text style={{
                fontFamily: FF.body,
                fontSize: 10.5,
                color: ink.faint,
                marginTop: 8,
                lineHeight: 15,
              }}>
                iOS enforces blocking in ~15-minute windows, so timing is approximate.
              </Text>
            )}
          </View>

          {/* level pill — top right */}
          <View style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingVertical: 5,
            paddingHorizontal: 11,
            borderRadius: 18,
            backgroundColor: earn.sageLo,
          }}>
            <LevelIcon index={lvIdx} size={13} color={earn.sage} strokeWidth={2.1} />
            <Text style={{ fontFamily: FF.bodyMed, fontSize: 12, color: earn.sage }}>
              {lv.name}
            </Text>
          </View>
        </View>

        {/* Sprout illustration — anchored to the right */}
        <View style={{
          position: "absolute",
          right: -6,
          top: 56,
          width: 150,
          height: 150,
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
        }}>
          <Sprout size={148} tone={dark ? "night" : "fresh"} />
        </View>

        {/* Hairline progress */}
        <View style={{
          height: 2,
          backgroundColor: ink.hairline,
          borderRadius: 1,
          marginTop: 22,
          marginBottom: 16,
          overflow: "hidden",
        }}>
          {credits.earned > 0 && (
            <View style={{
              height: "100%",
              width: `${Math.min(100, (credits.earned > 0 ? (credits.balance / Math.max(credits.earned, 1)) * 100 : 0))}%`,
              backgroundColor: earn.terra,
            }} />
          )}
        </View>

        {/* Stat row — EARNED / USED / EARNABLE */}
        <View style={{ flexDirection: "row", gap: 28 }}>
          <StatBlock
            dot={earn.terra}
            label="EARNED"
            value={fmtMins(credits.earned || 0)}
            ink={ink}
          />
          <StatBlock
            dot={ink.faint}
            label="USED"
            value={fmtMins(credits.spent || 0)}
            ink={ink}
          />
          {stillEarnable > 0 && (
            <StatBlock
              dot={earn.clay}
              label="EARNABLE"
              value={fmtMins(stillEarnable)}
              ink={ink}
            />
          )}
        </View>

        {/* ── In-card action zone (matches reference image) ──────── */}
        {!unlocked && (
          <TouchableOpacity
            onPress={onAdd}
            activeOpacity={0.8}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 14,
              backgroundColor: subtleActionBg,
              borderWidth: dark ? StyleSheet.hairlineWidth : 0,
              borderColor: subtleActionBorder,
              borderRadius: 16,
              paddingVertical: 14,
              paddingHorizontal: 16,
              marginTop: 20,
            }}
          >
            <View style={{
              width: 36, height: 36, borderRadius: 18,
              alignItems: "center", justifyContent: "center",
              backgroundColor: earn.clayLo,
            }}>
              <LockIcon size={18} color={earn.clay} />
            </View>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.88}
              style={{ flex: 1, fontFamily: FF.bodyBold, fontSize: 14, color: ink.deep }}
            >
              Start earning
            </Text>
            <Text style={{ fontFamily: FF.serifReg, fontSize: 22, color: ink.faint, marginTop: -2 }}>›</Text>
          </TouchableOpacity>
        )}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 20 }}>
            <TouchableOpacity
              onPress={onReduceScreenTime}
              disabled={credits.balance <= 0}
              activeOpacity={0.8}
              style={{
                flex: 1,
                paddingVertical: 13,
                paddingHorizontal: 8,
                borderRadius: 14,
                alignItems: "center",
                backgroundColor: subtleActionBg,
                borderWidth: dark ? StyleSheet.hairlineWidth : 0,
                borderColor: subtleActionBorder,
                opacity: credits.balance > 0 ? 1 : 0.55,
              }}
            >
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
                style={{ fontFamily: FF.bodyMed, fontSize: 13, color: ink.deep, textAlign: "center" }}
              >
                Remove time
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onQuickGrant}
              disabled={quickGrantCount >= 3}
              activeOpacity={0.8}
              style={{
                flex: 1,
                paddingVertical: 13,
                paddingHorizontal: 8,
                borderRadius: 14,
                alignItems: "center",
                backgroundColor: quickGrantCount < 3 ? earn.sageLo : ink.ghost,
              }}
            >
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.82}
                style={{ fontFamily: FF.bodyMed, fontSize: 13, color: quickGrantCount < 3 ? earn.sage : ink.faint, textAlign: "center" }}
              >
                Take {grantMins}m · {Math.max(0, 3 - quickGrantCount)} left
              </Text>
            </TouchableOpacity>
          </View>
      </Animated.View>

      {/* ── ADD TASK ROW (cursive heading removed per request) ───── */}
      <Animated.View style={{
        opacity: headOp,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 16,
      }}>
        <Text style={{
          fontFamily: FF.kicker,
          fontSize: 11,
          letterSpacing: 2.4,
          color: ink.faint,
        }}>
          TODAY
        </Text>
        {/* The tour spotlights this button, and getting its rect has been
            fiddly: a ref on the TouchableOpacity — or on a style-less wrapper —
            resolves to the parent row under view flattening, and that row is
            `space-between`, so the hole landed on the "TODAY" kicker instead of
            the button. See the onLayout note below for what actually fixes it. */}
        <View
          ref={addRef}
          collapsable={false}
          // NOT dead code: a View carrying an onLayout handler is never
          // flattened away, which is what guarantees `addRef` points at a real
          // host node instead of resolving to the parent row. We deliberately
          // do NOT cache the rect here — onLayout doesn't re-fire on scroll, so
          // a cached position would go stale the moment the user scrolls. The
          // tour measures this node live instead.
          onLayout={NOOP}
          style={{ alignSelf: "center" }}
        >
          <TouchableOpacity
            onPress={onAdd}
            activeOpacity={0.85}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingVertical: 11,
              paddingHorizontal: 16,
              borderRadius: 14,
              backgroundColor: earn.deep,
              // The primary CTA is a light source — let it glow in both modes.
              ...theme.fx.glow,
            }}
          >
            <Text style={{ fontFamily: FF.body, fontSize: 16, color: onDeep, marginTop: -1 }}>+</Text>
            <Text style={{ fontFamily: FF.bodyMed, fontSize: 13, color: onDeep }}>Add task</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* One-line nudge toward automatic tasks. Deliberately plain — a single
          row of text, no icon block or illustration — and it removes itself
          for good once set up or dismissed. */}
      {showAutoTasksHint && (
        <View style={{
          flexDirection: "row", alignItems: "center", gap: 10,
          paddingVertical: 12, paddingHorizontal: 14,
          borderRadius: 16, marginBottom: 14,
          backgroundColor: subtleActionBg,
          borderWidth: 1, borderColor: subtleActionBorder,
        }}>
          <TouchableOpacity
            onPress={onOpenAutoTasks}
            activeOpacity={0.7}
            style={{ flex: 1 }}
          >
            <Text style={{ fontFamily: FF.body, fontSize: 12.5, color: ink.mid, lineHeight: 18 }}>
              Let tasks add themselves — from your calendar, or when you arrive
              somewhere. <Text style={{ fontFamily: FF.bodyMed, color: earn.sage }}>Set up</Text>
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onDismissAutoTasksHint}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={{ fontSize: 16, color: ink.faint, lineHeight: 19 }}>×</Text>
          </TouchableOpacity>
        </View>
      )}

      {tasks.length === 0 && (
        <Animated.View style={{
          opacity: listOp,
          alignItems: "center",
          paddingVertical: 36,
          paddingHorizontal: 22,
          borderRadius: 22,
          borderWidth: 1.4,
          borderColor: paper.dash,
          borderStyle: "dashed",
          backgroundColor: "transparent",
          overflow: "hidden",
        }}>
          {/* faint botanical watermarks */}
          <View style={{ position: "absolute", right: -16, top: -10, pointerEvents: "none" }}>
            <Sprig size={108} color={earn.sage} opacity={dark ? 0.06 : 0.05} />
          </View>
          <View style={{ position: "absolute", left: -20, bottom: -24, pointerEvents: "none" }}>
            <Sprig size={120} color={earn.clay} opacity={dark ? 0.06 : 0.045} flip />
          </View>

          <View style={{
            width: 64, height: 64, borderRadius: 32,
            alignItems: "center", justifyContent: "center",
            backgroundColor: paper.cream,
            marginBottom: 18,
          }}>
            <ClipboardIcon size={30} color={ink.mid} />
          </View>
          <Text style={{
            fontFamily: FF.serif,
            fontSize: 26,
            color: ink.deep,
            marginBottom: 6,
            letterSpacing: -0.4,
          }}>
            No tasks
          </Text>
          <Text style={{
            fontFamily: FF.body,
            fontSize: 13,
            color: ink.mid,
            marginBottom: 22,
            textAlign: "center",
          }}>
            Add one to begin.
          </Text>
          <TouchableOpacity
            onPress={onAdd}
            activeOpacity={0.85}
            style={{
              paddingVertical: 14, paddingHorizontal: 22, borderRadius: 14,
              backgroundColor: earn.deep,
              flexDirection: "row", alignItems: "center", gap: 8,
              ...theme.fx.glow,
            }}
          >
            <Text style={{ fontFamily: FF.body, fontSize: 16, color: onDeep, marginTop: -1 }}>+</Text>
            <Text style={{ fontFamily: FF.bodyMed, fontSize: 14, color: onDeep }}>Add task</Text>
          </TouchableOpacity>
          <Text style={{
            fontFamily: FF.body,
            fontSize: 11,
            color: ink.faint,
            marginTop: 16,
            letterSpacing: 0.2,
          }}>
            Earn time.
          </Text>
        </Animated.View>
      )}

      <Animated.View style={{ opacity: listOp }}>
        {pending.map(t => {
        const cat = CATS[t.cat] || CATS.life;
        return (
          <View key={t.id} style={{ marginBottom: 10 }}>
          <Swipeable
            onDelete={() => onDelete?.(t.id)}
            confirmTitle={`Delete ${t.title} task?`}
            confirmMessage={`"${t.title}" will be removed.`}
            onActiveChange={onSwipeLockChange}
          >
          <TouchableOpacity
            onPress={() => handleTaskTap(t)}
            activeOpacity={0.85}
            style={{
              flexDirection: "row", alignItems: "center",
              backgroundColor: cat.c + "0F", borderRadius: 18,
              overflow: "hidden",
              borderWidth: 1, borderColor: ink.hairline,
              borderLeftWidth: 4, borderLeftColor: cat.c,
              paddingVertical: 14, paddingLeft: 14, paddingRight: 34,
            }}
          >
            <Pressable
              onPress={(e) => {
                e.stopPropagation?.();
                askDeleteTask(t);
              }}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              style={{
                position: "absolute",
                top: 7,
                right: 7,
                zIndex: 3,
                width: 18,
                height: 18,
                borderRadius: 9,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: dark ? "rgba(255,134,134,0.16)" : "rgba(224,80,80,0.10)",
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: dark ? "rgba(255,154,154,0.26)" : "rgba(224,80,80,0.18)",
              }}
            >
              <Text style={{
                fontFamily: FF.bodyBold,
                fontSize: 12,
                lineHeight: 13,
                color: dark ? "#F0A0A0" : "#C96A6A",
                marginTop: -1,
              }}>
                x
              </Text>
            </Pressable>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={{
                fontFamily: FF.kicker,
                fontSize: 10,
                color: cat.c,
                letterSpacing: 0.6,
                textTransform: "uppercase",
                marginBottom: 4,
              }}>
                {cat.l}
              </Text>
              <Text style={{
                fontFamily: FF.bodyMed,
                fontSize: 15,
                color: ink.deep,
                lineHeight: 20,
                marginBottom: 6,
              }} numberOfLines={2}>
                {t.title}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={{
                  paddingVertical: 2, paddingHorizontal: 7,
                  borderRadius: 7,
                  backgroundColor: ink.ghost,
                }}>
                  <Text style={{ fontFamily: FF.bodyMed, fontSize: 11, color: ink.mid }}>
                    {t.minutes}m
                  </Text>
                </View>
                {t.aiCheck && (
                  <View style={{
                    flexDirection: "row", alignItems: "center", gap: 3,
                    paddingVertical: 2, paddingHorizontal: 7,
                    borderRadius: 7,
                    backgroundColor: earn.blueLo,
                  }}>
                    <SparkleIcon size={9} color={earn.blue} />
                    <Text style={{ fontFamily: FF.bodyMed, fontSize: 9, color: earn.blue, letterSpacing: 0.5 }}>
                      AI
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Reward badge — prominent green chip */}
            <View style={{
              paddingVertical: 5, paddingHorizontal: 10,
              borderRadius: 12,
              backgroundColor: earn.greenLo,
              marginRight: 12,
              flexShrink: 0,
            }}>
              <Text style={{ fontFamily: FF.bodyBold, fontSize: 13, color: earn.greenD }}>
                +{fmtMins(t.credits)}{t.aiPending ? "*" : ""}
              </Text>
            </View>

            {/* Check circle — minimal, becomes the tap-target */}
            <View style={{
              width: 30, height: 30, borderRadius: 15,
              borderWidth: 1.5,
              borderColor: t.aiCheck ? earn.blue : earn.deep,
              alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              {t.aiCheck
                ? <SparkleIcon size={14} color={earn.blue} />
                : <CheckIcon size={14} color={earn.deep} />}
            </View>
          </TouchableOpacity>
          </Swipeable>
          </View>
        );
      })}
      </Animated.View>

      {/* Done today — completed tasks stay visible but recede: dimmed, flat,
          no swipe/tap affordances. They read as settled rather than actionable,
          so the eye still lands on `pending` first. */}
      {done.length > 0 && (
        <Animated.View style={{ opacity: listOp, marginTop: 22 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <Text style={{ fontFamily: FF.kicker, fontSize: 9, color: ink.faint, letterSpacing: 1.6 }}>
              DONE TODAY
            </Text>
            <View style={{ flex: 1, height: 1, backgroundColor: ink.hairline }} />
            <Text style={{ fontFamily: FF.bodyMed, fontSize: 11, color: ink.faint }}>
              {done.length}
            </Text>
          </View>

          {done.map(t => {
            const cat = CATS[t.cat] || CATS.life;
            return (
              <View
                key={t.id}
                style={{
                  flexDirection: "row", alignItems: "center",
                  backgroundColor: ink.ghost, borderRadius: 18,
                  borderWidth: 1, borderColor: "transparent",
                  borderLeftWidth: 4, borderLeftColor: cat.c + "55",
                  paddingVertical: 12, paddingLeft: 14, paddingRight: 14,
                  marginBottom: 8,
                  opacity: 0.62,
                }}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    style={{
                      fontFamily: FF.bodyMed, fontSize: 14, color: ink.mid,
                      textDecorationLine: "line-through",
                    }}
                    numberOfLines={1}
                  >
                    {t.title}
                  </Text>
                </View>

                <Text style={{ fontFamily: FF.bodyBold, fontSize: 12, color: ink.faint, marginRight: 10 }}>
                  +{fmtMins(t.credits)}
                </Text>

                {/* Filled counterpart to the pending row's empty check circle. */}
                <View style={{
                  width: 26, height: 26, borderRadius: 13,
                  backgroundColor: earn.green,
                  alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  <CheckIcon size={13} color={dark ? "#16261C" : "#fff"} />
                </View>
              </View>
            );
          })}
        </Animated.View>
      )}
    </ScrollView>
    </>
  );
}

// Small visual primitive used by the hero card stat row.
function StatBlock({ dot, label, value, ink }) {
  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot }} />
        <Text style={{ fontFamily: FF.kicker, fontSize: 9, color: ink.faint, letterSpacing: 1.6 }}>
          {label}
        </Text>
      </View>
      <Text style={{ fontFamily: FF.bodyBold, fontSize: 17, color: ink.deep, letterSpacing: -0.2 }}>
        {value}
      </Text>
    </View>
  );
}

// ── Progress View ────────────────────────────────────────────
// Memoized: all four tab screens stay mounted in the filmstrip, so without
// memo every App-level state tick re-renders this whole tree and starves the
// JS thread (dropped taps). Props must keep stable identities — see the
// stable-handler wrappers in App.
const ProgressView = React.memo(function ProgressView({ tasks, totalXp, skips, onAddTask, dark }) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;
  // Dark text for the light-green `deep` button in dark mode (see TodayView).
  const onDeep = dark ? "#16261C" : "#FAF6EE";
  const lv        = getLevel(totalXp);
  const lvIdx     = getLevelIdx(totalXp);
  const prog      = xpProg(totalXp);
  const toNext    = xpToNext(totalXp);
  const done      = tasks.filter(t => t.done);
  const catCounts = done.reduce((a, t) => { a[t.cat] = (a[t.cat] || 0) + t.credits; return a; }, {});
  const maxCat    = Math.max(...Object.values(catCounts), 1);
  const weekly    = computeWeekly(done);
  const streak    = computeStreak(done);
  const maxDay    = Math.max(...weekly.perDay, 1);
  const DOW       = ["S", "M", "T", "W", "T", "F", "S"];

  // Aurora pools — the same quiet light as the Drift In door.
  const auroras = (
    <>
      <View pointerEvents="none" style={{
        position: "absolute", top: -120, right: -90,
        width: 300, height: 300, borderRadius: 150,
        backgroundColor: theme.fx.auroraMint,
      }} />
      <View pointerEvents="none" style={{
        position: "absolute", bottom: -130, left: -100,
        width: 280, height: 280, borderRadius: 140,
        backgroundColor: theme.fx.auroraClay,
      }} />
    </>
  );

  // Empty state — no tasks completed yet today
  if (done.length === 0 && tasks.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, backgroundColor: paper.warm }}>
        {auroras}
        <View style={{ marginBottom: 8 }}>
          <Sprout size={140} tone={dark ? "night" : "fresh"} />
        </View>
        <Text style={{
          fontFamily: FF.display,
          fontSize: 32,
          color: ink.deep,
          marginBottom: 8,
          letterSpacing: -0.4,
        }}>
          No stats
        </Text>
        <Text style={{
          fontFamily: FF.body, fontSize: 13, color: ink.mid,
          textAlign: "center", marginBottom: 28, lineHeight: 20,
        }}>
          Complete a task first.
        </Text>
        <TouchableOpacity
          onPress={onAddTask}
          activeOpacity={0.85}
          style={{
            paddingVertical: 14, paddingHorizontal: 22, borderRadius: 14,
            backgroundColor: earn.deep,
            flexDirection: "row", alignItems: "center", gap: 8,
            ...theme.fx.glow,
          }}
        >
          <Text style={{ fontFamily: FF.body, fontSize: 16, color: onDeep, marginTop: -1 }}>+</Text>
          <Text style={{ fontFamily: FF.bodyMed, fontSize: 14, color: onDeep }}>Add task</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: paper.warm }}>
      {auroras}
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 130 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Editorial page title */}
      <Text style={{
        fontFamily: FF.display,
        fontSize: 36,
        color: ink.deep,
        letterSpacing: -0.4,
        marginBottom: 4,
      }}>
        Growth
      </Text>
      <Text style={{ fontFamily: FF.body, fontSize: 13, color: ink.mid, marginBottom: 22 }}>
        Your progress.
      </Text>

      {/* Level card — editorial */}
      <View style={{
        backgroundColor: paper.card,
        borderRadius: 24, padding: 22,
        borderWidth: 1, borderColor: ink.hairline,
        marginBottom: 14,
        overflow: "hidden",
        shadowColor: dark ? "#000" : "#1F3A2A",
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: dark ? 0.3 : 0.05,
        shadowRadius: 22,
        elevation: 3,
      }}>
        {/* faint sprig watermark behind the tier card */}
        <View style={{ position: "absolute", right: -22, bottom: -26, pointerEvents: "none" }}>
          <Sprig size={150} color={earn.clay} opacity={dark ? 0.07 : 0.05} />
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: FF.kicker, fontSize: 10, color: ink.faint, letterSpacing: 2.4, marginBottom: 6 }}>
              CURRENT TIER
            </Text>
            <Text style={{ fontFamily: FF.display, fontSize: 30, color: ink.deep, letterSpacing: -0.3 }}>
              {lv.name}
            </Text>
            <Text style={{ fontFamily: FF.body, fontSize: 13, color: ink.mid, marginTop: 2 }}>
              {totalXp.toLocaleString()} XP total
            </Text>
          </View>
          <View style={{
            width: 56, height: 56, borderRadius: 28,
            alignItems: "center", justifyContent: "center",
            backgroundColor: earn.sageLo,
          }}>
            <LevelIcon index={lvIdx} size={27} color={earn.sage} strokeWidth={1.9} />
          </View>
        </View>
        {toNext > 0 && (
          <>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
              <Text style={{ fontFamily: FF.kicker, fontSize: 9, color: ink.faint, letterSpacing: 1.6 }}>
                PROGRESS
              </Text>
              <Text style={{ fontFamily: FF.bodyMed, fontSize: 11, color: ink.mid }}>
                {toNext} XP to next tier
              </Text>
            </View>
            <View style={{ height: 4, borderRadius: 2, backgroundColor: ink.hairline, overflow: "hidden" }}>
              <View style={{ height: "100%", width: `${prog * 100}%`, backgroundColor: earn.terra, borderRadius: 2 }} />
            </View>
          </>
        )}
      </View>

      {/* ── This week: streak + earned-per-day chart ── */}
      <View style={{
        backgroundColor: paper.card,
        borderRadius: 24, padding: 22,
        borderWidth: 1, borderColor: ink.hairline,
        marginBottom: 14,
      }}>
        <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 16 }}>
          <View>
            <Text style={{ fontFamily: FF.kicker, fontSize: 10, color: ink.faint, letterSpacing: 2.4, marginBottom: 4 }}>
              THIS WEEK
            </Text>
            <Text style={{ fontFamily: FF.display, fontSize: 22, color: ink.deep, letterSpacing: -0.3 }}>
              {fmtMins(weekly.total)} earned
            </Text>
          </View>
          <View style={{
            flexDirection: "row", alignItems: "center", gap: 6,
            paddingVertical: 6, paddingHorizontal: 11, borderRadius: 16,
            backgroundColor: earn.sageLo,
          }}>
            <Text style={{ fontFamily: FF.bodyBold, fontSize: 13, color: earn.greenD }}>
              {streak}-day streak
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
          {weekly.keys.map((k, i) => {
            const mins = weekly.perDay[i];
            const [yy, mm, dd] = k.split("-").map(Number);
            const wd = DOW[new Date(yy, mm - 1, dd).getDay()];
            const isToday = k === todayKey();
            return (
              <View key={k} style={{ flex: 1, alignItems: "center", gap: 6 }}>
                <View style={{ height: 64, justifyContent: "flex-end" }}>
                  <View style={{
                    width: 14,
                    height: Math.max(3, (mins / maxDay) * 64),
                    borderRadius: 4,
                    backgroundColor: mins > 0 ? earn.terra : ink.hairline,
                  }} />
                </View>
                <Text style={{
                  fontFamily: FF.kicker, fontSize: 9,
                  color: isToday ? earn.sage : ink.faint,
                }}>
                  {wd}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* Stat tiles */}
      <View style={{ flexDirection: "row", gap: 12, marginBottom: 14 }}>
        {[
          ["Earned", fmtMins(done.reduce((s, t) => s + t.credits, 0)), earn.terra],
          ["Tasks done", `${done.length}`, earn.sage],
        ].map(([l, v, dot]) => (
          <View key={l} style={{
            flex: 1,
            paddingVertical: 18, paddingHorizontal: 16,
            backgroundColor: paper.card,
            borderRadius: 22,
            borderWidth: 1, borderColor: ink.hairline,
          }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot }} />
              <Text style={{ fontFamily: FF.kicker, fontSize: 9, color: ink.faint, letterSpacing: 1.6 }}>
                {l.toUpperCase()}
              </Text>
            </View>
            <Text style={{ fontFamily: FF.display, fontSize: 32, color: ink.deep, letterSpacing: -0.5 }}>
              {v}
            </Text>
          </View>
        ))}
      </View>

      {/* Category breakdown */}
      {Object.keys(catCounts).length > 0 && (
        <View style={{
          backgroundColor: paper.card,
          borderRadius: 24, padding: 22,
          borderWidth: 1, borderColor: ink.hairline,
          marginBottom: 14,
        }}>
          <Text style={{ fontFamily: FF.kicker, fontSize: 10, color: ink.faint, letterSpacing: 2.4, marginBottom: 4 }}>
            BREAKDOWN
          </Text>
          <Text style={{ fontFamily: FF.display, fontSize: 22, color: ink.deep, letterSpacing: -0.3, marginBottom: 16 }}>
            Earned by type
          </Text>
          {Object.entries(catCounts).sort((a, b) => b[1] - a[1]).map(([cat, mins], idx, arr) => {
            const meta = CATS[cat] || { c: "#888", l: cat };
            return (
              <View key={cat} style={{
                flexDirection: "row", alignItems: "center", gap: 14,
                paddingVertical: 12,
                borderBottomWidth: idx === arr.length - 1 ? 0 : 0.5,
                borderBottomColor: ink.hairline,
              }}>
                <View style={{
                  width: 32, height: 32, borderRadius: 16,
                  alignItems: "center", justifyContent: "center",
                  backgroundColor: `${meta.c}14`,
                }}>
                  <CategoryIcon cat={cat} size={16} color={meta.c} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: FF.bodyMed, fontSize: 13, color: ink.deep, marginBottom: 4, textTransform: "capitalize" }}>
                    {cat}
                  </Text>
                  <View style={{ height: 3, backgroundColor: ink.hairline, borderRadius: 2, overflow: "hidden" }}>
                    <View style={{ height: "100%", width: `${(mins / maxCat) * 100}%`, backgroundColor: meta.c, borderRadius: 2 }} />
                  </View>
                </View>
                <Text style={{ fontFamily: FF.bodyBold, fontSize: 13, color: ink.deep }}>
                  {fmtMins(mins)}
                </Text>
              </View>
            );
          })}
        </View>
      )}

    </ScrollView>
    </View>
  );
});

// ── Shared styles ────────────────────────────────────────────
function BlockedHoursModal({ visible, rules, dark, onClose, onSave }) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;
  const [draft, setDraft] = useState(rules || []);
  const [start, setStart] = useState("10:00 PM");
  const [end, setEnd] = useState("7:00 AM");

  useEffect(() => {
    if (visible) setDraft(rules || []);
  }, [visible, rules]);

  const addRule = () => {
    const sM = timeToMins(start);
    const eM = timeToMins(end);
    if (sM == null || eM == null || sM === eM) {
      Alert.alert("Blocked hours", "Use times like 10:00 PM and 7:00 AM.");
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
      <Pressable onPress={onClose} style={s2.backdrop}>
        <Pressable onPress={(e) => e.stopPropagation?.()} style={[s2.panel, { backgroundColor: paper.card, borderColor: ink.border }]}>
          <Text style={[s2.kicker, { color: ink.faint }]}>BLOCKED HOURS</Text>
          <Text style={[s2.panelTitle, { color: ink.deep }]}>Blocked hours</Text>
          <Text style={[s2.panelText, { color: ink.mid }]}>
            Balance is 0 during these windows.
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
                  <Text style={{ fontFamily: FK, fontSize: 18, color: "#B5564B" }}>x</Text>
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
                <TimePickerButton
                  value={value}
                  onChange={setter}
                  fallback={label === "Start" ? "10:00 PM" : "7:00 AM"}
                  dark={dark}
                  theme={theme}
                  style={{
                    width: "100%",
                    paddingVertical: 12,
                    paddingHorizontal: 12,
                    borderRadius: 13,
                    backgroundColor: paper.warm,
                    borderWidth: 1,
                    borderColor: ink.border,
                  }}
                  textStyle={{
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
              <Text style={{ fontFamily: FK, fontSize: 14, color: dark ? "#16261C" : "#fff" }}>Add</Text>
            </TouchableOpacity>
          </View>

          <View style={s2.actions}>
            <TouchableOpacity onPress={onClose} style={[s2.ghostBtn, { borderColor: ink.border }]}>
              <Text style={[s2.ghostText, { color: ink.mid }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={save} style={[s2.solidBtn, { backgroundColor: earn.green }, theme.fx.glow]}>
              <Text style={[s2.solidText, { color: dark ? "#1F3A2A" : "#FAF6EE" }]}>Save</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
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
      <Pressable onPress={onClose} style={s2.backdrop}>
        <Pressable onPress={(e) => e.stopPropagation?.()} style={[s2.panel, { backgroundColor: paper.card, borderColor: ink.border }]}>
          <Text style={[s2.kicker, { color: ink.faint }]}>RECURRING TASKS</Text>
          <Text style={[s2.panelTitle, { color: ink.deep }]}>Schedule</Text>
          <Text style={[s2.panelText, { color: ink.mid }]}>
            Tasks that come back automatically.
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
                  <Text style={{ fontFamily: FK, fontSize: 18, color: "#B5564B" }}>x</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>

          <View style={s2.actions}>
            <TouchableOpacity onPress={onClose} style={[s2.ghostBtn, { borderColor: ink.border }]}>
              <Text style={[s2.ghostText, { color: ink.mid }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={save} style={[s2.solidBtn, { backgroundColor: earn.green }, theme.fx.glow]}>
              <Text style={[s2.solidText, { color: dark ? "#1F3A2A" : "#FAF6EE" }]}>Save</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
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
    backgroundColor: "rgba(11,26,17,0.55)",
    alignItems: "center",
    justifyContent: "flex-end",
    padding: 16,
  },
  panel: {
    width: "100%",
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 24,
    paddingBottom: Platform.OS === "ios" ? 32 : 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.18,
    shadowRadius: 30,
    elevation: 18,
  },
  bottomSheetPanel: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  kicker: { fontFamily: FF.kicker, fontSize: 9, letterSpacing: 2.4, marginBottom: 6 },
  panelTitle: { fontFamily: FF.display, fontSize: 30, letterSpacing: -0.4, marginBottom: 8 },
  panelText: { fontFamily: FF.body, fontSize: 13, lineHeight: 20, marginBottom: 18 },
  emptyText: { fontFamily: FF.body, fontSize: 13, marginVertical: 14 },
  amountGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 18 },
  amountPill: {
    minWidth: 72,
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
  },
  amountText: { fontFamily: FF.bodyMed, fontSize: 13 },
  actions: { flexDirection: "row", gap: 10, marginTop: 4 },
  quickActions: { alignItems: "stretch" },
  quickActionBtn: {
    flex: 1,
    height: 48,
    paddingVertical: 0,
    justifyContent: "center",
  },
  ghostBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: "center",
  },
  ghostText: { fontFamily: FF.bodyMed, fontSize: 14 },
  solidBtn: { flex: 1, borderRadius: 16, paddingVertical: 15, alignItems: "center" },
  solidText: { fontFamily: FF.bodyMed, fontSize: 14, color: "#fff" },
  progressTrack: { height: 6, borderRadius: 3, overflow: "hidden", marginBottom: 20 },
  progressFill: { height: "100%", borderRadius: 3 },
  plantStage: {
    width: 136,
    height: 136,
    borderRadius: 68,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 22,
    alignItems: "center",
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  plantGlow: {
    position: "absolute",
    width: 92,
    height: 92,
    borderRadius: 46,
    bottom: 26,
  },
  plantSoil: {
    position: "absolute",
    width: 82,
    height: 14,
    borderRadius: 999,
    bottom: 23,
  },
  plantPot: {
    width: 54,
    height: 34,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 20,
    overflow: "hidden",
  },
  plantPotLip: {
    height: 9,
    width: "100%",
  },
  plantStem: {
    position: "absolute",
    width: 6,
    height: 58,
    borderRadius: 6,
    bottom: 50,
  },
  plantLeaf: {
    position: "absolute",
    width: 34,
    height: 18,
    borderTopLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  plantLeafLeft: {
    bottom: 78,
    left: 42,
  },
  plantLeafRight: {
    bottom: 88,
    right: 42,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 20,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 0,
  },
  plantTopLeaf: {
    width: 22,
    height: 24,
    bottom: 106,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 18,
  },
  footerHint: { fontFamily: FF.body, marginTop: 14, textAlign: "center", fontSize: 11 },
});


// ── Bottom nav icons ─────────────────────────────────────────
// Custom organic icon set — warm, hand-drawn character rather than the
// default stroke-glyph look. Each carries a small filled accent so it reads
// clearly at 20px and feels intentional, not templated.

// Today → a rising sun over a horizon (the start of a fresh day)
function IconToday({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <SvgCircle cx="12" cy="13" r="3.6" fill={color} />
      <Path d="M12 3.5v2.2 M5 8l1.5 1.5 M19 8l-1.5 1.5 M3.5 13H5.5 M18.5 13h2"
        stroke={color} strokeWidth={1.9} strokeLinecap="round" />
      <Path d="M3 19.5h18" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
    </Svg>
  );
}
// Drift In → concentric ripples drawing inward to a still center (focus)
function IconDrift({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <SvgCircle cx="12" cy="12" r="9" stroke={color} strokeWidth={1.7} opacity={0.35} />
      <SvgCircle cx="12" cy="12" r="5.4" stroke={color} strokeWidth={1.8} opacity={0.65} />
      <SvgCircle cx="12" cy="12" r="2" fill={color} />
    </Svg>
  );
}
// Stats → tree growth rings radiating from a corner (accumulated growth)
function IconRings({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 20 A 15 15 0 0 1 19 5" stroke={color} strokeWidth={1.8} strokeLinecap="round" opacity={0.4} />
      <Path d="M4 20 A 10 10 0 0 1 14 10" stroke={color} strokeWidth={1.9} strokeLinecap="round" opacity={0.7} />
      <Path d="M4 20 A 5 5 0 0 1 9 15" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <SvgCircle cx="4" cy="20" r="1.4" fill={color} />
    </Svg>
  );
}
// The Grove → a little cluster of trees
function IconGrove({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* back tree (taller, lighter) */}
      <SvgCircle cx="15.5" cy="8" r="3.4" stroke={color} strokeWidth={1.8} opacity={0.55} />
      <Path d="M15.5 11v8" stroke={color} strokeWidth={1.8} strokeLinecap="round" opacity={0.55} />
      {/* front tree (rounded canopy, filled-ish) */}
      <SvgCircle cx="8.5" cy="9.5" r="4.2" fill={color} opacity={0.18} />
      <SvgCircle cx="8.5" cy="9.5" r="4.2" stroke={color} strokeWidth={1.9} />
      <Path d="M8.5 13.5v6" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
      {/* ground */}
      <Path d="M3.5 19.5h17" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
    </Svg>
  );
}
// The Lab → a propagation flask with a cutting rooting inside. Same botanical
// vocabulary as the other three (round canopy, soft fill, ground line) so the
// dock still reads as one set.
function IconLab({ color, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* flask body */}
      <Path
        d="M10 3.5v5.2L5.4 17.2a2.2 2.2 0 0 0 1.9 3.3h9.4a2.2 2.2 0 0 0 1.9-3.3L14 8.7V3.5"
        stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      />
      {/* neck lip */}
      <Path d="M9 3.5h6" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
      {/* liquid line */}
      <Path d="M7.2 15h9.6" stroke={color} strokeWidth={1.7} strokeLinecap="round" opacity={0.4} />
      {/* the cutting: stem + one leaf */}
      <Path d="M12 18.5v-4.2" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
      <SvgCircle cx="13.9" cy="12.6" r="1.9" fill={color} opacity={0.18} />
      <SvgCircle cx="13.9" cy="12.6" r="1.9" stroke={color} strokeWidth={1.6} />
    </Svg>
  );
}

// Stable no-op for callback props on memoized screens (an inline `() => {}`
// would defeat React.memo by changing identity every render).
const NOOP = () => {};

/**
 * The Grove — now two halves behind one segmented control:
 *   You     → the old Stats tab (level, streak, weekly bars, categories)
 *   Friends → the social grove (friends, challenges, plants)
 *
 * They were separate dock tabs; both answer "how am I doing", so they read
 * better as one place with a toggle than as two neighbours. Each half keeps its
 * own scrolling and empty states — this only owns the switch.
 */
function GroveTab({ half, onHalfChange, dark, statsProps, socialProps }) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;
  const onDeep = dark ? "#16261C" : "#FAF6EE";

  return (
    <View style={{ flex: 1, backgroundColor: paper.warm }}>
      <View style={{
        flexDirection: "row", gap: 6, padding: 4,
        marginHorizontal: 22,
        marginTop: Platform.OS === "ios" ? 40 : 18,
        borderRadius: 16, backgroundColor: paper.sand,
        borderWidth: 1, borderColor: ink.hairline,
      }}>
        {[{ key: "you", label: "You" }, { key: "friends", label: "Friends" }].map(opt => {
          const on = half === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              onPress={() => onHalfChange(opt.key)}
              activeOpacity={0.85}
              style={{
                flex: 1, height: 36, borderRadius: 12,
                alignItems: "center", justifyContent: "center",
                backgroundColor: on ? earn.deep : "transparent",
              }}
            >
              <Text style={{
                fontFamily: FF.bodyMed, fontSize: 13,
                color: on ? onDeep : ink.mid,
              }}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Both halves stay mounted: SocialScreen holds live challenge state and
          remounting it on every toggle would re-fetch and drop it. */}
      <View style={{ flex: 1 }}>
        <View style={{ ...StyleSheet.absoluteFillObject, opacity: half === "you" ? 1 : 0 }}
              pointerEvents={half === "you" ? "auto" : "none"}>
          <ProgressView {...statsProps} dark={dark} />
        </View>
        <View style={{ ...StyleSheet.absoluteFillObject, opacity: half === "friends" ? 1 : 0 }}
              pointerEvents={half === "friends" ? "auto" : "none"}>
          <SocialScreen {...socialProps} dark={dark} />
        </View>
      </View>
    </View>
  );
}

// Four tabs, deliberately. Stats used to have its own slot; it now lives inside
// The Grove as the "You" half, which freed this one for The Lab without
// crowding the island to five.
const TABS = [
  { id: "today",    label: "Today",     Icon: IconToday },
  { id: "driftin",  label: "Drift In",  Icon: IconDrift },
  { id: "friends",  label: "The Grove", Icon: IconGrove },
  { id: "lab",      label: "The Lab",   Icon: IconLab   },
];

// ── Root App ─────────────────────────────────────────────────
// ── Theme toggle with spin + crossfade ──────────────────────
function ThemeToggleButton({ darkMode, onToggle, color }) {
  const spin = useRef(new Animated.Value(0)).current;
  const turns = useRef(0);

  const handle = () => {
    turns.current += 1;
    Animated.spring(spin, {
      toValue: turns.current, useNativeDriver: true, damping: 11, stiffness: 120, mass: 0.9,
    }).start();
    onToggle();
  };

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] });

  return (
    <Pop onPress={handle} hitSlop={{ top: 22, bottom: 2, left: 6, right: 6 }}
      style={{ width: 38, height: 38, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={{ transform: [{ rotate }] }}>
        {darkMode ? (
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
            <SvgCircle cx="12" cy="12" r="4.5" stroke={color} strokeWidth={1.8} />
            <Path d="M12 2.5v2M12 19.5v2M4.5 4.5l1.4 1.4M18.1 18.1l1.4 1.4M2.5 12h2M19.5 12h2M4.5 19.5l1.4-1.4M18.1 5.9l1.4-1.4"
              stroke={color} strokeWidth={1.8} strokeLinecap="round" />
          </Svg>
        ) : (
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
            <Path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
              stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        )}
      </Animated.View>
    </Pop>
  );
}

// ── Bottom-nav tab with bounce-on-select + press feedback ────
function TabItem({ tab: t, active, onPress, sage, sageLo, mid }) {
  const iconScale = useRef(new Animated.Value(1)).current;
  const press     = useRef(new Animated.Value(1)).current;
  const prevActive = useRef(active);
  const animatePress = (to) => {
    press.stopAnimation();
    Animated.spring(press, {
      toValue: to,
      useNativeDriver: true,
      damping: 18,
      stiffness: 420,
      overshootClamping: true,
    }).start();
  };

  // Little upward bounce whenever this tab becomes active
  useEffect(() => {
    if (active && !prevActive.current) {
      iconScale.setValue(0.7);
      Animated.spring(iconScale, {
        toValue: 1, useNativeDriver: true, damping: 9, stiffness: 320, mass: 0.7,
      }).start();
    }
    prevActive.current = active;
  }, [active]);

  return (
    <Pressable
      onPress={onPress}
      unstable_pressDelay={0}
      onPressIn={() => animatePress(0.9)}
      onPressOut={() => animatePress(1)}
      style={{ flex: 1 }}
    >
      <Animated.View pointerEvents="none" style={{
        alignItems: "center", justifyContent: "center", gap: 4,
        paddingVertical: 9, paddingHorizontal: 4, borderRadius: 18,
        backgroundColor: active ? sageLo : "transparent",
        transform: [{ scale: press }],
      }}>
        <Animated.View style={{ transform: [{ scale: iconScale }] }}>
          <t.Icon color={active ? sage : mid} size={21} />
        </Animated.View>
        <Text numberOfLines={1} style={{
          fontFamily: active ? FF.bodyMed : FF.body,
          fontSize: 11, letterSpacing: 0.1,
          color: active ? sage : mid,
        }}>
          {t.label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Orbitron_400Regular,
    Orbitron_700Bold,
    Oswald_400Regular,
    Oswald_700Bold,
    PlayfairDisplay_400Regular,
    PlayfairDisplay_500Medium,
    PlayfairDisplay_700Bold,
    PlayfairDisplay_700Bold_Italic,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
  });

  const [screen,      setScreen]      = useState("loading");
  const [tab,         setTab]         = useState("today");
  const [tasks,       setTasks]       = useState([]);
  const [taskHistory, setTaskHistory] = useState([]);
  const [credits,     setCredits]     = useState({ balance: 0, earned: 0, spent: 0 });
  const [totalXp,     setTotalXp]     = useState(0);
  const [overlay,     setOverlay]     = useState(null);
  const [popup,       setPopup]       = useState(null);
  const [levelUp,     setLevelUp]     = useState(null);
  const [secLeft,     setSecLeft]     = useState(0);

  const [userId,         setUserId]         = useState(null);
  const [onboarding,     setOnboarding]     = useState(false);
  const [signInOnly,     setSignInOnly]     = useState(false); // returning user (skip questionnaire)
  const [appMode,        setAppMode]        = useState("personal"); // 'personal' | 'parent' | 'child'
  const [childBlockMode, setChildBlockMode] = useState("categories"); // 'categories' | 'custom'
  const [showAccount,        setShowAccount]        = useState(false);
  const [forceUpdate,        setForceUpdate]        = useState(false);
  const [updateStoreUrl,     setUpdateStoreUrl]     = useState(null);
  const [showBlockedApps,    setShowBlockedApps]    = useState(false);
  const [showBlockedHours,   setShowBlockedHours]   = useState(false);
  const [showRecurringTasks, setShowRecurringTasks] = useState(false);
  // Which half of The Grove is showing — "you" (the old Stats tab) or "friends".
  const [groveHalf, setGroveHalf] = useState("you");
  const [showAutoTasks,      setShowAutoTasks]      = useState(false);
  // The Today nudge only exists until the user acts on it: it hides as soon as
  // either feature is on, or once dismissed (dismissal is permanent).
  const [autoTasksHint,      setAutoTasksHint]      = useState(false);
  // Prefilled tasks awaiting confirmation (place arrivals / calendar imports).
  // The queue IS the source of truth — the head is whatever's on screen — so a
  // suggestion arriving while another is open can never be dropped.
  const [suggestionQueue,    setSuggestionQueue]    = useState([]);
  const [firstTimeBlockedApps, setFirstTimeBlockedApps] = useState(false);
  const [showTutorial,       setShowTutorial]       = useState(false);
  const [tutorialTargets,    setTutorialTargets]    = useState(null); // measured rects for the coachmark spotlight
  const tourReplayRef = useRef(false); // true when the tour was opened from The Lab, not signup
  const tutHeroRef = useRef(null);
  const tutAddRef  = useRef(null);
  const todayScrollRef = useRef(null); // so the tour can reset Today to the top
  const tutTabBarRef = useRef(null);
  const [showReviewPrompt,   setShowReviewPrompt]   = useState(false);
  const [showUsernameSetup,  setShowUsernameSetup]  = useState(false);
  const [showReduceTime,     setShowReduceTime]     = useState(false);
  const [showQuickGrant,     setShowQuickGrant]     = useState(false);
  const [quickGrantCount,    setQuickGrantCount]    = useState(0);
  const [userEmail,          setUserEmail]          = useState("");
  const [myUsername,         setUserName]           = useState("");
  const [screenTimeStatus,   setScreenTimeStatus]   = useState("unknown");
  const [childSwipeLocked,   setChildSwipeLocked]   = useState(false);
  const [blockedHours,       setBlockedHours]       = useState([]);
  const [blockedHoursActive, setBlockedHoursActive] = useState(false);
  const [recurringTasks,     setRecurringTasks]     = useState([]);
  const [minuteTick,         setMinuteTick]         = useState(0);
  const quickGrantDayRef = useRef(todayKey());
  const visibleTaskDayRef = useRef(todayKey());
  // Authoritative anti-duplicate / anti-resurrect guard for recurring tasks.
  // Records which recurring template ids have already been materialized OR
  // dismissed today, persisted independently of the task rows (which lose their
  // template link on a server round-trip). Shape: { day, ids: Set }.
  const recurringHandledRef = useRef({ day: todayKey(), ids: new Set() });

  // ── Pro access — everything is free for now ────────────────────────────
  const proAccess = true;
  const proAccessRef = useRef(true);
  useEffect(() => { setProStatus(true); }, []);
  const [driftInActive,  setDriftInActive]  = useState(false);
  const [darkMode,       setDarkMode]       = useState(false);

  const secRef          = useRef(0);
  const tickRef         = useRef(null);
  const tabRef          = useRef(tab);
  const driftInActRef   = useRef(driftInActive);
  const swipeBlockedRef = useRef(false);
  const levelIdxRef     = useRef(null);
  const appActiveRef    = useRef(true);   // true while app is foregrounded
  const processedAuthUrlRef = useRef("");
  useEffect(() => { tabRef.current = tab; }, [tab]);
  useEffect(() => { driftInActRef.current = driftInActive; }, [driftInActive]);

  // Mirror the latest persisted-state values into refs so any async closure
  // (intervals, timeouts, AppState handlers) can persist without clobbering
  // newer state. Fixes stale-closure overwrites of tasks/xp from the timer.
  const tasksRef       = useRef([]);
  const taskHistoryRef = useRef([]);
  const totalXpRef     = useRef(0);
  const creditsRef     = useRef({ balance: 0, earned: 0, spent: 0 });
  const userIdRef      = useRef(null);
  const appModeRef     = useRef("personal"); // gates the personal screen-time subsystem
  useEffect(() => {
    const idx = getLevelIdx(totalXp);
    if (screen !== "app") {
      levelIdxRef.current = idx;
      return;
    }
    if (levelIdxRef.current == null) {
      levelIdxRef.current = idx;
      return;
    }
    if (idx > levelIdxRef.current) {
      setLevelUp(LEVELS[idx]);
    }
    levelIdxRef.current = idx;
  }, [totalXp, screen]);
  const setChildSwipeLockedNow = useCallback((locked) => {
    const next = !!locked;
    swipeBlockedRef.current = next;
    setChildSwipeLocked(next);
  }, []);

  // ── Tab filmstrip animation ──────────────────────────────────
  // All four tabs live in a horizontal row that translates. translateX follows
  // the finger during a swipe and springs to the active tab on release, so the
  // motion always matches the direction you swiped.
  const TAB_W   = Dimensions.get("window").width;
  const tabIdx  = TABS.findIndex(t => t.id === tab);
  const slideX  = useRef(new Animated.Value(-Math.max(0, tabIdx) * TAB_W)).current;

  // Animate to the active tab whenever it changes (taps, swipe-cross, or
  // programmatic navigation like session-complete → Today).
  useEffect(() => {
    const idx = Math.max(0, TABS.findIndex(t => t.id === tab));
    Animated.spring(slideX, {
      toValue: -idx * TAB_W,
      useNativeDriver: true,
      tension: 80,
      friction: 13,
    }).start();
  }, [tab, TAB_W]);

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
      showReduceTime ||
      showQuickGrant ||
      childSwipeLocked;
  }, [driftInActive, overlay, popup, showAccount, showBlockedApps, showBlockedHours, showRecurringTasks, showReduceTime, showQuickGrant, tab, childSwipeLocked]);

  const stopTick = () => { if (tickRef.current) clearInterval(tickRef.current); };

  // Swipe between tabs — the filmstrip (slideX) tracks the finger live and
  // snaps to a neighbouring tab on release based on travel/velocity.
  const settleTab = (idx) => {
    Animated.spring(slideX, {
      toValue: -idx * TAB_W,
      useNativeDriver: true,
      tension: 80,
      friction: 13,
    }).start();
  };
  const tabSwipe = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) => {
        if (swipeBlockedRef.current) return false;
        // The Grove (friends) has swipe-to-cancel rows; don't hijack those.
        if (tabRef.current === "friends") return false;
        // Require a clearly-horizontal gesture so vertical scrolls and sliders
        // keep their own gestures.
        return Math.abs(gs.dx) > Math.abs(gs.dy) * 2.5 && Math.abs(gs.dx) > 24;
      },
      onPanResponderTerminationRequest: () => true,
      onShouldBlockNativeResponder: () => false,
      onPanResponderMove: (_, gs) => {
        if (swipeBlockedRef.current) return;
        const idx = Math.max(0, TABS.findIndex(t => t.id === tabRef.current));
        const minX = -(TABS.length - 1) * TAB_W;
        let x = -idx * TAB_W + gs.dx;
        // Rubber-band resistance past the first/last tab.
        if (x > 0)    x = x * 0.3;
        if (x < minX) x = minX + (x - minX) * 0.3;
        slideX.setValue(x);
      },
      onPanResponderRelease: (_, gs) => {
        if (swipeBlockedRef.current) return;
        const idx = Math.max(0, TABS.findIndex(t => t.id === tabRef.current));
        const last = TABS.length - 1;
        // A short flick OR a long drag both count, in the swiped direction.
        const wantNext = gs.dx < -60 || gs.vx < -0.3;
        const wantPrev = gs.dx >  60 || gs.vx >  0.3;
        let target = idx;
        if (wantNext && idx < last) target = idx + 1;
        else if (wantPrev && idx > 0) target = idx - 1;

        if (target !== idx) {
          // setTab fires the [tab] effect which springs to the new position.
          setTab(TABS[target].id);
        } else {
          // No change — snap back to where we were.
          settleTab(idx);
        }
      },
      onPanResponderTerminate: () => {
        const idx = Math.max(0, TABS.findIndex(t => t.id === tabRef.current));
        settleTab(idx);
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

  // Foreground display sync.
  //
  // When iOS native blocking is available, the DeviceActivityMonitor extension
  // counts real restricted-app usage. JS polls for native deltas and updates
  // the visible timer, but it must NOT tick down by wall clock while Drift is
  // foregrounded because that would charge time when no blocked app is in use.
  // Without native blocking (Expo Go / Android / dev), we tick the balance down
  // in real time so the timer is visibly alive and testable. We don't tick during
  // a Drift In focus session (the shield is up — you're not spending).
  useEffect(() => {
    if (screen !== "app") return;
    const tick = async () => {
      if (nativeArmedRef.current) {
        const used = await consumeUsedSeconds();
        if (used > 0) drainBy(used);
      }
      setSecLeft(secRef.current);
    };
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, [screen, drainBy]);


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
  const nativeArmedRef = useRef(false);
  const nativeArmFailedSecondsRef = useRef(null);

  const persistLastAlive = useCallback(() => {
    AsyncStorage.setItem("drift_last_alive", String(Date.now())).catch(() => {});
  }, []);

  const drainBy = useCallback((elapsedSec) => {
    if (elapsedSec <= 0) return;
    if (driftInActRef.current) return; // shield is up
    const prevSec = secRef.current;
    if (prevSec <= 0) return;
    const rem = Math.max(0, prevSec - elapsedSec);
    const usedSec = prevSec - rem;
    secRef.current = rem;
    setSecLeft(rem);
    setCredits(c => {
      const nb = rem > 0 ? Math.ceil(rem / 60) : 0;
      const usedMin = Math.floor(usedSec / 60);
      const nc = { ...c, balance: nb, balanceSec: rem, spent: Math.min(c.earned, c.spent + usedMin) };
      persist({ credits: nc });
      return nc;
    });
    // Push the spent-down balance to the server too. Without this, the server
    // still holds the pre-drain balance and resurrects it on the next launch
    // (boot restore trusts server balanceSeconds > 0 over fresher local state).
    if (userIdRef.current) {
      syncProfileStats(userIdRef.current, { balanceSeconds: rem }).catch(() => {});
    }
    // Local notifications: alert when time just ran out, or warn when crossing
    // below ~2 min. (Fires on the next drain/reconcile while the app is alive.)
    // notifyOutOfTime/notifyLowTime are latched internally, so calling them on
    // every drain tick still yields ONE notification per depletion episode.
    if (rem <= 0) {
      notifyOutOfTime();
    } else if (prevSec <= 0) {
      // Back in credit — re-arm so the next depletion notifies again.
      resetTimeNotices();
    } else if (prevSec > 120 && rem <= 120) {
      notifyLowTime(Math.ceil(rem / 60));
    }
  }, []);

  const claimPendingHealthEarn = useCallback(async () => {
    const earnedSec = await consumePendingHealthEarn();
    if (earnedSec <= 0) return;
    const earnedMin = Math.ceil(earnedSec / 60);
    const newSec = secRef.current + earnedSec;
    secRef.current = newSec;
    setSecLeft(newSec);
    setCredits(c => {
      const nc = {
        ...c,
        balance: Math.ceil(newSec / 60),
        balanceSec: newSec,
        earned: c.earned + earnedMin,
      };
      persist({ credits: nc });
      return nc;
    });
    if (userIdRef.current) {
      syncProfileStats(userIdRef.current, { balanceSeconds: newSec }).catch(() => {});
    }
    unlockAndArmBalance(newSec);
  }, []);

  // Reliability: on launch/foreground, (a) prompt once if Family Controls
  // authorization was revoked in Settings, and (b) re-arm the DeviceActivity
  // monitor if we still have a balance but the OS monitor is gone (e.g. after a
  // device reboot, which drops active monitors). Uses only existing native
  // methods — no new Swift.
  const authPromptShownRef = useRef(false);
  const reconcileMonitoring = useCallback(async () => {
    // Only personal accounts enforce the shield here. Parents are never blocked;
    // child enforcement is wired with the family economy (later phase).
    if (appModeRef.current !== "personal") return;
    if (!isNativeBlockingAvailable()) return;
    let diag;
    try { diag = await getDiagnostics(); } catch { return; }
    if (!diag) return;

    // (a) Auth revoked — prompt once (non-blocking) to re-grant. Use the
    // canonical auth status (same source the rest of the app trusts) rather than
    // diag.authStatus, whose format differs and was firing this prompt on every
    // open even when access WAS already granted.
    let authStatus = "unknown";
    try { authStatus = await getScreenTimeAuthStatus(); } catch {}
    if (authStatus !== "approved") {
      // Only prompt on a KNOWN non-approved state — never on an unknown/failed read.
      if (!authPromptShownRef.current && authStatus !== "unknown") {
        authPromptShownRef.current = true;
        Alert.alert(
          "Screen Time access needed",
          "Drift can't block apps until you re-enable Screen Time access in Settings → Screen Time.",
          [
            { text: "Later", style: "cancel" },
            { text: "Open Settings", onPress: () => { try { Linking.openSettings?.(); } catch {} } },
          ],
        );
      }
      return; // can't arm without authorization
    }
    authPromptShownRef.current = false; // reset once access is back

    // (b) Re-arm if a positive balance exists but no balance monitor is active.
    if (driftInActRef.current || blockedHoursActive) return; // these manage the shield themselves
    const sec = Math.max(0, secRef.current);
    const monitors = Array.isArray(diag.activeMonitors) ? diag.activeMonitors : [];
    if (sec > 0 && !monitors.includes("drift.balance")) {
      startBalanceMonitoring(sec).catch(() => {});
    }
  }, [blockedHoursActive]);

  // 1. Heartbeat while foregrounded — every 15s, write "I'm alive" timestamp
  useEffect(() => {
    if (screen !== "app") return;
    persistLastAlive();
    const id = setInterval(persistLastAlive, 15_000);
    return () => clearInterval(id);
  }, [screen, persistLastAlive]);

  // 2. AppState transitions: drain on foregrounding, stamp on backgrounding
  useEffect(() => {
    const sub = AppState.addEventListener("change", async (next) => {
      if (next !== "active") {
        appActiveRef.current = false;
        bgTimeRef.current = Date.now();
        persistLastAlive();
        stopTick();
      } else {
        appActiveRef.current = true;
        if (bgTimeRef.current && screen === "app") {
          const bgStart = bgTimeRef.current;
          bgTimeRef.current = null;
          // Retry any balance/XP writes that failed while offline.
          if (userIdRef.current) flushPendingStats(userIdRef.current).catch(() => {});
          if (nativeArmedRef.current) {
            const used = await consumeUsedSeconds();
            if (used > 0) {
              drainBy(used);
            } else {
              // Checkpoints only fire every 15min; for shorter bg stints,
              // fall back to wall-clock so the timer visibly moves.
              const elapsedSec = Math.floor((Date.now() - bgStart) / 1000);
              if (elapsedSec > 0) drainBy(elapsedSec);
            }
          } else {
            const elapsedSec = Math.floor((Date.now() - bgStart) / 1000);
            drainBy(elapsedSec);
          }
          if (appModeRef.current === "personal" && secRef.current <= 0 && shieldStateRef.current !== "on") {
            await applyBlocking([], { freeTier: !proAccessRef.current }).catch(() => {});
            shieldStateRef.current = "on";
          }
          persistLastAlive();
        }
      }
    });
    return () => { sub.remove(); stopTick(); };
  }, [screen, drainBy, persistLastAlive]);

  // 3. Launch-time catch-up: app just opened — drain by actual blocked-app usage
  // (native) or wall-clock delta (fallback when native unavailable).
  const launchDrainRanRef = useRef(false);
  useEffect(() => {
    if (screen !== "app" || launchDrainRanRef.current) return;
    launchDrainRanRef.current = true;
    (async () => {
      try {
        const lastStr = await AsyncStorage.getItem("drift_last_alive");
        const last = lastStr ? parseInt(lastStr, 10) : null;
        if (nativeArmedRef.current) {
          const used = await consumeUsedSeconds();
          if (used > 0) {
            drainBy(used);
          } else if (Number.isFinite(last)) {
            const elapsedSec = Math.floor((Date.now() - last) / 1000);
            const capped = Math.min(Math.max(0, elapsedSec), 86_400);
            if (capped > 0) drainBy(capped);
          }
        } else {
          if (!last || !Number.isFinite(last)) { persistLastAlive(); return; }
          const elapsedSec = Math.floor((Date.now() - last) / 1000);
          const capped = Math.min(Math.max(0, elapsedSec), 86_400);
          if (capped > 0) drainBy(capped);
        }
        if (appModeRef.current === "personal" && secRef.current <= 0 && shieldStateRef.current !== "on") {
          await applyBlocking([], { freeTier: !proAccessRef.current }).catch(() => {});
          shieldStateRef.current = "on";
        }
        persistLastAlive();
      } catch {}
    })();
  }, [screen, drainBy, persistLastAlive]);

  useEffect(() => {
    AsyncStorage.getItem("drift_dark_mode").then(v => {
      if (v === "1") setDarkMode(true);
      // Push the restored theme to the App Group at every boot so the shield
      // stays in sync even for users who never touch the toggle again.
      setAppearance(v === "1").catch(() => {});
    });
  }, []);

  const refreshQuickGrantCount = useCallback(async () => {
    const day = todayKey();
    quickGrantDayRef.current = day;
    const raw = await AsyncStorage.getItem(`drift_quick_grants_${day}`).catch(() => "0");
    const count = Number(raw || 0);
    setQuickGrantCount(Number.isFinite(count) ? Math.max(0, Math.min(3, count)) : 0);
  }, []);

  useEffect(() => {
    refreshQuickGrantCount();

    const checkForNewDay = () => {
      if (todayKey() !== quickGrantDayRef.current) refreshQuickGrantCount();
    };

    const id = setInterval(checkForNewDay, 60_000);
    const sub = AppState.addEventListener("change", state => {
      if (state === "active") refreshQuickGrantCount();
    });

    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [refreshQuickGrantCount]);

  useEffect(() => {
    if (screen !== "app") return;
    const refreshVisibleTasksForDay = async () => {
      const day = todayKey();
      if (day === visibleTaskDayRef.current) return;
      visibleTaskDayRef.current = day;
      const allCached = userId ? await cache.loadTasks(userId).catch(() => []) : tasks;
      setTasks(collapseDuplicateTasks((allCached || []).filter(t => isTodayTask(t, day))).kept);
    };
    const id = setInterval(refreshVisibleTasksForDay, 60_000);
    return () => clearInterval(id);
  }, [screen, userId, tasks]);

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

  // Hydrate the persisted per-day recurring guard when the user changes.
  // `recurringGuardReady` gates the materialize effect so it can't run against
  // an empty guard before the persisted dismissals have loaded (which would
  // briefly resurrect a deleted-for-the-day task on cold boot).
  const [recurringGuardReady, setRecurringGuardReady] = useState(false);
  useEffect(() => {
    setRecurringGuardReady(false);
    if (!userId) { recurringHandledRef.current = { day: todayKey(), ids: new Set() }; return; }
    AsyncStorage.getItem(`drift_recurring_handled_${userId}`).then(raw => {
      const today = todayKey();
      try {
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && parsed.day === today && Array.isArray(parsed.ids)) {
          recurringHandledRef.current = { day: today, ids: new Set(parsed.ids) };
        } else {
          recurringHandledRef.current = { day: today, ids: new Set() };
        }
      } catch {
        recurringHandledRef.current = { day: today, ids: new Set() };
      }
    }).catch(() => {}).finally(() => setRecurringGuardReady(true));
  }, [userId]);

  // Mark recurring template ids as handled for today (materialized OR dismissed)
  // so they won't be (re-)created for the rest of the day. Persisted so it
  // survives reopen and doesn't depend on the task rows keeping their template
  // link (which the server round-trip strips).
  const markRecurringHandled = useCallback((templateIds) => {
    const today = todayKey();
    const rec = recurringHandledRef.current;
    if (rec.day !== today) { rec.day = today; rec.ids = new Set(); }
    let changed = false;
    for (const id of templateIds) { if (id && !rec.ids.has(id)) { rec.ids.add(id); changed = true; } }
    if (changed && userId) {
      AsyncStorage.setItem(`drift_recurring_handled_${userId}`, JSON.stringify({ day: today, ids: [...rec.ids] })).catch(() => {});
    }
  }, [userId]);

  useEffect(() => {
    if (screen !== "app" || !userId || !proAccess || !recurringTasks.length) return;
    if (!recurringGuardReady) return; // wait for persisted dismissals to load
    const today = todayKey();
    // Reset the guard on a new day so today's occurrences can appear.
    const rec = recurringHandledRef.current;
    if (rec.day !== today) { rec.day = today; rec.ids = new Set(); }
    // Dedup against active tasks + completed history for today as a first pass…
    const existingRecurring = new Set(
      [...tasks, ...taskHistory]
        .filter(t => t.recurringTemplateId && t.task_date === today)
        .map(t => `${t.recurringTemplateId}_${t.task_date}`)
    );
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const RECURRING_APPEAR_MINS = 5 * 60; // 5:00 AM
    // NOTE: the checks below are optimistic-UI only — they avoid a row that
    // would flash in and vanish. The actual "one instance per template per day"
    // invariant is enforced by the tasks_one_instance_per_template_per_day
    // unique index; anything that slips past here is rejected on insert and
    // pruned. Do not add another local guard: that's what failed before.
    const due = recurringTasks
      .filter(t => t?.enabled !== false)
      .filter(t => t.createdDate !== today)
      .filter(t => recurrenceMatchesDate(t, now))
      // Appear from 5am for the day, regardless of the template's own "time"
      // (which is now display-only). The schedule decides WHICH days a task
      // recurs; 5am decides WHEN it shows up that day.
      .filter(() => nowMins >= RECURRING_APPEAR_MINS)
      .filter(t => !existingRecurring.has(`${t.id}_${today}`))
      // …but the persisted guard is the authority: if a template was already
      // materialized OR dismissed today, never re-create it. This is what keeps
      // a deleted-for-the-day task from resurrecting and stops the duplicate
      // pile-up when a sync strips the template link off the task rows.
      .filter(t => !rec.ids.has(t.id));
    if (!due.length) return;

    const created = due.map(t => ({
      id: makeUuid(),
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
    markRecurringHandled(due.map(t => t.id));
    const nt = [...created, ...tasks];
    setTasks(nt);
    persist({ tasks: nt });
    cacheFullTasks(userId, nt);
    // The database is the arbiter of "one instance per template per day". If the
    // unique index rejects our insert, this template was already materialized
    // today (possibly by an earlier launch whose local guard we couldn't see) —
    // so drop the optimistic copy rather than leave a row that exists nowhere
    // but on this device.
    created.forEach(t => insertTask(userId, t).then(res => {
      if (!res?.duplicate) return;
      setTasks(prev => {
        const pruned = prev.filter(x => x.id !== t.id);
        persist({ tasks: pruned });
        return pruned;
      });
      cache.loadTasks(userId)
        .then(all => cache.saveTasks(userId, (all || []).filter(x => x.id !== t.id)))
        .catch(() => {});
    }).catch(e => {
      console.warn("recurring task sync failed:", e?.message);
    }));
  }, [screen, userId, proAccess, recurringTasks, tasks, taskHistory, minuteTick, markRecurringHandled, recurringGuardReady]);

  // Shared path for password sign-in, OAuth sign-in, and verified email links.
  const ONBOARDING_TASKS = {
    make_bed:         { title: "Make your bed",        cat: "life",        minutes: 2 },
    workout:          { title: "Work out",             cat: "physical",    minutes: 30 },
    read:             { title: "Read",                 cat: "learning",    minutes: 20 },
    meditate:         { title: "Meditate",             cat: "life",        minutes: 10 },
    journal:          { title: "Journal",              cat: "life",        minutes: 10 },
    walk:             { title: "Go for a walk",        cat: "outdoor",     minutes: 15 },
    clean:            { title: "Clean / tidy up",      cat: "life",        minutes: 15 },
    study:            { title: "Study",                cat: "learning",    minutes: 30 },
    cook:             { title: "Cook a meal",          cat: "life",        minutes: 20 },
    stretch:          { title: "Stretch",              cat: "physical",    minutes: 5 },
    no_phone_morning: { title: "No phone for 1 hour",  cat: "life",        minutes: 60 },
    practice:         { title: "Practice a skill",     cat: "learning",    minutes: 20 },
  };

  // Server-authoritative task restore. Mirrors the boot path so an IN-APP
  // sign-in (which does not remount the component) rehydrates tasks + history
  // exactly like a cold launch. Without this, signing out and back in leaves
  // the task list empty until the app is fully restarted.
  const hydrateTasksFromServer = useCallback(async (uid) => {
    if (!uid) return false;
    const deletedIds = await loadDeletedIds(uid).catch(() => new Set());
    let cachedTasks = [];
    try {
      cachedTasks = (await cache.loadTasks(uid)).filter(t => !deletedIds.has(t.id));
    } catch {}
    try {
      const remote = await fetchTasks(uid);
      if (!remote) return false;
      // Re-attach client-only fields (e.g. recurringTemplateId) that the server
      // doesn't store, so materialized recurring instances keep their identity.
      const remoteHydrated = rehydrateClientFields(remote, cachedTasks);
      const today = remoteHydrated.filter(t => isTodayTask(t) && !deletedIds.has(t.id));
      const remoteIds = new Set(remoteHydrated.map(t => t.id));
      const localOnly = cachedTasks.filter(t => !remoteIds.has(t.id) && isTodayTask(t));
      // Collapse any leftover duplicate instances from the old dedup bug and
      // tombstone the extras so they stop coming back.
      const { kept: merged, removedIds: dupeIds } = collapseDuplicateTasks([...today, ...localOnly]);
      setTasks(merged);
      cache.saveTasks(uid, mergeTaskRecords(cachedTasks, remoteHydrated, localOnly)
        .filter(t => !dupeIds.includes(t.id)));
      dupeIds.forEach(dupId => {
        addDeletedId(uid, dupId).catch(() => {});
        softDeleteTask(uid, dupId).catch(() => {});
      });
      // remoteHydrated, not remote: the raw rows have no recurringTemplateId
      // (it's a client-only field), and history is one of the inputs to the
      // recurring dedup check — raw rows there make completed recurring tasks
      // invisible to it, so they get materialized a second time.
      const allDone = remoteHydrated.filter(t => t.done);
      setTaskHistory(prev => mergeCompletedTasks(prev, allDone));
      // Retry-sync any local-only tasks now that we're online.
      for (const lt of localOnly) {
        try {
          const saved = await insertTask(uid, lt);
          // Rejected by the per-template-per-day index: the server already has
          // this occurrence under another id. Tombstone our copy so it stops
          // being retried (and re-rendered) on every launch.
          if (saved?.duplicate) {
            setTasks(prev => prev.filter(t => t.id !== lt.id));
            addDeletedId(uid, lt.id).catch(() => {});
            continue;
          }
          if (saved?.id && saved.id !== lt.id) {
            setTasks(prev => prev.map(t => t.id === lt.id ? { ...t, id: saved.id } : t));
          }
        } catch (e) { console.warn("retry insertTask:", e?.message); }
      }
      // Report whether the account actually HAS tasks (not just that the fetch
      // succeeded) — the caller uses this to decide whether to seed onboarding
      // picks. A brand-new account returns false here so seeding still runs.
      return remote.length > 0 || merged.length > 0;
    } catch (e) { console.warn("hydrateTasksFromServer:", e?.message); return false; }
  }, []);

  const completeAuthenticatedUser = useCallback(async (user, answers = {}) => {
    const authUser = user?.id ? user : (await safeGetSession())?.data?.session?.user;
    if (!authUser?.id) return;
    // Phone users confirm via SMS OTP (phone_confirmed_at), email users via
    // email link/code (email_confirmed_at). confirmed_at covers either, but we
    // check all three so neither method is wrongly treated as unverified.
    const isVerified = !!(authUser.email_confirmed_at || authUser.phone_confirmed_at || authUser.confirmed_at);
    if (!isVerified) {
      await supabase.auth.signOut().catch(() => {});
      Alert.alert("Verify your account", "Confirm your email or phone number before continuing.");
      return;
    }

    setUserId(authUser.id);
    setUserEmail(authUser.email ?? "");
    // Persist the pre-signup onboarding answers for analytics (fire-and-forget).
    saveOnboardingResponses(authUser.id, answers).catch(() => {});
    // Load level/stats immediately so they show on FIRST login. Previously only
    // the boot path loaded these, so a fresh sign-in showed zeros until the app
    // was closed and reopened.
    try {
      const stats = await fetchProfileStats(authUser.id);
      if (stats?.totalXp > 0) {
        // Re-baseline the level tracker BEFORE the XP lands. Sign-in sets
        // screen="app" while totalXp is still 0, so the jump from 0 to the
        // user's real XP looked like a level gain and popped the level-up
        // modal at every login. Seeding the ref here makes hydration a
        // no-op; only XP earned after this point can celebrate.
        levelIdxRef.current = getLevelIdx(stats.totalXp);
        setTotalXp(prev => Math.max(prev, stats.totalXp));
      }
      if (stats?.balanceSeconds > 0) {
        setCredits({
          balance: Math.ceil(stats.balanceSeconds / 60),
          balanceSec: stats.balanceSeconds,
          earned: Math.ceil(stats.balanceSeconds / 60),
          spent: 0,
        });
        secRef.current = stats.balanceSeconds;
        setSecLeft(stats.balanceSeconds);
      }
    } catch {}
    let acctType = answers?.account_type || "personal";
    try {
      const { data: prof } = await cached(`drift_profile_${authUser.id}`, 30_000, () =>
        supabase
          .from("profiles").select("username, account_type").eq("id", authUser.id).maybeSingle()
      );
      // Server is the source of truth for account type (immutable once set).
      if (prof?.account_type) acctType = prof.account_type;
      if (prof?.username) {
        setUserName(prof.username);
        AsyncStorage.setItem("drift_username", prof.username);
        // OAuth/Google users get a placeholder ("drifter" + random) from the DB
        // trigger. Force personal/parent users through username setup so nobody
        // is left as "drifter____". Children keep their auto username (they're
        // shown by display name), so never prompt them.
        if (acctType !== "child" && /^drifter[a-z0-9]{6,}$/i.test(prof.username)) {
          setShowUsernameSetup(true);
        }
      } else if (acctType !== "child") {
        // No profile row / username at all — also force setup (non-children).
        setShowUsernameSetup(true);
      }
    } catch {}
    setAppMode(acctType);
    setOnboarding(false);
    setSignInOnly(false);
    const hadOnboarded = await AsyncStorage.getItem("drift_onboarded");
    await AsyncStorage.setItem("drift_onboarded", "1");

    // Personal accounts restore/seed their own task list and pick blocked apps.
    // Parent (management) and child accounts use their own shells and skip all
    // of this — their task/economy plumbing is handled there.
    if (acctType === "personal") {
      // Restore existing tasks from the server on every sign-in (returning user
      // or new device). For a brand-new account it's a cheap no-op.
      const hadRemoteTasks = await hydrateTasksFromServer(authUser.id);
      const pickedTasks = answers?.tasks || [];
      if (pickedTasks.length > 0 && !hadOnboarded && !hadRemoteTasks) {
        const seeded = pickedTasks
          .filter(id => ONBOARDING_TASKS[id])
          .map(id => {
            const t = ONBOARDING_TASKS[id];
            const credits = capReward(Math.max(1, Math.round(t.minutes * 0.6)), t.minutes);
            return {
              id: makeUuid(),
              title: t.title,
              cat: t.cat,
              minutes: t.minutes,
              done: false,
              credits,
              xp: Math.max(1, Math.round(t.minutes * 0.4)),
              aiCheck: false,
              aiValued: false,
              aiReasoning: "",
              task_date: todayKey(),
            };
          });
        if (seeded.length > 0) {
          setTasks(seeded);
          persist({ tasks: seeded });
          seeded.forEach(t => insertTask(authUser.id, t).catch(() => {}));
          cacheFullTasks(authUser.id, seeded);
        }
      }
    }
    setScreen("app");
    if (acctType === "personal" && !hadOnboarded && !signInOnly) {
      setFirstTimeBlockedApps(true);
      setShowBlockedApps(true);
    }
  }, [signInOnly]);

  // Supabase email confirmation links open here before a user is signed in.
  // Deep-link friend invites — drift://add-friend/[username]
  useEffect(() => {
    const handleAuthUrl = async (url) => {
      if (!url || processedAuthUrlRef.current === url) return;
      const result = await handleSupabaseAuthCallback(url);
      if (!result.handled) return;
      processedAuthUrlRef.current = url;
      if (result.error) {
        Alert.alert("Could not verify email", result.error.message || "Open the latest verification email and try again.");
        return;
      }
      await completeAuthenticatedUser(result.user);
    };
    Linking.getInitialURL().then(handleAuthUrl);
    const sub = Linking.addEventListener("url", ({ url }) => handleAuthUrl(url));
    return () => sub.remove();
  }, [completeAuthenticatedUser]);

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
    // Wait until we know the user — consumeDepletedFlag() clears the native
    // flag on read, so if we ran before userId loaded we'd consume it without
    // being able to sync balanceSeconds:0 to the server, and the stale server
    // balance would resurrect on the next launch.
    if (!userId) return;
    // Register iOS Background App Refresh so iOS can wake us opportunistically
    // to reconcile the balance even between foregrounds (complements the
    // DeviceActivityMonitor extension; see backgroundRefresh.js).
    registerBackgroundRefresh().catch(() => {});
    // Ask for notification permission (once) and (re)schedule the daily
    // earn/streak reminder.
    requestNotificationPermission().then((ok) => { if (ok) scheduleDailyReminder(); }).catch(() => {});
    // On launch / each foreground, first flush any balance write that failed
    // while offline so the server can't resurrect a stale balance.
    flushPendingStats(userId).catch(() => {});
    claimPendingHealthEarn().catch(() => {});
    reconcileMonitoring();
    const sync = async () => {
      await claimPendingHealthEarn().catch(() => {});
      reconcileMonitoring();
      const depleted = await consumeDepletedFlag();
      if (!depleted) return;
      secRef.current = 0;
      setSecLeft(0);
      await AsyncStorage.multiRemove(["drift_last_armed_seconds", "drift_last_armed_balance"]).catch(() => {});
      setLastArmedSeconds(-1);
      setCredits(c => {
        const nc = { ...c, balance: 0, balanceSec: 0,
          spent: Math.min(c.earned, c.spent + (c.balance || 0)) };
        persist({ credits: nc });
        return nc;
      });
      // Mirror the depletion to the server so the boot restore doesn't bring
      // the balance back from a stale balanceSeconds on the next launch.
      syncProfileStats(userId, { balanceSeconds: 0 }).catch(() => {});
      // The extension drained us to zero while away — tell the user.
      notifyOutOfTime();
    };
    sync();
    const sub = AppState.addEventListener("change", n => { if (n === "active") sync(); });
    return () => sub.remove();
  }, [userId, reconcileMonitoring, claimPendingHealthEarn]);

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
  const [lastArmedSeconds, setLastArmedSeconds] = useState(null);
  useEffect(() => {
    AsyncStorage.getItem("drift_last_armed_seconds").then(v => {
      const val = v != null ? Number(v) : -1;
      setLastArmedSeconds(val);
      nativeArmedRef.current = isNativeBlockingAvailable() && val > 0;
    });
  }, []);
  useEffect(() => {
    nativeArmedRef.current = isNativeBlockingAvailable() && lastArmedSeconds > 0;
  }, [lastArmedSeconds]);

  useEffect(() => {
    // The personal balance→shield mapping never runs for family accounts in
    // Phase 1 (parents are never blocked; child enforcement comes later).
    if (appMode !== "personal") return;
    if (driftInActive) return; // session handler controls shield
    if (blockedHoursActive) {
      (async () => {
        try {
          await stopBalanceMonitoring();
          await applyBlocking([], { freeTier: !proAccessRef.current });
          if (lastArmedSeconds !== -1) {
            await AsyncStorage.multiRemove(["drift_last_armed_seconds", "drift_last_armed_balance"]);
            setLastArmedSeconds(-1);
          }
          shieldStateRef.current = "on";
        } catch {}
      })();
      return;
    }
    if (lastArmedSeconds === null) return; // waiting for AsyncStorage

    const desired = credits.balance > 0 ? "off" : "on";
    const prevState = shieldStateRef.current;

    (async () => {
      try {
        if (desired === "on") {
          if (prevState !== "on") {
            await stopBalanceMonitoring();
            await applyBlocking([], { freeTier: !proAccessRef.current });
            if (lastArmedSeconds !== -1) {
              await AsyncStorage.multiRemove(["drift_last_armed_seconds", "drift_last_armed_balance"]);
              setLastArmedSeconds(-1);
            }
          }
        } else {
          if (prevState !== "off") await clearBlocking();

          // (Re)arm iOS only when balance went UP — never on launch with the
          // same balance we previously armed for, because iOS already has a
          // monitor running and re-arming would reset its cumulative counter.
          const seconds = typeof credits.balanceSec === "number"
            ? credits.balanceSec
            : credits.balance * 60;
          const currentSeconds = Math.max(60, Math.floor(seconds));
          const shouldArm = lastArmedSeconds === -1 || currentSeconds !== lastArmedSeconds;
          if (shouldArm) {
            if (nativeArmFailedSecondsRef.current === currentSeconds) return;
            // Pass exact seconds so iOS's threshold matches the displayed
            // balance — passing minutes rounds the threshold up.
            let res = await startBalanceMonitoring(seconds);
            if (res?.started === false && !/unavailable/i.test(res.reason || "")) {
              res = await startBalanceMonitoring(seconds);
            }
            if (res?.started === false) {
              nativeArmFailedSecondsRef.current = currentSeconds;
            } else {
              nativeArmFailedSecondsRef.current = null;
              await AsyncStorage.setItem("drift_last_armed_seconds", String(currentSeconds));
              await AsyncStorage.removeItem("drift_last_armed_balance");
              setLastArmedSeconds(currentSeconds);
            }
          }
        }
        shieldStateRef.current = desired;
      } catch {}
    })();
  }, [appMode, credits.balance, credits.balanceSec, driftInActive, blockedHoursActive, lastArmedSeconds]);

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

  // Measure the real on-screen targets (balance hero, Add-task button, tab bar)
  // when the post-signup tutorial opens, so the coachmark overlay can spotlight
  // each element exactly. Falls back to region anchoring if a measure fails.
  useEffect(() => {
    if (!showTutorial) { setTutorialTargets(null); return; }
    // Reset Today to the top first. The spotlight rects are absolute screen
    // coordinates, so replaying the tour on a scrolled-down Today put the
    // holes over whatever happened to be at those positions. Scrolling here
    // (before the measure delay below) means we measure the settled layout.
    try { todayScrollRef.current?.scrollTo?.({ y: 0, animated: true }); } catch {}
    const measure = (ref) => new Promise((resolve) => {
      const node = ref?.current;
      if (!node?.measureInWindow) return resolve(null);
      try {
        node.measureInWindow((x, y, w, h) => {
          if ([x, y, w, h].some(n => typeof n !== "number" || Number.isNaN(n)) || w <= 0 || h <= 0) return resolve(null);
          resolve({ x, y, w, h });
        });
      } catch { resolve(null); }
    });
    // Delay so the tour's targets (and the tab-bar slide) have settled.
    const t = setTimeout(async () => {
      const [balance, measuredAdd, pill] = await Promise.all([
        measure(tutHeroRef), measure(tutAddRef), measure(tutTabBarRef),
      ]);

      // Reject a measurement that spans most of the screen. The Add button is
      // a small pill on the right of a space-between row, so a near-full-width
      // rect means we measured the row — which is what put the spotlight over
      // the "TODAY" kicker. Better to skip the highlight (the step still shows,
      // fully dimmed) than to point confidently at the wrong thing.
      const SCREEN_W = Dimensions.get("window").width;
      const add = (measuredAdd && measuredAdd.w > 0 && measuredAdd.w < SCREEN_W * 0.6)
        ? measuredAdd
        : null;
      let tabs = null;
      if (pill) {
        // The pill has 8px inner padding and 4 equal tab columns.
        const innerX = pill.x + 8, innerW = pill.w - 16;
        const colW = innerW / TABS.length;
        tabs = TABS.map((_, idx) => ({
          x: innerX + idx * colW,
          y: pill.y + 6,
          w: colW,
          h: pill.h - 12,
        }));
      }
      setTutorialTargets({ balance, add, tabs });
      // 380ms was enough for just the tab slide, but the scroll-to-top above
      // animates for ~300ms of its own — measuring at 380 would capture the
      // layout mid-scroll and misplace every hole.
    }, 560);
    return () => clearTimeout(t);
  }, [showTutorial]);

  const toggleDark = () => {
    setDarkMode(d => {
      const next = !d;
      AsyncStorage.setItem("drift_dark_mode", next ? "1" : "0");
      // Mirror into the App Group so the shield matches the in-app theme.
      setAppearance(next).catch(() => {});
      return next;
    });
  };

  // Mandatory-update gate: compare the installed version to the remote minimum
  // (app_config.min_ios_version). If older, block the app behind ForceUpdateModal.
  // Re-checks on foreground so a user who updates the requirement mid-session is
  // caught. Fails open (never blocks) if the config can't be read.
  useEffect(() => {
    const check = async () => {
      try {
        const current = Constants.expoConfig?.version || Constants.manifest?.version;

        // 1) AUTOMATIC: any newer version live on the App Store is mandatory —
        //    the moment we ship an update, older installs get blocked until they
        //    update. Only in real production iOS builds (skip Expo Go / dev so
        //    it doesn't nag us while developing).
        const isExpoGo = Constants.appOwnership === "expo";
        if (Platform.OS === "ios" && !__DEV__ && !isExpoGo) {
          // The App Store lookup MUST use the real native bundle id. This is a
          // bare/prebuilt project, so the signed app is `com.sanghani.drift`
          // (see ios/*.xcodeproj) — not app.json's historical `com.drift.app`.
          // A wrong id makes iTunes return nothing → force-update never fires.
          const bundleId = Constants.expoConfig?.ios?.bundleIdentifier
            || Constants.manifest?.ios?.bundleIdentifier || "com.sanghani.drift";
          const store = await fetchAppStoreLatest(bundleId);
          if (store?.version && isVersionOutdated(current, store.version)) {
            setUpdateStoreUrl(store.url || null);
            setForceUpdate(true);
            return;
          }
        }

        // 2) MANUAL override via app_config.min_ios_version — force a specific
        //    minimum (e.g. an emergency hotfix) even beyond the App Store check.
        const cfg = await getAppConfig();
        if (cfg.min_ios_version && isVersionOutdated(current, cfg.min_ios_version)) {
          setUpdateStoreUrl(cfg.ios_store_url || null);
          setForceUpdate(true);
        }
      } catch {}
    };
    check();
    const sub = AppState.addEventListener("change", s => { if (s === "active") check(); });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await safeGetSession();
        const uid = session?.user?.id ?? null;
        const cachedVerified = !!(session?.user?.email_confirmed_at || session?.user?.phone_confirmed_at || session?.user?.confirmed_at);
        if (uid && !cachedVerified) {
          // OAuth users (Google, Apple) are always verified — they authenticated
          // with the provider. Only check email verification for email/password
          // signups. The cached session often lacks confirmed_at on cold start;
          // signing out on that false negative is the #1 cause of unwanted logouts.
          const provider = session?.user?.app_metadata?.provider;
          const isOAuth = provider && provider !== "email";
          if (!isOAuth) {
            let serverUnverified = false;
            try {
              const { data: u, error } = await supabase.auth.getUser();
              if (!error && u?.user) {
                serverUnverified = !(u.user.email_confirmed_at || u.user.phone_confirmed_at || u.user.confirmed_at);
              }
            } catch {}
            if (serverUnverified) {
              await supabase.auth.signOut().catch(() => {});
              setUserId(null);
              setUserEmail("");
              setUserName("");
              const hasOnboarded = await AsyncStorage.getItem("drift_onboarded");
              setSignInOnly(hasOnboarded === "1");
              setOnboarding(true);
              return;
            }
          }
        }
        setUserId(uid);
        setUserEmail(session?.user?.email ?? "");
        let bootAcctType = "personal";
        if (uid) {
          try {
            const { data: prof, error: pErr } = await cached(`drift_profile_${uid}`, 30_000, () =>
              supabase
                .from("profiles").select("username, account_type").eq("id", uid).maybeSingle()
            );
            if (pErr) console.warn("profile fetch:", pErr.message);
            if (prof?.account_type) bootAcctType = prof.account_type;
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
        setAppMode(bootAcctType);
        // Parent (management) and child accounts render their own shells and
        // manage their own data. Children still need their balance restored so
        // the Screen-Time shield reflects any time their parent has granted.
        if (bootAcctType !== "personal") {
          if (bootAcctType === "child") {
            try {
              const stats = await fetchProfileStats(uid);
              if (stats.balanceSeconds > 0) {
                setCredits({
                  balance: Math.ceil(stats.balanceSeconds / 60),
                  balanceSec: stats.balanceSeconds,
                  earned: Math.ceil(stats.balanceSeconds / 60),
                  spent: 0,
                });
                secRef.current = stats.balanceSeconds;
                setSecLeft(stats.balanceSeconds);
              }
            } catch (e) { console.warn("child balance restore:", e?.message); }
          }
          setScreen("app");
          return;
        }
        // ── Server-authoritative state: tasks come from Supabase ──
        // Boot order: show cached state instantly, then refresh from server.
        let remoteTasksApplied = false;
        let cachedTasks = [];
        let cachedXp = 0;
        // Deleted-task tombstone — never resurrect a locally-deleted task.
        const deletedIds = await loadDeletedIds(uid);
        try {
          cachedTasks = (await cache.loadTasks(uid)).filter(t => !deletedIds.has(t.id));
          // Collapse duplicates for the instant paint too, so the user never
          // sees the repeated rows flash before the remote sync tidies them.
          const cachedToday = collapseDuplicateTasks(cachedTasks.filter(t => isTodayTask(t))).kept;
          if (cachedToday.length) setTasks(cachedToday);
          cachedXp = await cache.loadXp(uid);
          if (cachedXp) setTotalXp(prev => Math.max(prev, cachedXp));
        } catch {}
        try {
          const remote = await fetchTasks(uid);
          if (remote) {
            // Re-attach client-only fields the server doesn't store (see above).
            const remoteHydrated = rehydrateClientFields(remote, cachedTasks);
            // Only show tasks from today (matches the existing "today's work" model)
            const today = remoteHydrated.filter(t => isTodayTask(t) && !deletedIds.has(t.id));

            // Merge in any local-only tasks (created while offline and not yet synced).
            // We identify local-only tasks by ID not appearing in the remote set.
            const remoteIds = new Set(remoteHydrated.map(t => t.id));
            const localOnly = (cachedTasks.length ? cachedTasks : await cache.loadTasks(uid).catch(() => []))?.filter(
              t => !remoteIds.has(t.id) && isTodayTask(t)
            ) || [];
            // Collapse leftover duplicates from the old bug; tombstone extras.
            const { kept: merged, removedIds: dupeIds } = collapseDuplicateTasks([...today, ...localOnly]);

            setTasks(merged);
            cache.saveTasks(uid, mergeTaskRecords(cachedTasks, remoteHydrated, localOnly)
              .filter(t => !dupeIds.includes(t.id)));
            dupeIds.forEach(dupId => {
              addDeletedId(uid, dupId).catch(() => {});
              softDeleteTask(uid, dupId).catch(() => {});
            });
            remoteTasksApplied = true;
            // Build history from completed tasks across all dates
            // remoteHydrated, not remote: the raw rows have no recurringTemplateId
      // (it's a client-only field), and history is one of the inputs to the
      // recurring dedup check — raw rows there make completed recurring tasks
      // invisible to it, so they get materialized a second time.
      const allDone = remoteHydrated.filter(t => t.done);
            setTaskHistory(prev => mergeCompletedTasks(prev, allDone));

            // Retry-sync any local-only tasks now that we're online
            for (const lt of localOnly) {
              try {
                const saved = await insertTask(uid, lt);
                // See the matching branch in hydrateTasksFromServer: the index
                // rejected this as an already-materialized occurrence.
                if (saved?.duplicate) {
                  setTasks(prev => prev.filter(t => t.id !== lt.id));
                  addDeletedId(uid, lt.id).catch(() => {});
                  continue;
                }
                if (saved?.id && saved.id !== lt.id) {
                  setTasks(prev => prev.map(t => t.id === lt.id ? { ...t, id: saved.id } : t));
                  cache.saveTasks(uid, mergeTaskRecords(cachedTasks, remoteHydrated, localOnly.map(t => t.id === lt.id ? { ...t, id: saved.id } : t)));
                }
              } catch (e) {
                console.warn("retry insertTask:", e?.message);
              }
            }
          }
        } catch (e) { console.warn("fetchTasks at boot:", e?.message); }

        let remoteStatsApplied = false;
        try {
          const stats = await fetchProfileStats(uid);
          if (stats.totalXp > 0) {
            setTotalXp(prev => Math.max(prev, stats.totalXp));
            cache.saveXp(uid, Math.max(cachedXp || 0, stats.totalXp));
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
            if (!remoteStatsApplied) setTotalXp(prev => Math.max(prev, p.totalXp || 0));
            const resetCredits = { balance: 0, balanceSec: 0, earned: 0, spent: 0 };
            setCredits(resetCredits);
            secRef.current = 0;
            setSecLeft(0);
            AsyncStorage.multiRemove(["drift_last_armed_seconds", "drift_last_armed_balance"]).catch(() => {});
            syncProfileStats(uid, { balanceSeconds: 0 }).catch(() => {});
            // Also drop any queued balance so a stale pre-reset value can't be
            // flushed back onto the server and resurrected next launch.
            clearPendingBalance(uid).catch(() => {});
            if (!remoteTasksApplied) {
              setTasks(savedTasks.filter(t => isTodayTask(t) && !deletedIds.has(t.id)));
              persist({ tasks: savedTasks, taskHistory: history, totalXp: p.totalXp || 0, credits: resetCredits });
            }
          } else {
            const rawSc = p.credits || { balance: 0, earned: 0, spent: 0 };
            // Floor all credit fields at zero — historical bug + challenge
            // penalty could leave negatives in storage. We never want debt.
            const sc = {
              ...rawSc,
              balance:    Math.max(0, rawSc.balance    || 0),
              balanceSec: Math.max(0, rawSc.balanceSec || 0),
              earned:     Math.max(0, rawSc.earned     || 0),
              spent:      Math.max(0, rawSc.spent      || 0),
            };
            if (!remoteTasksApplied) setTasks(savedTasks.filter(t => isTodayTask(t) && !deletedIds.has(t.id)));
            if (!remoteStatsApplied) {
              setCredits(sc);
              setTotalXp(prev => Math.max(prev, p.totalXp || 0));
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

  // Keep refs current every render so persist() never writes stale data.
  tasksRef.current       = tasks;
  taskHistoryRef.current = taskHistory;
  totalXpRef.current     = totalXp;
  creditsRef.current     = credits;
  userIdRef.current      = userId;
  appModeRef.current     = appMode;

  useEffect(() => {
    updateSharedBalance(secLeft).catch(() => {});
  }, [secLeft]);

  // ── CHILD: apply parent grants live ──────────────────────────
  // A child's balance only changes when a parent approves a task (server-side
  // increment). Subscribe to the child's own profile row and re-pull the
  // authoritative balance whenever it changes, so granted time appears without
  // a relaunch.
  const applyChildBalance = useCallback(async () => {
    if (appModeRef.current !== "child" || !userIdRef.current) return;
    try {
      // Read the authoritative balance directly (bypass fetchProfileStats' 20s
      // cache) so a fresh parent grant is reflected immediately.
      const { data } = await supabase
        .from("profiles").select("balance_seconds").eq("id", userIdRef.current).maybeSingle();
      const sec = Math.max(0, Number(data?.balance_seconds || 0));
      secRef.current = sec;
      setSecLeft(sec);
      setCredits({ balance: Math.ceil(sec / 60), balanceSec: sec, earned: Math.ceil(sec / 60), spent: 0 });
    } catch (e) { console.warn("applyChildBalance:", e?.message); }
  }, []);

  useEffect(() => {
    if (appMode !== "child" || !userId) return;
    const ch = supabase
      .channel(`child_profile:${userId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${userId}` },
        () => { applyChildBalance(); })
      .subscribe();
    // Also pull once on mount / foreground.
    applyChildBalance();
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") applyChildBalance(); });
    return () => { supabase.removeChannel(ch); sub.remove(); };
  }, [appMode, userId, applyChildBalance]);

  // ── CHILD: track the blocking mode (categories vs custom-picked apps) ──
  // 'custom' means the parent picked specific apps on this device via the native
  // picker; the shield below then blocks those instead of whole categories.
  useEffect(() => {
    if (appMode !== "child" || !userId) return;
    let cancelled = false;
    const loadPolicy = async () => {
      try {
        const { data } = await supabase
          .from("family_members").select("app_policy")
          .eq("user_id", userId).is("removed_at", null).maybeSingle();
        if (!cancelled) setChildBlockMode(data?.app_policy?.mode === "custom" ? "custom" : "categories");
      } catch {}
    };
    loadPolicy();
    const ch = supabase
      .channel(`child_policy:${userId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "family_members", filter: `user_id=eq.${userId}` },
        loadPolicy)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [appMode, userId]);

  // ── CHILD: enforce the shield ─────────────────────────────────
  // Personal accounts run the richer shield effect above; a child uses a
  // simpler mapping: time left → apps open, out of time → block. In
  // 'categories' mode we block standard app categories (freeTier); in 'custom'
  // mode we block the specific apps a parent picked on this device via the
  // native FamilyActivityPicker. Guarded by a composite key so it re-applies
  // when the mode changes, but not on every drain tick.
  const childShieldRef = useRef(null);
  useEffect(() => {
    if (appMode !== "child") return;
    if (!isNativeBlockingAvailable()) return;
    const desired = secLeft > 0 ? "off" : "on";
    const key = `${desired}:${childBlockMode}`;
    if (childShieldRef.current === key) return;
    childShieldRef.current = key;
    (async () => {
      try {
        if (desired === "off") {
          await clearBlocking().catch(() => {});
          const res = await startBalanceMonitoring(Math.max(60, secLeft)).catch(() => ({ started: false }));
          // Mark armed so the drain effects charge actual blocked-app usage
          // (consumeUsedSeconds) rather than wall-clock time.
          nativeArmedRef.current = isNativeBlockingAvailable() && res?.started !== false;
        } else {
          await stopBalanceMonitoring().catch(() => {});
          // custom → block the parent-picked apps; categories → block whole
          // categories (freeTier path).
          await applyBlocking([], { freeTier: childBlockMode !== "custom" }).catch(() => {});
          nativeArmedRef.current = false;
        }
      } catch {}
    })();
  }, [appMode, secLeft, childBlockMode]);

  const persist = async upd => {
    try {
      await storage.set("drift_v4", JSON.stringify({
        tasks:       upd.tasks       ?? tasksRef.current,
        taskHistory: upd.taskHistory ?? taskHistoryRef.current,
        credits:     upd.credits     ?? creditsRef.current,
        totalXp:     upd.totalXp     ?? totalXpRef.current,
        date:        todayKey(),
      }));
    } catch {}
  };

  const unlockAndArmBalance = useCallback(async (seconds) => {
    // Family shells don't run the personal shield/arming in Phase 1.
    if (appModeRef.current !== "personal") return;
    if (driftInActRef.current) return;
    const currentSeconds = Math.max(0, Math.floor(seconds || 0));
    if (currentSeconds <= 0) {
      await stopBalanceMonitoring().catch(() => {});
      await applyBlocking([], { freeTier: !proAccessRef.current }).catch(() => {});
      shieldStateRef.current = "on";
      await AsyncStorage.multiRemove(["drift_last_armed_seconds", "drift_last_armed_balance"]).catch(() => {});
      setLastArmedSeconds(-1);
      return;
    }

    await clearBlocking().catch(() => {});
    shieldStateRef.current = "off";
    // Balance is positive again — re-arm the "time's up" notice so the NEXT
    // depletion notifies once (and clear any stale banner from the last one).
    resetTimeNotices();
    const armedSeconds = Math.max(60, currentSeconds);
    let res = await startBalanceMonitoring(armedSeconds);
    if (res?.started === false && !/unavailable/i.test(res.reason || "")) {
      res = await startBalanceMonitoring(armedSeconds);
    }
    if (res?.started === false) {
      nativeArmFailedSecondsRef.current = armedSeconds;
    } else {
      nativeArmFailedSecondsRef.current = null;
      await AsyncStorage.setItem("drift_last_armed_seconds", String(armedSeconds)).catch(() => {});
      await AsyncStorage.removeItem("drift_last_armed_balance").catch(() => {});
      setLastArmedSeconds(armedSeconds);
    }
  }, []);

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
      cacheFullTasks(userId, nt);
      cache.saveXp(userId, nx);
    }

    // Belt-and-suspenders: explicitly clear the Screen Time shield the
    // moment we earn balance, instead of waiting on the useEffect to
    // notice the credits change.
    if (nc.balance > 0 && !driftInActive) {
      unlockAndArmBalance(newSec);
    }
  };

  const tryOpenAddTask = useCallback(() => {
    setOverlay("add");
  }, []);

  // ── Suggested tasks (place arrival / calendar import) ────────
  // Suggestions are shown one at a time; confirming or dismissing pulls the
  // next off the queue. Nothing is ever added without the user confirming.
  const queueSuggestions = useCallback((list) => {
    const items = (list || []).filter(Boolean);
    if (items.length === 0) return;
    setSuggestionQueue(prev => [...prev, ...items]);
  }, []);

  const advanceSuggestion = useCallback(() => {
    setSuggestionQueue(prev => prev.slice(1));
  }, []);

  // Tapping a place-arrival notification opens the prefilled confirm sheet.
  // Covers both a warm tap (listener) and a cold start where the tap launched
  // the app (getLastNotificationResponseAsync).
  useEffect(() => {
    if (appMode !== "personal") return;
    let Notifications;
    try { Notifications = require("expo-notifications"); } catch { return; }

    const handle = (response) => {
      const data = response?.notification?.request?.content?.data;
      if (data?.type !== "place_suggestion") return;
      queueSuggestions([{
        title: data.title,
        cat: data.cat,
        minutes: data.minutes,
        label: data.label,
        source: "place",
      }]);
    };

    let sub;
    try {
      sub = Notifications.addNotificationResponseReceivedListener(handle);
      Notifications.getLastNotificationResponseAsync?.().then(r => { if (r) handle(r); }).catch(() => {});
    } catch {}
    return () => { try { sub?.remove(); } catch {} };
  }, [appMode, queueSuggestions]);

  // Re-register geofences at boot: the saved region set lives in the OS, and
  // permissions can be revoked in Settings between launches.
  useEffect(() => {
    if (appMode !== "personal") return;
    syncGeofences().catch(() => {});
  }, [appMode]);

  // Decide whether the Today nudge should appear. Re-checked when the settings
  // sheet closes so turning a feature on hides it immediately.
  useEffect(() => {
    if (appMode !== "personal") { setAutoTasksHint(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const dismissed = await AsyncStorage.getItem("drift_auto_tasks_hint_dismissed");
        if (dismissed === "1") { if (!cancelled) setAutoTasksHint(false); return; }
        const [places, cal] = await Promise.all([
          isSuggestionsEnabled().catch(() => false),
          isCalendarSyncEnabled().catch(() => false),
        ]);
        if (!cancelled) setAutoTasksHint(!places && !cal);
      } catch { if (!cancelled) setAutoTasksHint(false); }
    })();
    return () => { cancelled = true; };
  }, [appMode, showAutoTasks]);

  // Opening the app picker from The Lab. Pro goes straight to Apple's picker —
  // no in-app middleman screen. Free tier has nothing to pick (blocking is by
  // category), so it still gets the sheet, which explains that and offers the
  // upgrade. Lifted out of ProfileScreen when these rows moved to The Lab.
  const openBlockedAppsPicker = useCallback(async () => {
    setFirstTimeBlockedApps(false);
    if (!proAccess) { setShowBlockedApps(true); return; }
    const { opened, reason } = await openNativeAppPicker();
    if (opened) return;
    if (reason === "denied") {
      Alert.alert("Screen Time access needed",
        "Enable Drift in Settings > Screen Time so Drift can block apps.");
    } else if (reason === "unavailable") {
      Alert.alert("Not available",
        "Apple Screen Time blocking requires a custom build of Drift.");
    }
  }, [proAccess]);

  const dismissAutoTasksHint = useCallback(() => {
    setAutoTasksHint(false);
    AsyncStorage.setItem("drift_auto_tasks_hint_dismissed", "1").catch(() => {});
  }, []);

  // Pull today's calendar events in as suggestions (user-triggered).
  const importCalendarEvents = useCallback(async () => {
    if (!(await isCalendarSyncEnabled())) return;
    const events = await fetchTodayEvents();
    if (events.length === 0) {
      Alert.alert("Nothing to import", "No new events on today's calendar.");
      return;
    }
    // Mark imported up-front so re-running never double-offers the same event;
    // declining a suggestion just means no task, not "offer it again forever".
    await markImported(events.map(e => e.eventId));
    queueSuggestions(events.map(e => ({
      title: e.title, cat: e.cat, minutes: e.minutes, source: "calendar",
    })));
  }, [queueSuggestions]);

  // Auto-import on first foreground of the day when sync is on.
  useEffect(() => {
    if (appMode !== "personal" || !userId) return;
    let cancelled = false;
    (async () => {
      try {
        if (!(await isCalendarSyncEnabled())) return;
        if (!(await isCalendarAutoImportEnabled())) return;
        const key = `drift_cal_autoimport_${userId}`;
        const last = await AsyncStorage.getItem(key);
        if (last === todayKey()) return;
        const events = await fetchTodayEvents();
        if (cancelled || events.length === 0) return;
        await AsyncStorage.setItem(key, todayKey());
        await markImported(events.map(e => e.eventId));
        queueSuggestions(events.map(e => ({
          title: e.title, cat: e.cat, minutes: e.minutes, source: "calendar",
        })));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [appMode, userId, queueSuggestions]);

  // Background AI valuation for a just-created task. Patches the provisional
  // credits/xp with the real evaluated values once the server responds. Never
  // throws — on failure the task simply keeps its provisional credits.
  const finalizeTaskCredits = async (t) => {
    let result;
    try {
      result = await evaluateTask({ title: t.title, mins: t.minutes, category: t.cat });
    } catch (e) {
      // Sub lapsed or eval unavailable → keep provisional credits, just clear the
      // pending flag so nothing shows as perpetually "evaluating".
      setTasks(prev => {
        const nt = prev.map(x => x.id === t.id ? { ...x, aiPending: false, aiValued: false } : x);
        persist({ tasks: nt });
        if (userId) cacheFullTasks(userId, nt);
        return nt;
      });
      return;
    }
    // The server applies the same ceiling; clamp here too so a stale/lenient
    // function deploy can't hand out more than an hour off one task.
    const credits = Math.min(MAX_REWARD_MINUTES, result.credits);
    const xp = credits === result.credits ? result.xp : Math.round(credits * 0.6 + 8);
    const { reasoning } = result;
    // The model also classifies the category (the user no longer picks one).
    // Fall back to whatever provisional value the task already carries if an
    // older edge-function deploy doesn't return one.
    const cat = result.category || t.cat || "life";
    setTasks(prev => {
      const nt = prev.map(x =>
        x.id === t.id ? { ...x, cat, credits, xp, aiReasoning: reasoning || "", aiValued: true, aiPending: false } : x
      );
      persist({ tasks: nt });
      if (userId) cacheFullTasks(userId, nt);
      return nt;
    });
    if (userId) updateTaskCredits(userId, t.id, { credits, xp, reasoning, aiValued: true, category: cat }).catch(() => {});
  };

  const addTask  = (t, recurrence) => {
    const nt = [...tasks, t];
    setTasks(nt); persist({ tasks: nt });
    if (userId) {
      removeDeletedId(userId, t.id).catch(() => {});
      // Sync to Supabase. If offline, the local cache + persisted state still
      // shows the task, and the next foreground will re-sync via fetchTasks.
      insertTask(userId, t).catch(e => {
        console.warn("insertTask sync failed (will retry on next fetch):", e?.message);
      });
      cacheFullTasks(userId, nt);
    }
    // Async AI valuation: the task is already on screen with provisional credits.
    // Evaluate in the background and patch the real credits/xp in when it lands,
    // so the user is never stuck on a "AI is evaluating…" spinner.
    if (t.aiPending) finalizeTaskCredits(t);
    if (userId && proAccess && recurrence?.frequency && recurrence.frequency !== "none") {
      const template = {
        id: makeUuid(),
        title: t.title,
        cat: t.cat,
        minutes: t.minutes,
        credits: t.credits,
        xp: t.xp,
        aiCheck: !!t.aiCheck,
        aiValued: !!t.aiValued,
        aiReasoning: t.aiReasoning || "",
        frequency: recurrence.frequency || "daily",
        time: recurrence.time || "9:00 AM",
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
    // If this is a recurring instance, record the template as handled for today
    // so the materialize effect won't immediately re-create it (delete-for-the-
    // day). The next occurrence day starts fresh.
    if (target.recurringTemplateId) markRecurringHandled([target.recurringTemplateId]);
    const nt = tasks.filter(t => t.id !== id);
    setTasks(nt);
    persist({ tasks: nt });
    if (userId) {
      addDeletedId(userId, id).catch(() => {});
      softDeleteTask(userId, id).catch(e => console.warn("softDeleteTask:", e?.message));
      cache.loadTasks(userId)
        .then(all => cache.saveTasks(userId, (all || []).filter(t => t.id !== id)))
        .catch(() => cache.saveTasks(userId, nt));
    }
  };

  const handleDriftInStart  = async ({ task, durationSeconds } = {}) => {
    setDriftInActive(true);
    startDriftInLiveActivity(task || "Drift In", durationSeconds || 25 * 60).catch(() => {});
    try { await stopBalanceMonitoring(); } catch {}
    await AsyncStorage.multiRemove(["drift_last_armed_seconds", "drift_last_armed_balance"]).catch(() => {});
    setLastArmedSeconds(-1);

    // Warn if no apps are blocked — common foot-gun where users skip the picker
    // and assume the focus session is enforced. Beta testers will report this.
    try {
      // Drift In blocks the SAME apps as the balance shield. On iOS the real
      // selection lives in the native FamilyActivityPicker (UserDefaults), NOT
      // the JS getBlockedApps() list — so check the native selection first,
      // otherwise we'd falsely warn users who already picked apps.
      let hasSelection = false;
      if (isNativeBlockingAvailable()) {
        const diag = await getDiagnostics();
        const picked = (diag?.pickedAppCount || 0) + (diag?.pickedCategoryCount || 0) + (diag?.pickedWebCount || 0);
        hasSelection = picked > 0 || !!diag?.selectionStored;
      } else {
        const list = await (await import("./blockedApps")).getBlockedApps();
        hasSelection = !!(list && list.length);
      }
      if (!hasSelection) {
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
      const res = await applyBlocking([], { freeTier: !proAccessRef.current });
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
    endDriftInLiveActivity().catch(() => {});
    unlockAndArmBalance(secRef.current);
  };

  const handleDriftInComplete = ({ credits: earned, xp }) => {
    setDriftInActive(false);
    endDriftInLiveActivity().catch(() => {});
    clearBlocking();
    const newSec = secRef.current + earned * 60;
    const nx  = totalXp + xp;
    const nc  = { balance: Math.ceil(newSec / 60), balanceSec: newSec, earned: credits.earned + earned, spent: credits.spent };
    setCredits(nc); setTotalXp(nx);
    setPopup({ credits: earned, xp });
    setTimeout(() => setPopup(null), 2500);
    startTick(newSec);
    unlockAndArmBalance(newSec);
    persist({ credits: nc, totalXp: nx });
    if (userId) {
      syncProfileStats(userId, { totalXp: nx, balanceSeconds: newSec }).catch(() => {});
      cache.saveXp(userId, nx);
    }
    setTimeout(() => setTab("today"), 400);
  };

  const handleDriftInTick = useCallback((remainingSeconds) => {
    updateDriftInLiveActivity(remainingSeconds).catch(() => {});
  }, []);

  const handleChallengeResolved = ({ won, xp, penaltyMins }) => {
    if (won) {
      const nx = totalXp + xp;
      setTotalXp(nx);
      setPopup({ credits: 0, xp });
      setTimeout(() => setPopup(null), 2200);
      persist({ totalXp: nx });
      if (userId) {
        syncProfileStats(userId, { totalXp: nx, balanceSeconds: secRef.current }).catch(() => {});
        cache.saveXp(userId, nx);
      }
      return;
    }

    // Floor at zero — no negative balance / no "working out of debt".
    // The penalty just consumes whatever balance was left.
    const penaltySec = Math.max(0, penaltyMins || 0) * 60;
    const prevSec    = Math.max(0, secRef.current);
    const newSec     = Math.max(0, prevSec - penaltySec);
    const lostMins   = Math.min(Math.ceil(prevSec / 60), penaltyMins || 0);
    secRef.current = newSec;
    setSecLeft(newSec);
    AsyncStorage.multiRemove(["drift_last_armed_seconds", "drift_last_armed_balance"]).catch(() => {});
    setLastArmedSeconds(-1);
    const nc = {
      ...credits,
      balance: Math.ceil(newSec / 60),
      balanceSec: newSec,
      spent: Math.min(credits.earned, credits.spent + lostMins),
    };
    setCredits(nc);
    persist({ credits: nc });
    unlockAndArmBalance(newSec);
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
    unlockAndArmBalance(newSec);
    persist({ credits: nextCredits });
    if (userId) {
      syncProfileStats(userId, { totalXp, balanceSeconds: newSec }).catch(() => {});
    }
  }, [credits, totalXp, userId, unlockAndArmBalance]);

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
    const day = todayKey();
    quickGrantDayRef.current = day;
    const key = `drift_quick_grants_${day}`;
    const stored = Number((await AsyncStorage.getItem(key).catch(() => "0")) || 0);
    const latest = Number.isFinite(stored) ? Math.max(0, Math.min(3, stored)) : 0;
    if (latest >= 3) {
      setQuickGrantCount(3);
      setShowQuickGrant(false);
      return;
    }
    const newCount = latest + 1;
    await AsyncStorage.setItem(key, String(newCount)).catch(() => {});
    setQuickGrantCount(newCount);
    setShowQuickGrant(false);

    // Acts like completing a 10-minute light activity: a 10-min light task
    // (0.5x multiplier) grants 5 minutes of screen time. We route it through
    // the same applyBalanceSeconds path a real task uses so credits/ledger/
    // sync all behave identically.
    const addedMins = GRANT_MINS;
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

  const signOut = async () => {
    setShowAccount(false);
    try { await supabase.auth.signOut(); } catch {}
    try { await stopBalanceMonitoring(); } catch {}
    try { await clearBlocking(); } catch {}
    try { await cancelAllNotifications(); } catch {}
    stopTick();
    setUserId(null);
    setUserEmail("");
    setUserName("");
    setAppMode("personal"); // next account on this device starts fresh
    // Clear ALL user-scoped local state so the next account on this device
    // starts with a clean slate (no preview-toggle bleed, no stale balance, etc.).
    await AsyncStorage.multiRemove([
      "drift_username",
      "drift_v4",
      "drift_blocked_apps",
      "drift_last_armed_seconds",
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

  const deleteAccount = async () => {
    try {
      const { error } = await supabase.functions.invoke("delete-account", {});
      if (error) throw error;
      await signOut();
      Alert.alert("Account deleted", "Your account has been successfully deleted.");
    } catch (e) {
      Alert.alert("Could not delete account", e?.message || "Please try again later.");
      throw e;
    }
  };

  // ── Stable props for the memoized filmstrip screens ─────────
  // All four tab screens stay mounted side-by-side, so every App re-render
  // (timer ticks, popups, credit changes…) used to re-render the heavy Grove/
  // Stats/Drift In trees too — starving the JS thread and dropping taps. The
  // screens are React.memo'd; these wrappers keep prop identities stable while
  // always calling the latest closure. MUST stay above every early return so
  // hook order is constant across renders (Rules of Hooks).
  const latestHandlersRef = useRef({});
  const stableDriftInStart      = useCallback((...a) => latestHandlersRef.current.driftInStart?.(...a), []);
  const stableDriftInEnd        = useCallback((...a) => latestHandlersRef.current.driftInEnd?.(...a), []);
  const stableDriftInComplete   = useCallback((...a) => latestHandlersRef.current.driftInComplete?.(...a), []);
  const stableChallengeResolved = useCallback((...a) => latestHandlersRef.current.challengeResolved?.(...a), []);
  const statsTasks = useMemo(
    () => mergeCompletedTasks(taskHistory, tasks.filter(t => t.done)),
    [taskHistory, tasks],
  );

  // Gate on fonts FIRST so onboarding (welcome / account-type / auth) always
  // renders in the real Drift typefaces, never a system-font fallback flash.
  if (!fontsLoaded) return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: ink.void }}>
      <StatusBar barStyle="light-content" />
      <Text style={{ fontFamily: "Georgia", fontSize: 52, color: "#2FAB72" }}>D</Text>
      <Text style={{ fontFamily: "Georgia", fontSize: 12, color: "#4A8060", letterSpacing: 5, marginTop: 4 }}>DRIFT</Text>
    </View>
  );

  // Mandatory-update gate — blocks the ENTIRE app (onboarding, personal, parent,
  // child) with no way past it but updating. Placed before every other screen.
  if (forceUpdate) return (
    <View style={{ flex: 1, backgroundColor: getTheme(darkMode).paper.warm }}>
      <ForceUpdateModal visible={true} storeUrl={updateStoreUrl} dark={darkMode} />
    </View>
  );

  if (onboarding) return (
    <OnboardingScreen
      signInOnly={signInOnly}
      onComplete={({ user, answers }) => completeAuthenticatedUser(user, answers)}
    />
  );

  if (screen === "loading") return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: ink.void }}>
      <StatusBar barStyle="light-content" />
      <Text style={{ fontFamily: "Georgia", fontSize: 52, color: "#2FAB72" }}>D</Text>
      <Text style={{ fontFamily: "Georgia", fontSize: 12, color: "#4A8060", letterSpacing: 5, marginTop: 4 }}>DRIFT</Text>
    </View>
  );

  // Family accounts render their own shells instead of the personal app.
  if (appMode === "parent") return (
    <ParentShell
      userId={userId} userEmail={userEmail} username={myUsername}
      dark={darkMode} onToggleTheme={toggleDark}
      onSignOut={signOut} onDeleteAccount={deleteAccount}
    />
  );
  if (appMode === "child") return (
    <ChildShell
      userId={userId} username={myUsername} secLeft={secLeft}
      dark={darkMode} onToggleTheme={toggleDark}
      onSignOut={signOut} onDeleteAccount={deleteAccount}
    />
  );

  const activeTheme = getTheme(darkMode);
  const { ink: th_ink, paper: th_paper, earn: th_earn } = activeTheme;
  // Keep the ref (declared above every early return) pointing at the latest
  // handler closures so the stable wrappers always call current logic.
  latestHandlersRef.current = {
    driftInStart: handleDriftInStart,
    driftInEnd: handleDriftInEnd,
    driftInComplete: handleDriftInComplete,
    challengeResolved: handleChallengeResolved,
  };
  const displaySecLeft = blockedHoursActive ? 0 : secLeft;
  const displayCredits = blockedHoursActive ? { ...credits, balance: 0, balanceSec: 0 } : credits;

  return (
    <ThemeContext.Provider value={{ dark: darkMode, theme: activeTheme }}>
    <TouchTracker style={{
      flex: 1,
      paddingTop: Constants.statusBarHeight,
      backgroundColor: driftInActive ? th_ink.void : th_paper.warm,
    }}>
      <StatusBar barStyle={driftInActive || darkMode ? "light-content" : "dark-content"} />

      {/* XP / credit popup */}
      <FloatingFeedback popup={popup} />
      <LevelUpModal
        level={levelUp}
        dark={darkMode}
        onClose={() => setLevelUp(null)}
      />

      {/* Header — hidden during active Drift In session */}
      {!driftInActive && !showAccount && (
        <View style={{
          flexDirection: "row", alignItems: "center",
          paddingHorizontal: 22, paddingTop: 6, paddingBottom: 8,
          backgroundColor: th_paper.warm,
        }}>
          {/* Wordmark — heavy condensed sans, generous tracking */}
          <Text style={{
            fontFamily: FF.mark,
            fontSize: 26,
            color: th_ink.deep,
            letterSpacing: 4,
            flex: 1,
          }}>
            DRIFT
          </Text>

          {/* Time pill — small clock + status text */}
          <View style={{
            flexDirection: "row", alignItems: "center", gap: 6,
            backgroundColor: blockedHoursActive
              ? "rgba(224,80,80,0.10)"
              : displaySecLeft > 0
                ? (displaySecLeft < 120 ? "rgba(224,80,80,0.10)" : th_earn.sageLo)
                : th_paper.card,
            borderRadius: 22,
            paddingVertical: 7,
            paddingHorizontal: 12,
            marginRight: 10,
            borderWidth: 1,
            borderColor: th_ink.hairline,
          }}>
            <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
              <SvgCircle cx="12" cy="12" r="9"
                stroke={blockedHoursActive ? "#C0392B" : displaySecLeft > 0 ? (displaySecLeft < 120 ? "#C0392B" : th_earn.sage) : th_ink.mid}
                strokeWidth={1.8} />
              <Path d="M12 7v5l3 2"
                stroke={blockedHoursActive ? "#C0392B" : displaySecLeft > 0 ? (displaySecLeft < 120 ? "#C0392B" : th_earn.sage) : th_ink.mid}
                strokeWidth={1.8} strokeLinecap="round" />
            </Svg>
            <Text style={{
              fontFamily: FF.bodyMed, fontSize: 12,
              color: blockedHoursActive ? "#C0392B"
                : displaySecLeft > 0 ? (displaySecLeft < 120 ? "#C0392B" : th_earn.sage)
                : th_ink.mid,
            }}>
              {blockedHoursActive ? "blocked" : displaySecLeft !== 0 ? fmtSecLeft(displaySecLeft) : "no time"}
            </Text>
          </View>

          {/* Account icon — line style */}
          <Pop
            onPress={() => setShowAccount(true)}
            hitSlop={{ top: 22, bottom: 2, left: 6, right: 6 }}
            style={{ width: 38, height: 38, alignItems: "center", justifyContent: "center" }}
          >
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
              <SvgCircle cx="12" cy="8" r="3.6" stroke={th_ink.deep} strokeWidth={1.8} />
              <Path d="M5 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1"
                stroke={th_ink.deep} strokeWidth={1.8} strokeLinecap="round" />
            </Svg>
          </Pop>

          {/* Theme toggle — moon/sun with a satisfying spin on toggle */}
          <ThemeToggleButton darkMode={darkMode} onToggle={toggleDark} color={th_ink.deep} />
        </View>
      )}

      {/* Content — an animated horizontal filmstrip. All four tabs stay mounted
          (so the Drift In session persists across tab switches); we just slide
          the row left/right. translateX follows the finger during a swipe. */}
      {showAccount ? (
        <ProfileScreen
          userId={userId}
          userEmail={userEmail}
          username={myUsername}
          subActive={proAccess}
          screenTimeStatus={screenTimeStatus}
          dark={darkMode}
          inAppPage
          onClose={() => setShowAccount(false)}
          onProfileChange={(profile) => {
            if (profile?.username) {
              setUserName(profile.username);
              AsyncStorage.setItem("drift_username", profile.username);
            }
          }}
          onRequestScreenTime={async () => {
            const next = await requestScreenTimeAuth();
            setScreenTimeStatus(next);
            if (next !== "approved") {
              Alert.alert("Screen Time", `Status: ${next}. Open Settings -> Screen Time to grant access.`);
            }
          }}
          onUpgrade={() => {}}
          onSignOut={signOut}
          onDeleteAccount={deleteAccount}
          onProRedeemed={() => {}}
        />
      ) : (
      <>
      <View
        style={{ flex: 1, overflow: "hidden", backgroundColor: driftInActive ? th_ink.void : th_paper.warm }}
        {...tabSwipe.panHandlers}
      >
        <Animated.View style={{
          flexDirection: "row",
          width: TAB_W * TABS.length,
          height: "100%",
          transform: [{ translateX: slideX }],
        }}>
          <View style={{ width: TAB_W, height: "100%" }}>
            <TodayView
              tasks={tasks}
              credits={displayCredits}
              totalXp={totalXp}
              onComplete={completeTask}
              onDelete={deleteTask}
              onAdd={tryOpenAddTask}
              heroRef={tutHeroRef}
              addRef={tutAddRef}
              scrollRef={todayScrollRef}
              onReduceScreenTime={() => setShowReduceTime(true)}
              onQuickGrant={() => setShowQuickGrant(true)}
              quickGrantCount={quickGrantCount}
              grantMins={GRANT_MINS}
              onSwipeLockChange={setChildSwipeLockedNow}
              dark={darkMode}
              secLeft={displaySecLeft}
              showAutoTasksHint={autoTasksHint}
              onOpenAutoTasks={() => setShowAutoTasks(true)}
              onDismissAutoTasksHint={dismissAutoTasksHint}
            />
          </View>
          <View style={{ width: TAB_W, height: "100%", backgroundColor: driftInActive ? th_ink.void : th_paper.warm }}>
            <DriftInScreen
              onSessionComplete={stableDriftInComplete}
              onSessionStart={stableDriftInStart}
              onSessionTick={handleDriftInTick}
              onSessionEnd={stableDriftInEnd}
              totalXp={totalXp}
              dark={darkMode}
            />
          </View>
          <View style={{ width: TAB_W, height: "100%" }}>
            <GroveTab
              half={groveHalf}
              onHalfChange={setGroveHalf}
              dark={darkMode}
              statsProps={{ tasks: statsTasks, totalXp, skips: 0, onAddTask: tryOpenAddTask }}
              socialProps={{
                userId,
                isPremium: proAccess,
                onOpenPaywall: NOOP,
                onSwipeLockChange: setChildSwipeLockedNow,
                onChallengeResolved: stableChallengeResolved,
              }}
            />
          </View>
          <View style={{ width: TAB_W, height: "100%" }}>
            <LabScreen
              dark={darkMode}
              // Panes stay mounted in the filmstrip, so the Lab needs to know
              // when it's actually on screen to re-read its toggles.
              visible={tab === "lab"}
              onOpenAutoTasks={() => setShowAutoTasks(true)}
              onOpenBlockedApps={openBlockedAppsPicker}
              onOpenBlockedHours={() => setShowBlockedHours(true)}
              onOpenRecurringTasks={() => setShowRecurringTasks(true)}
              // The tour spotlights elements on Today, so jump there before
              // opening it — measuring the hero while it's scrolled off to the
              // side would put the highlight off-screen. The delay lets the tab
              // slide settle so measureInWindow reads final positions.
              onReplayTour={() => {
                setTab("today");
                setTimeout(() => { tourReplayRef.current = true; setShowTutorial(true); }, 420);
              }}
            />
          </View>
        </Animated.View>
      </View>

      {/* ── Floating tab island — icons with labels stacked beneath ── */}
      {!driftInActive && (
        <View style={{
          paddingHorizontal: 16,
          // Sits lower / closer to the bottom edge per request. The root View no
          // longer adds a bottom safe inset, so include enough to clear the iOS
          // home indicator while staying lower than the original position.
          paddingBottom: Platform.OS === "ios" ? 28 : 12,
          paddingTop: 4,
          backgroundColor: "transparent",
          pointerEvents: "box-none",
        }}>
          <View ref={tutTabBarRef} style={{
            flexDirection: "row",
            alignItems: "stretch",
            backgroundColor: th_paper.card,
            borderRadius: 26,
            paddingVertical: 8,
            paddingHorizontal: 8,
            borderWidth: 1,
            // Dark mode: mint glass edge so the island reads as lit glass
            // floating over the forest, not a gray slab.
            borderColor: darkMode ? th_ink.border : th_ink.hairline,
            shadowColor: darkMode ? "#000" : "#1F3A2A",
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: darkMode ? 0.5 : 0.07,
            shadowRadius: 22,
            elevation: 8,
          }}>
            {TABS.map(t => {
              const active = tab === t.id;
              return (
                <TabItem
                  key={t.id}
                  tab={t}
                  active={active}
                  onPress={() => setTab(t.id)}
                  sage={th_earn.sage}
                  sageLo={th_earn.sageLo}
                  mid={th_ink.mid}
                />
              );
            })}
          </View>
        </View>
      )}
      </>
      )}

      {/* Suggested task (place arrival / calendar import) — confirm or edit */}
      <SuggestedTaskModal
        suggestion={suggestionQueue[0] || null}
        dark={darkMode}
        onConfirm={({ title, cat, minutes }) => {
          const { credits, xp, reasoning } = freeTierCredits(minutes);
          addTask({
            id: makeUuid(),
            title, cat, minutes,
            done: false,
            credits, xp,
            aiCheck: false,
            aiValued: false,
            aiPending: false,
            aiReasoning: reasoning || "",
            task_date: todayKey(),
          }, null);
          advanceSuggestion();
        }}
        onDismiss={advanceSuggestion}
      />

      {/* Automatic-task settings (places + calendar) */}
      <AutoTasksModal
        visible={showAutoTasks}
        dark={darkMode}
        onClose={() => setShowAutoTasks(false)}
        onImportCalendar={importCalendarEvents}
      />

      {/* Add task overlay */}
      {overlay && (
        <View style={[StyleSheet.absoluteFill, { zIndex: 200 }]}>
          {overlay === "add" && (
            <AddTaskOverlay
              onSave={addTask}
              onClose={() => setOverlay(null)}
              userId={userId}
              isSubActive={proAccess}
              onOpenPaywall={NOOP}
              onOpenAutoTasks={autoTasksHint ? () => { setOverlay(null); setShowAutoTasks(true); } : null}
            />
          )}
        </View>
      )}


      {/* Blocked apps modal (onboarding + ongoing management) */}
      <BlockedAppsModal
        visible={showBlockedApps}
        firstTime={firstTimeBlockedApps}
        dark={darkMode}
        isPro={proAccess}
        onUpgrade={() => {}}
        onClose={() => {
          const wasFirstTime = firstTimeBlockedApps;
          setShowBlockedApps(false);
          setFirstTimeBlockedApps(false);
          // Post-signup onboarding sequence: tutorial → review prompt.
          if (wasFirstTime) setShowTutorial(true);
        }}
      />

      {/* Post-signup coachmark tour → hands off to the review prompt. A manual
          replay from The Lab skips that hand-off; asking for a review every
          time someone rewatches the tour would be obnoxious. */}
      {showTutorial && (
        <TutorialOverlay
          dark={darkMode}
          targets={tutorialTargets}
          onDone={() => {
            const wasReplay = tourReplayRef.current;
            tourReplayRef.current = false;
            setShowTutorial(false);
            if (!wasReplay) setShowReviewPrompt(true);
          }}
        />
      )}

      {/* Post-signup review prompt (shown after the tutorial). */}
      <Modal visible={showReviewPrompt} animationType="slide" onRequestClose={() => setShowReviewPrompt(false)}>
        <ReviewPromptScreen dark={darkMode} onDone={() => setShowReviewPrompt(false)} />
      </Modal>
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
        grantMins={GRANT_MINS}
      />
    </TouchTracker>
    </ThemeContext.Provider>
  );
}

