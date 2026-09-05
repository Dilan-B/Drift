/**
 * lockbox.js
 * "Put the phone in the box and leave it there."
 *
 * THE DEAL
 *   The user places an AR box on a real surface, sets the phone down inside it,
 *   and Drift shields their apps for the length of the session. Lift the phone
 *   and a countdown starts. Put it back before the countdown ends and nothing
 *   happens. Let it run out and the session — and the time it would have earned
 *   — is forfeited.
 *
 * WHAT THE AR ACTUALLY DOES
 *   Placement, and nothing else. The moment the phone is face-down in the box
 *   the camera is looking at cardboard, so ARKit cannot possibly witness the
 *   phone being removed. The box is the commitment ritual; CoreMotion is the
 *   enforcement. Anyone reading this expecting the camera to be watching should
 *   stop here.
 *
 * WHY THE SCREEN STAYS ON
 *   Live detection needs the app running, and iOS freezes Drift the moment the
 *   screen locks — neither background mode the app declares (fetch, processing)
 *   permits continuous accelerometer updates. So the session screen holds
 *   expo-keep-awake for its whole duration, exactly as Drift In does. The cost
 *   is battery; the benefit is that the countdown appears the instant the phone
 *   moves rather than whenever the user next happens to open Drift.
 *
 * WHAT IT DOESN'T CLAIM
 *   Nothing here can physically stop someone walking off with their phone. iOS
 *   will not let an app force itself to the foreground. This makes leaving cost
 *   something and makes staying the easy path. That is the whole mechanism, and
 *   it is the same honest bargain the sleep guard makes.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeModules, NativeEventEmitter, Platform } from "react-native";

const Native = NativeModules.LockboxModule;

const KEY_SESSION = "drift_lockbox_session";
const KEY_HISTORY = "drift_lockbox_history";
const KEY_PREFS   = "drift_lockbox_prefs";

/** Seconds the phone may be out of the box before the session is forfeited. */
export const GRACE_SECONDS = 20;

/** Shortest session worth running. Below this the ceremony costs more than the focus. */
export const MIN_MINUTES = 5;
export const MAX_MINUTES = 180;

/**
 * Screen-time minutes earned per minute in the box.
 *
 * MIRRORS MAX_REWARD_RATIO in Drift.jsx, which caps every reward at half the
 * time invested. Lockbox deliberately does not pay better than a task — the
 * point is to make focus easy, not to make it the cheapest way to farm minutes.
 */
export const EARN_RATIO = 0.5;

export const DEFAULT_PREFS = {
  /** Scales the movement threshold. 1.0 is the native default (~0.08 G). */
  sensitivity: 1.0,
  lastDurationMinutes: 25,
};

export const isAvailable = () =>
  Platform.OS === "ios" && !!Native && typeof Native.startMonitoring === "function";

let emitter = null;
/**
 * Subscribe to settled/disturbed transitions. Returns an unsubscribe function.
 *
 * The native side does the thresholding and only emits transitions, so this
 * fires a handful of times per session rather than 20 times a second.
 */
export function onStateChange(handler) {
  if (!isAvailable()) return () => {};
  if (!emitter) emitter = new NativeEventEmitter(Native);
  const sub = emitter.addListener("LockboxState", handler);
  return () => { try { sub.remove(); } catch {} };
}

export async function motionAvailable() {
  if (!isAvailable()) return false;
  try { return !!(await Native.isAvailable()); } catch { return false; }
}

export async function startMonitoring(sensitivity) {
  if (!isAvailable()) throw new Error("unavailable");
  const s = sensitivity ?? (await getPrefs()).sensitivity;
  return await Native.startMonitoring(s);
}

export async function stopMonitoring() {
  if (!isAvailable()) return;
  try { await Native.stopMonitoring(); } catch {}
}

/** Instantaneous reading, for a "hold still" meter during placement. */
export async function currentMagnitude() {
  if (!isAvailable()) return null;
  try { return await Native.currentMagnitude(); } catch { return null; }
}

// ── Preferences ──────────────────────────────────────────────
export async function getPrefs() {
  try {
    const raw = await AsyncStorage.getItem(KEY_PREFS);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : { ...DEFAULT_PREFS };
  } catch { return { ...DEFAULT_PREFS }; }
}

export async function setPrefs(patch) {
  const next = { ...(await getPrefs()), ...patch };
  try { await AsyncStorage.setItem(KEY_PREFS, JSON.stringify(next)); } catch {}
  return next;
}

// ── Session ──────────────────────────────────────────────────
/**
 * An in-flight session. Wall-clock based (`endsAt`), not a ticking counter, so
 * the remaining time stays correct across a backgrounding or a reload — the same
 * approach DriftInScreen uses.
 */
export async function getSession() {
  try {
    const raw = await AsyncStorage.getItem(KEY_SESSION);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export async function startSession({ minutes, task = "" }) {
  const mins = Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, Math.round(minutes) || 25));
  const now = Date.now();
  const session = {
    startedAt: now,
    endsAt: now + mins * 60_000,
    minutes: mins,
    task: String(task || "").trim(),
    rewardMinutes: Math.max(1, Math.round(mins * EARN_RATIO)),
    // Set when the phone leaves the box; cleared when it comes back.
    disturbedAt: null,
    breaches: 0,
  };
  await AsyncStorage.setItem(KEY_SESSION, JSON.stringify(session)).catch(() => {});
  await setPrefs({ lastDurationMinutes: mins });
  return session;
}

export async function updateSession(patch) {
  const s = await getSession();
  if (!s) return null;
  const next = { ...s, ...patch };
  await AsyncStorage.setItem(KEY_SESSION, JSON.stringify(next)).catch(() => {});
  return next;
}

export async function clearSession() {
  await AsyncStorage.removeItem(KEY_SESSION).catch(() => {});
}

/** Seconds left on the countdown, or null when the phone is where it should be. */
export function graceRemaining(session, now = Date.now()) {
  if (!session?.disturbedAt) return null;
  const elapsed = (now - session.disturbedAt) / 1000;
  return Math.max(0, Math.ceil(GRACE_SECONDS - elapsed));
}

export const isComplete = (session, now = Date.now()) =>
  !!session && now >= session.endsAt;

/**
 * Settle a session. `status` is "completed" | "forfeited" | "cancelled".
 * Only a completed session pays out; a forfeited one earns nothing, which is
 * the entire deterrent.
 */
export async function finishSession(status) {
  const s = await getSession();
  if (!s) return null;
  const record = {
    startedAt: s.startedAt,
    endedAt: Date.now(),
    minutes: s.minutes,
    task: s.task,
    status,
    breaches: s.breaches || 0,
    rewardMinutes: status === "completed" ? s.rewardMinutes : 0,
    date: new Date(s.startedAt).toISOString().slice(0, 10),
  };
  await appendHistory(record);
  await clearSession();
  return record;
}

async function appendHistory(record) {
  try {
    const raw = await AsyncStorage.getItem(KEY_HISTORY);
    const list = raw ? JSON.parse(raw) : [];
    list.push(record);
    await AsyncStorage.setItem(KEY_HISTORY, JSON.stringify(list.slice(-50)));
  } catch {}
}

export async function getHistory() {
  try {
    const raw = await AsyncStorage.getItem(KEY_HISTORY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

/** Human-readable line for the result screen. */
export function describeResult(r) {
  if (!r) return "";
  switch (r.status) {
    case "completed":
      return `${r.minutes} minutes in the box. +${r.rewardMinutes} minutes earned.`;
    case "forfeited":
      return "Your phone left the box. No time earned this session.";
    case "cancelled":
      return "Session ended early. No time earned.";
    default:
      return "";
  }
}
