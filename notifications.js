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

let Notifications = null;
try { Notifications = require("expo-notifications"); } catch {}

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

/** Cancel everything Drift scheduled (e.g. on sign-out). */
export async function cancelAllNotifications() {
  if (!Notifications) return;
  try { await Notifications.cancelAllScheduledNotificationsAsync(); } catch {}
}
