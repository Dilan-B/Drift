/**
 * drift-blocker
 * JS face of the Android app blocker.
 *
 * Every function resolves to a safe default when the native module is missing
 * — iOS, Expo Go, or a JS bundle running against a binary built before this
 * module existed — so callers never need to branch on platform. `screenTime.js`
 * is the only file that should import this directly.
 */
import { Platform } from "react-native";

let Native = null;
try {
  // requireNativeModule throws rather than returning null when the module is
  // absent, which is why this is wrapped rather than null-checked.
  const { requireNativeModule } = require("expo-modules-core");
  Native = requireNativeModule("DriftBlocker");
} catch {}

export const isAvailable = () => Platform.OS === "android" && !!Native;

const EMPTY_STATUS = {
  usageAccess: false,
  overlay: false,
  accessibility: false,
  ready: false,
  serviceRunning: false,
  shieldActive: false,
  monitoring: false,
  balanceSeconds: 0,
  blockedCount: 0,
};

/**
 * The whole permission + enforcement picture in one call.
 *
 * Deliberately one call rather than four: the permission screen re-reads this
 * every time the app is foregrounded (the user leaves to a Settings screen and
 * comes back), and four separate bridge round-trips there would show the
 * checkboxes updating one after another.
 */
export async function getStatus() {
  if (!isAvailable()) return EMPTY_STATUS;
  try {
    return { ...EMPTY_STATUS, ...(await Native.getStatus()) };
  } catch {
    return EMPTY_STATUS;
  }
}

export async function openUsageAccessSettings() {
  if (!isAvailable()) return false;
  try { await Native.openUsageAccessSettings(); return true; } catch { return false; }
}

export async function openOverlaySettings() {
  if (!isAvailable()) return false;
  try { await Native.openOverlaySettings(); return true; } catch { return false; }
}

export async function openAccessibilitySettings() {
  if (!isAvailable()) return false;
  try { await Native.openAccessibilitySettings(); return true; } catch { return false; }
}

/** Every launchable app on the device: [{ packageName, label }]. */
export async function getInstalledApps() {
  if (!isAvailable()) return [];
  try { return (await Native.getInstalledApps()) || []; } catch { return []; }
}

export async function getBlockedApps() {
  if (!isAvailable()) return [];
  try { return (await Native.getBlockedApps()) || []; } catch { return []; }
}

export async function setBlockedApps(packageNames) {
  if (!isAvailable()) return 0;
  try { return await Native.setBlockedApps(packageNames || []); } catch { return 0; }
}

export async function applyShield() {
  if (!isAvailable()) return false;
  try { return !!(await Native.applyShield()); } catch { return false; }
}

export async function clearShield() {
  if (!isAvailable()) return false;
  try { return !!(await Native.clearShield()); } catch { return false; }
}

export async function startBalanceMonitoring(seconds) {
  if (!isAvailable()) return { started: false, reason: "unavailable" };
  try {
    await Native.startBalanceMonitoring(Math.max(0, Math.floor(Number(seconds) || 0)));
    return { started: true };
  } catch (e) {
    return { started: false, reason: e?.message || "unknown" };
  }
}

export async function stopBalanceMonitoring() {
  if (!isAvailable()) return false;
  try { return !!(await Native.stopBalanceMonitoring()); } catch { return false; }
}

/** Seconds of blocked-app use since the last read. Reading clears it. */
export async function consumeUsedSeconds() {
  if (!isAvailable()) return 0;
  try { return Number(await Native.consumeUsedSeconds()) || 0; } catch { return 0; }
}

/** True if the balance ran out while Drift was closed. Reading clears it. */
export async function consumeDepletedFlag() {
  if (!isAvailable()) return false;
  try { return !!(await Native.consumeDepletedFlag()); } catch { return false; }
}

export async function setAppearance(isDark) {
  if (!isAvailable()) return false;
  try { return !!(await Native.setAppearance(!!isDark)); } catch { return false; }
}

export async function getDiagnostics() {
  if (!isAvailable()) return { available: false };
  try { return await Native.getDiagnostics(); } catch (e) { return { error: e?.message }; }
}
