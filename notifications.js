/**
 * notifications.js
 * Thin wrapper around expo-notifications for Drift's LOCAL notifications.
 *
 * All notifications here are local (no server / push token needed). They cover:
 *   - "out of earned time"  (immediate, when the balance hits 0)
 *   - "running low"         (immediate, when the balance crosses a small threshold)
 *   - daily earn/streak reminder (repeating, scheduled)
 *
 * Caveat: JS only runs while the app is alive/foregrounding, so these fire on
 * the next drain/reconcile, not necessarily the instant the balance depletes
 * while Drift is force-quit. A true background "out of time" notification is
 * posted from the DriftMonitor extension (native) — see the plan's Phase 2.
 *
 * Requires `expo-notifications` (install: npx expo install expo-notifications)
 * and a dev/standalone build. Every call is wrapped so a missing module or
 * denied permission is a safe no-op.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { supabase } from "./supabase";

let Notifications = null;
try { Notifications = require("expo-notifications"); } catch {}

let Constants = null;
try { Constants = require("expo-constants")?.default; } catch {}

const OUT_OF_TIME_ID = "drift-out-of-time";
const LOW_TIME_ID    = "drift-low-time";
const DAILY_ID       = "drift-daily-reminder";

// ── "Time's up" / "running low" latches ──────────────────────
// Running out of time is ONE event, but several code paths notice it (the
// drain tick, the native-monitor reconcile on every foreground). Without a
// latch the user got a fresh notification every reopen for the same thing.
//
// These flags are persisted, not just in-memory, because reopening the app
// rebuilds all state — an in-memory guard would reset and spam again. The
// latch clears only when the balance goes positive again (resetTimeNotices),
// so each depletion episode produces exactly one notification.
const OUT_LATCH_KEY = "drift_notified_out_of_time";
const LOW_LATCH_KEY = "drift_notified_low_time";

// Mirrors of the persisted flags so back-to-back calls in the same tick can't
// both slip through before the AsyncStorage write lands.
let outLatched = null; // null = unknown (read from storage on first use)
let lowLatched = null;

let permissionGranted = null; // null = unknown, true/false once checked

async function isLatched(key, mem) {
  if (mem !== null) return mem;
  try { return (await AsyncStorage.getItem(key)) === "1"; } catch { return false; }
}

async function setLatch(key, value) {
  try {
    if (value) await AsyncStorage.setItem(key, "1");
    else await AsyncStorage.removeItem(key);
  } catch {}
}

// Show notifications even when the app is foregrounded.
if (Notifications) {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,   // older expo-notifications
        shouldShowBanner: true,  // newer expo-notifications
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  } catch {}
}

export async function requestNotificationPermission() {
  if (!Notifications) return false;
  try {
    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    permissionGranted = status === "granted";
    return permissionGranted;
  } catch {
    permissionGranted = false;
    return false;
  }
}

async function ensureGranted() {
  if (!Notifications) return false;
  if (permissionGranted === null) await requestNotificationPermission();
  return permissionGranted === true;
}

async function fireImmediate(identifier, title, body) {
  if (!(await ensureGranted())) return;
  try {
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: { title, body },
      trigger: null, // null = deliver immediately
    });
  } catch {}
}

/**
 * Balance just hit zero — apps are (re)shielded.
 * Safe to call from every path that notices depletion: only the first call
 * per episode actually notifies. Cleared by resetTimeNotices() when the user
 * earns time again.
 */
export async function notifyOutOfTime() {
  if (await isLatched(OUT_LATCH_KEY, outLatched)) return;
  outLatched = true;            // set before awaiting, so a concurrent call bails
  await setLatch(OUT_LATCH_KEY, true);
  await fireImmediate(
    OUT_OF_TIME_ID,
    "Time's up",
    "Your earned screen time is gone. Complete a task to unlock again.",
  );
}

/** Balance is running low (called when crossing a small threshold). Latched
 *  the same way so re-opening the app on a low balance doesn't re-warn. */
export async function notifyLowTime(minutesLeft) {
  if (await isLatched(LOW_LATCH_KEY, lowLatched)) return;
  lowLatched = true;
  await setLatch(LOW_LATCH_KEY, true);
  const m = Math.max(1, Math.round(minutesLeft || 0));
  await fireImmediate(
    LOW_TIME_ID,
    "Running low",
    `About ${m} min of earned time left.`,
  );
}

/**
 * Re-arm the time notices. Call whenever the balance goes positive again — the
 * next depletion is a new episode and deserves exactly one new notification.
 * Also dismisses any stale "Time's up" banner still sitting in the tray.
 */
/**
 * Morning result for the overnight "phone in another room" guard. Fired on the
 * first foreground after a night is verified, so the outcome reaches the user
 * even if they don't open Drift.
 *
 * Not latched: a night is verified exactly once (verifyNight consumes the armed
 * session), so there is no repeat to guard against.
 */
export async function notifySleepGuardResult({ status, rewardMinutes, firstMovementAt }) {
  if (status === "success") {
    await fireImmediate(
      "drift-sleepguard-result",
      "Your phone stayed put",
      `A full night in the other room. +${Math.max(1, Math.round(rewardMinutes || 0))} minutes earned.`,
    );
    return;
  }
  if (status === "moved") {
    const when = firstMovementAt
      ? new Date(firstMovementAt * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : null;
    await fireImmediate(
      "drift-sleepguard-result",
      "Your phone moved last night",
      when ? `It was picked up around ${when}. No bonus this time.` : "No bonus this time.",
    );
  }
}

export async function resetTimeNotices() {
  outLatched = false;
  lowLatched = false;
  await setLatch(OUT_LATCH_KEY, false);
  await setLatch(LOW_LATCH_KEY, false);
  if (!Notifications) return;
  try {
    await Notifications.dismissNotificationAsync(OUT_OF_TIME_ID).catch(() => {});
    await Notifications.dismissNotificationAsync(LOW_TIME_ID).catch(() => {});
  } catch {}
}

/** Schedule (or reschedule) a once-a-day earn/streak reminder. */
export async function scheduleDailyReminder(hour = 10, minute = 0) {
  if (!(await ensureGranted())) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(DAILY_ID).catch(() => {});
    const trigger = Notifications.SchedulableTriggerInputTypes
      ? { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute }
      : { hour, minute, repeats: true }; // fallback for older versions
    await Notifications.scheduleNotificationAsync({
      identifier: DAILY_ID,
      content: {
        title: "Keep your streak",
        body: "Complete a task today to earn screen time.",
      },
      trigger,
    });
  } catch {}
}

/** A friend request just arrived. Unique id per sender so several can stack. */
export async function notifyFriendRequest(fromUsername) {
  if (!(await ensureGranted())) return;
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: `drift-friend-req-${fromUsername || "x"}`,
      content: {
        title: "New friend request",
        body: fromUsername ? `@${fromUsername} wants to grow with you on Drift.` : "Someone wants to add you on Drift.",
      },
      trigger: null,
    });
  } catch {}
}

/** A child submitted a task — the parent should approve it. Local, so it only
 *  fires while the parent's app is alive (realtime keeps it connected). True
 *  background push would need push tokens + a server send (follow-up). */
export async function notifyChildSubmittedTask(taskTitle) {
  if (!(await ensureGranted())) return;
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: `drift-child-submit-${taskTitle || "task"}`,
      content: {
        title: "Task ready to check",
        body: taskTitle ? `Your kid finished "${taskTitle}". Approve it to grant screen time.`
                        : "Your kid finished a task. Approve it to grant screen time.",
      },
      trigger: null,
    });
  } catch {}
}

/** A parent approved the child's task — the child earned time. */
export async function notifyTaskApproved(minutes) {
  const m = Math.max(1, Math.round(minutes || 0));
  await fireImmediate("drift-task-approved", "Task approved", `You earned ${m} more minutes of screen time.`);
}

/**
 * A friend challenged you.
 *
 * Identifier is keyed on the challenge id, not the sender: two challenges from
 * the same person are two events, and reusing an identifier makes the second
 * REPLACE the first rather than stack — the same bug the place-arrival
 * notifications had.
 */
export async function notifyChallengeReceived(fromUsername, title, challengeId) {
  if (!(await ensureGranted())) return;
  const who = fromUsername ? `@${fromUsername}` : "A friend";
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: `drift-challenge-${challengeId || Date.now()}`,
      content: {
        title: `${who} challenged you`,
        body: title ? `"${title}" — open Drift to accept or decline.` : "Open Drift to accept or decline.",
        data: { type: "challenge_received", challengeId },
      },
      trigger: null,
    });
  } catch {}
}

// ── Leaderboard nudge ────────────────────────────────────────
// At most ONE per local day, and only when the user is actually behind.
//
// The latch is keyed by day rather than being a boolean, so it self-clears at
// midnight without needing a reset call — the same trick would have saved the
// out-of-time latch a reset path. Written BEFORE the notification is scheduled:
// a duplicate nudge is worse than a missed one, and this is called from a
// foreground handler that can fire twice in quick succession.
const LEADERBOARD_LATCH_KEY = "drift_notified_leaderboard_day";

const localDayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * "You're behind on the leaderboard today."
 *
 * @param aheadCount how many friends have LESS screen time than you
 * @param total      how many friends are on today's board
 * @param leaderName the friend currently in first place
 * @returns true if a notification was posted
 *
 * Deliberately not sent when the user is winning, and not sent when nobody has
 * reported — a nudge that fires every day regardless of standing is just noise,
 * and people turn the whole category off after a week of it.
 */
export async function notifyLosingOnLeaderboard({ aheadCount, total, leaderName, myMinutes } = {}) {
  if (!aheadCount || aheadCount < 1) return false;
  if (!(await ensureGranted())) return false;

  const today = localDayKey();
  try {
    if ((await AsyncStorage.getItem(LEADERBOARD_LATCH_KEY)) === today) return false;
    await AsyncStorage.setItem(LEADERBOARD_LATCH_KEY, today);
  } catch {
    // Storage unavailable: skip rather than risk notifying on every foreground.
    return false;
  }

  const mins = Math.max(0, Math.round(myMinutes || 0));
  const spent = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
  const body = aheadCount === 1 && leaderName
    ? `@${leaderName} is on less screen time than you today. You're at ${spent}.`
    : `${aheadCount} of your ${total} friends are on less screen time than you today. You're at ${spent}.`;

  try {
    await Notifications.scheduleNotificationAsync({
      identifier: `drift-leaderboard-${today}`,
      content: { title: "You're slipping down the grove", body, data: { type: "leaderboard_nudge" } },
      trigger: null,
    });
    return true;
  } catch {
    return false;
  }
}

// ── Remote push token registration ──────────────────────────
/**
 * Request push permission, obtain the Expo push token, and save it to the
 * push_tokens table in Supabase. Call after login / on app launch once the
 * user is authenticated. Safe to call repeatedly — the unique constraint on
 * (user_id, expo_push_token) prevents duplicates.
 *
 * Returns the token string on success, or null on failure / denied permission.
 */
export async function registerForPushNotifications() {
  if (!Notifications) return null;
  try {
    const granted = await requestNotificationPermission();
    if (!granted) return null;

    // Expo push tokens require a projectId in EAS builds.
    const projectId = Constants?.expoConfig?.extra?.eas?.projectId
      ?? Constants?.easConfig?.projectId;

    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token = tokenData?.data;
    if (!token) return null;

    // Get the current user.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    // Upsert into push_tokens (conflict on the unique constraint just updates).
    await supabase.from("push_tokens").upsert(
      {
        user_id: user.id,
        expo_push_token: token,
        platform: Platform.OS || "ios",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,expo_push_token" },
    );

    return token;
  } catch (err) {
    console.warn("registerForPushNotifications failed:", err);
    return null;
  }
}

/** Cancel everything Drift scheduled (e.g. on sign-out). */
export async function cancelAllNotifications() {
  if (!Notifications) return;
  try { await Notifications.cancelAllScheduledNotificationsAsync(); } catch {}
}
