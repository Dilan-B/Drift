/**
 * backgroundRefresh.js
 * iOS Background App Refresh (BGTaskScheduler via expo-background-task).
 *
 * IMPORTANT — what this does and does NOT do:
 *  - iOS does NOT keep the app running. It grants brief, OPPORTUNISTIC wake-ups
 *    (timing is iOS's call — could be ~every 15+ min, hours apart, or skipped on
 *    low battery / if the user rarely opens the app). You cannot tick a timer here.
 *  - So this task RECONCILES on each wake instead of "running in the background":
 *      1. flush any balance/XP writes that failed while offline,
 *      2. apply any blocked-app usage / depletion the DeviceActivityMonitor
 *         extension recorded while we were away,
 *      3. push the corrected balance to the server.
 *  - The real, reliable background enforcement is still the DriftMonitor
 *    DeviceActivity extension. This is a belt-and-suspenders complement.
 */
import * as TaskManager from "expo-task-manager";
import * as BackgroundTask from "expo-background-task";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { syncProfileStats, flushPendingStats } from "./sync";
import { consumeUsedSeconds, consumeDepletedFlag, isAvailable } from "./screenTime";

export const BG_REFRESH_TASK = "drift-balance-refresh";

TaskManager.defineTask(BG_REFRESH_TASK, async () => {
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data?.session?.user?.id;
    if (!userId) return BackgroundTask.BackgroundTaskResult.Success;

    // 1. Retry balance/XP writes that failed offline.
    await flushPendingStats(userId);

    // 2. Reconcile local balance against native usage while away.
    if (isAvailable()) {
      const depleted = await consumeDepletedFlag();
      const used = await consumeUsedSeconds();

      const raw = await AsyncStorage.getItem("drift_v4");
      if (raw) {
        const p = JSON.parse(raw);
        const c = p.credits || { balance: 0, balanceSec: 0, earned: 0, spent: 0 };
        const oldSec = Math.max(0, c.balanceSec || 0);

        let newSec = oldSec;
        if (depleted) newSec = 0;
        else if (used > 0) newSec = Math.max(0, oldSec - used);

        if (newSec !== oldSec) {
          const spentDelta = Math.floor((oldSec - newSec) / 60);
          const nc = {
            balance: newSec > 0 ? Math.ceil(newSec / 60) : 0,
            balanceSec: newSec,
            earned: c.earned || 0,
            spent: Math.min(c.earned || 0, (c.spent || 0) + spentDelta),
          };
          p.credits = nc;
          await AsyncStorage.setItem("drift_v4", JSON.stringify(p));
          // 3. Mirror to the server so the boot restore can't resurrect it.
          await syncProfileStats(userId, { balanceSeconds: newSec });
        }
      }
    }

    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (e) {
    console.warn("[bg-refresh]", e?.message || e);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Register the periodic background reconcile. Safe to call repeatedly. */
export async function registerBackgroundRefresh() {
  try {
    const status = await BackgroundTask.getStatusAsync();
    // Restricted => user disabled Background App Refresh in iOS Settings, or
    // low-power mode. Nothing we can do; the extension still enforces.
    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) return false;

    const already = await TaskManager.isTaskRegisteredAsync(BG_REFRESH_TASK);
    if (!already) {
      // minimumInterval is a floor in MINUTES — iOS decides the real cadence.
      await BackgroundTask.registerTaskAsync(BG_REFRESH_TASK, { minimumInterval: 15 });
    }
    return true;
  } catch (e) {
    console.warn("[bg-refresh] register failed:", e?.message || e);
    return false;
  }
}

export async function unregisterBackgroundRefresh() {
  try {
    if (await TaskManager.isTaskRegisteredAsync(BG_REFRESH_TASK)) {
      await BackgroundTask.unregisterTaskAsync(BG_REFRESH_TASK);
    }
  } catch {}
}
