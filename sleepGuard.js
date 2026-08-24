/**
 * sleepGuard.js
 * "Phone in another room" overnight guard.
 *
 * THE DEAL
 *   Before bed the user carries their phone to another room and taps an NFC
 *   tag they've stuck there. That tap arms the guard. In the morning Drift
 *   checks whether the phone actually stayed put all night.
 *
 * WHY IT VERIFIES THE WAY IT DOES
 *   Core NFC cannot poll — every read is a physical tap with the app in the
 *   foreground, so the tag can only ever prove "the phone was here at this
 *   instant". It is the arming step and nothing more.
 *
 *   The overnight check is CMMotionActivityManager instead. iOS records motion
 *   activity continuously on the motion coprocessor regardless of whether Drift
 *   is running, so we query that recorded timeline after the fact. It costs no
 *   battery, survives a force-quit, and can't be defeated by iOS suspending us.
 *   You cannot carry a phone to another room without generating a walking
 *   segment, which is the failure mode that actually matters.
 *
 * WHAT IT DOESN'T CLAIM
 *   This is self-imposed accountability, not access control. A determined user
 *   can leave the phone still and sleep next to it. That's fine — the point is
 *   making the easy path the honest one.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeModules, Platform } from "react-native";

const Native = NativeModules.SleepGuardModule;

const KEY_TAG     = "drift_sleepguard_tag";      // the registered tag's UID
const KEY_ARMED   = "drift_sleepguard_armed";    // the in-flight night
const KEY_HISTORY = "drift_sleepguard_history";  // last 30 nights
const KEY_PREFS   = "drift_sleepguard_prefs";    // reward + reminder time

/** Minutes of armed time below which a night doesn't count. Stops someone
 *  arming at 6:58am to farm the reward. */
// 4 hours in production. A real verification needs a real night, which makes
// the feature impossible to iterate on — so dev builds settle after 2 minutes.
// __DEV__ is false in release/TestFlight, so shipped builds keep the 4h floor.
const MIN_NIGHT_MINUTES = __DEV__ ? 2 : 240;

/** Share of samples that must read stationary. Not 1.0: a phone on a dresser
 *  picks up stray samples from a passing truck or a slammed door. */
const MIN_STATIONARY_RATIO = 0.8;

export const isAvailable = () =>
  Platform.OS === "ios" && !!Native && typeof Native.scanTag === "function";

// ── Capability checks ────────────────────────────────────────
export async function nfcAvailable() {
  if (!isAvailable()) return false;
  try { return !!(await Native.isNfcAvailable()); } catch { return false; }
}

export async function motionAuthStatus() {
  if (!isAvailable()) return "unavailable";
  try { return await Native.motionAuthStatus(); } catch { return "unknown"; }
}

export async function requestMotionAuth() {
  if (!isAvailable()) return "unavailable";
  try { return await Native.requestMotionAuth(); } catch { return "unknown"; }
}

/**
 * Present the NFC sheet. Resolves { id } or throws.
 * Throws code "cancelled" when the user dismisses the sheet — callers should
 * treat that as a no-op, not an error worth showing.
 */
export async function scanTag() {
  if (!isAvailable()) throw new Error("unavailable");
  return await Native.scanTag();
}

// ── Tag registration ─────────────────────────────────────────
export async function getRegisteredTag() {
  try { return await AsyncStorage.getItem(KEY_TAG); } catch { return null; }
}

/** Scan a tag and remember it as THE tag for this user's bedroom setup. */
export async function registerTag() {
  const { id } = await scanTag();
  await AsyncStorage.setItem(KEY_TAG, id);
  return id;
}

export async function clearTag() {
  await AsyncStorage.multiRemove([KEY_TAG, KEY_ARMED]).catch(() => {});
}

// ── Preferences ──────────────────────────────────────────────
// Reward size and reminder time were hardcoded (30 min, 21:45). Reasonable
// defaults, but bedtimes vary enough that a fixed 21:45 nudge is noise for
// half the people who'd otherwise use this.
export const DEFAULT_PREFS = {
  rewardMinutes: 30,
  reminderHour: 21,
  reminderMinute: 45,
};

export async function getPrefs() {
  try {
    const raw = await AsyncStorage.getItem(KEY_PREFS);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : { ...DEFAULT_PREFS };
  } catch { return { ...DEFAULT_PREFS }; }
}

export async function setPrefs(patch) {
  const next = { ...(await getPrefs()), ...patch };
  await AsyncStorage.setItem(KEY_PREFS, JSON.stringify(next)).catch(() => {});
  return next;
}

// ── Arming ───────────────────────────────────────────────────
export async function getArmed() {
  try {
    const raw = await AsyncStorage.getItem(KEY_ARMED);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/**
 * Tap the registered tag to start a night. Rejects a different tag, so the
 * user can't just tap any tag on the fridge next to their bed.
 */
export async function armForNight({ rewardMinutes } = {}) {
  // Falls back to the stored preference so callers don't have to know it.
  const mins = rewardMinutes ?? (await getPrefs()).rewardMinutes;
  const registered = await getRegisteredTag();
  if (!registered) return { armed: false, reason: "no_tag" };

  const { id } = await scanTag();
  if (id !== registered) return { armed: false, reason: "wrong_tag" };

  const motion = await motionAuthStatus();
  if (motion !== "authorized") return { armed: false, reason: "motion_denied", motion };

  const session = { startedAt: Date.now(), tagId: id, rewardMinutes: mins };
  await AsyncStorage.setItem(KEY_ARMED, JSON.stringify(session));
  return { armed: true, session };
}

export async function cancelNight() {
  await AsyncStorage.removeItem(KEY_ARMED).catch(() => {});
}

// ── Verification ─────────────────────────────────────────────
/**
 * Settle the armed night. Safe to call on every foreground — returns
 * { status: "none" } when there's nothing in flight.
 *
 * status: none | too_short | unavailable | inconclusive | moved | success
 */
export async function verifyNight() {
  const session = await getArmed();
  if (!session) return { status: "none" };

  const startSec = Math.floor(session.startedAt / 1000);
  const endSec   = Math.floor(Date.now() / 1000);
  const minutes  = Math.round((endSec - startSec) / 60);

  // Check motion BEFORE the duration gate. A night that is already ruined
  // should say so the moment the user next opens Drift, not stay silently
  // "in progress" until the minimum elapses. iOS will not run us while the
  // phone sits in another room, so this foreground moment is the earliest
  // point we can possibly tell them.
  let early;
  try {
    early = await Native.checkStillness(startSec, endSec);
  } catch {
    early = null;
  }
  if (early?.conclusive && (early.moved || early.movementEvents > 0)) {
    await AsyncStorage.removeItem(KEY_ARMED).catch(() => {});
    const rec = {
      date: new Date(session.startedAt).toISOString().slice(0, 10),
      startedAt: session.startedAt,
      endedAt: Date.now(),
      minutes,
      status: "moved",
      rewardMinutes: 0,
      firstMovementAt: early.firstMovementAt || null,
      stationaryRatio: early.stationaryRatio ?? null,
    };
    await appendHistory(rec);
    return { status: "moved", ...rec };
  }

  if (minutes < MIN_NIGHT_MINUTES) {
    return { status: "too_short", minutes, needed: MIN_NIGHT_MINUTES };
  }

  let result;
  try {
    result = await Native.checkStillness(startSec, endSec);
  } catch (e) {
    // Don't consume the session — a transient query failure shouldn't cost
    // the user their night. They can try again on the next foreground.
    return { status: "unavailable", error: e?.message };
  }

  await AsyncStorage.removeItem(KEY_ARMED).catch(() => {});

  let status;
  if (!result.conclusive) {
    // iOS recorded nothing for the window. Give the benefit of the doubt
    // rather than punishing a device that simply wasn't logging.
    status = "inconclusive";
  } else if (result.moved || result.stationaryRatio < MIN_STATIONARY_RATIO) {
    status = "moved";
  } else {
    status = "success";
  }

  const record = {
    date: new Date(session.startedAt).toISOString().slice(0, 10),
    startedAt: session.startedAt,
    endedAt: Date.now(),
    minutes,
    status,
    rewardMinutes: status === "success" ? session.rewardMinutes : 0,
    firstMovementAt: result.firstMovementAt || null,
    stationaryRatio: result.stationaryRatio ?? null,
  };
  await appendHistory(record);

  return { status, ...record };
}

async function appendHistory(record) {
  try {
    const raw = await AsyncStorage.getItem(KEY_HISTORY);
    const list = raw ? JSON.parse(raw) : [];
    list.push(record);
    await AsyncStorage.setItem(KEY_HISTORY, JSON.stringify(list.slice(-30)));
  } catch {}
}

export async function getHistory() {
  try {
    const raw = await AsyncStorage.getItem(KEY_HISTORY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

/** Consecutive successful nights, most recent first. */
export async function getStreak() {
  const list = await getHistory();
  let n = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].status === "success") n++;
    else break;
  }
  return n;
}

/** Human-readable line for the morning result. */
export function describeResult(r) {
  switch (r?.status) {
    case "success":
      return `Your phone stayed put all night. +${r.rewardMinutes} minutes earned.`;
    case "moved":
      return r.firstMovementAt
        ? `Your phone moved at ${new Date(r.firstMovementAt * 1000)
            .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. No bonus this time.`
        : "Your phone moved during the night. No bonus this time.";
    case "too_short":
      return `Only ${r.minutes} minutes so far. A night needs at least ${Math.round(r.needed / 60)} hours.`;
    case "inconclusive":
      return "Couldn't read motion history for last night. Giving you the benefit of the doubt.";
    case "unavailable":
      return "Motion data isn't available right now. We'll check again shortly.";
    default:
      return "";
  }
}
