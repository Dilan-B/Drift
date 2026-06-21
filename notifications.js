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
let Notifications = null;
try { Notifications = require("expo-notifications"); } catch {}

const OUT_OF_TIME_ID = "drift-out-of-time";
const LOW_TIME_ID    = "drift-low-time";
const DAILY_ID       = "drift-daily-reminder";

let permissionGranted = null; // null = unknown, true/false once checked

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

/** Balance just hit zero — apps are (re)shielded. */
export async function notifyOutOfTime() {
  await fireImmediate(
    OUT_OF_TIME_ID,
    "Time's up",
    "Your earned screen time is gone. Complete a task to unlock again.",
  );
}

/** Balance is running low (called when crossing a small threshold). */
export async function notifyLowTime(minutesLeft) {
  const m = Math.max(1, Math.round(minutesLeft || 0));
  await fireImmediate(
    LOW_TIME_ID,
    "Running low",
    `About ${m} min of earned time left.`,
  );
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

/** Cancel everything Drift scheduled (e.g. on sign-out). */
export async function cancelAllNotifications() {
  if (!Notifications) return;
  try { await Notifications.cancelAllScheduledNotificationsAsync(); } catch {}
}
