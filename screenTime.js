/**
 * screenTime.js
 * Thin JS wrapper around the native ScreenTimeModule (iOS).
 *
 * The native module is iOS-only and requires:
 *  - iOS 16+
 *  - Family Controls entitlement (com.apple.developer.family-controls)
 *  - A custom dev client / standalone build (will NOT work in Expo Go)
 *
 * In Expo Go or on Android, every call resolves to a safe no-op so callers
 * don't need platform branching.
 */
import { NativeModules, Platform } from "react-native";

const Native = NativeModules.ScreenTimeModule;

export const isAvailable = () =>
  Platform.OS === "ios" && !!Native && typeof Native.applyShield === "function";

export async function requestAuthorization() {
  if (!isAvailable()) return "unavailable";
  try { return await Native.requestAuthorization(); }
  catch (e) { return `error:${e?.message || "unknown"}`; }
}

export async function getAuthorizationStatus() {
  if (!isAvailable()) return "unavailable";
  try { return await Native.getAuthorizationStatus(); }
  catch { return "unknown"; }
}

/**
 * Presents Apple's FamilyActivityPicker so the user can choose which apps,
 * categories, and web domains to block. The selection is persisted natively;
 * we never see the bundle IDs (Apple intentionally hides them).
 */
export async function presentAppPicker() {
  if (!isAvailable()) return false;
  try { await Native.presentFamilyActivityPicker(); return true; }
  catch { return false; }
}

/** Shield the user's previously picked apps. Safe to call repeatedly. */
export async function applyShield() {
  if (!isAvailable()) return false;
  try { await Native.applyShield(); return true; }
  catch { return false; }
}

/** Remove the shield. Safe to call when no shield is active. */
export async function clearShield() {
  if (!isAvailable()) return;
  try { await Native.clearShield(); } catch {}
}

/**
 * Ask iOS to count usage of the user's blocked apps for `seconds` total.
 * When usage hits that threshold the DriftMonitor extension fires and
 * applies the shield — even if the main app has been force-quit.
 *
 * Call this whenever the user's balance becomes positive (they earned time).
 * Pass the exact remaining seconds so iOS fires at the right moment.
 */
export async function startBalanceMonitoring(seconds) {
  if (!isAvailable()) return { started: false, reason: "unavailable" };
  try {
    await Native.startBalanceMonitoring(Math.max(5, Math.floor(seconds)));
    return { started: true };
  } catch (e) {
    return { started: false, reason: e?.message || "unknown" };
  }
}

/** Cancel any pending DeviceActivity monitor. */
export async function stopBalanceMonitoring() {
  if (!isAvailable()) return;
  try { await Native.stopBalanceMonitoring(); } catch {}
}

/**
 * Returns seconds of blocked-app usage iOS counted since last read. Resets counter.
 */
export async function consumeUsedSeconds() {
  if (!isAvailable()) return 0;
  try { return (await Native.consumeUsedSeconds()) || 0; }
  catch { return 0; }
}

/**
 * Returns true if iOS depleted the user's balance while Drift was closed
 * (the DriftMonitor extension fired). Reading also clears the flag.
 */
export async function consumeDepletedFlag() {
  if (!isAvailable()) return false;
  try { return !!(await Native.consumeDepletedFlag()); }
  catch { return false; }
}

/** Persist the current earned balance to App Group storage for widgets. */
export async function updateSharedBalance(seconds) {
  if (!isAvailable() || typeof Native.updateSharedBalance !== "function") return false;
  try {
    await Native.updateSharedBalance(Math.max(0, Math.floor(Number(seconds) || 0)));
    return true;
  } catch {
    return false;
  }
}

export async function consumePendingHealthEarn() {
  if (!isAvailable() || typeof Native.consumePendingHealthEarn !== "function") return 0;
  try { return Math.max(0, Number(await Native.consumePendingHealthEarn()) || 0); }
  catch { return 0; }
}

export async function startDriftInLiveActivity(title, seconds) {
  if (!isAvailable() || typeof Native.startDriftInLiveActivity !== "function") {
    return { started: false, reason: "unavailable" };
  }
  try {
    return await Native.startDriftInLiveActivity(
      String(title || "Drift In"),
      Math.max(60, Math.floor(Number(seconds) || 0))
    );
  } catch (e) {
    return { started: false, reason: e?.message || "unknown" };
  }
}

export async function updateDriftInLiveActivity(seconds) {
  if (!isAvailable() || typeof Native.updateDriftInLiveActivity !== "function") return false;
  try {
    await Native.updateDriftInLiveActivity(Math.max(0, Math.floor(Number(seconds) || 0)));
    return true;
  } catch {
    return false;
  }
}

export async function endDriftInLiveActivity() {
  if (!isAvailable() || typeof Native.endDriftInLiveActivity !== "function") return false;
  try {
    await Native.endDriftInLiveActivity();
    return true;
  } catch {
    return false;
  }
}

/** Return a diagnostics dump for debugging the DeviceActivity pipeline. */
export async function getDiagnostics() {
  if (!isAvailable()) return { available: false };
  try { return await Native.getDiagnostics(); }
  catch (e) { return { error: e?.message }; }
}
