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
import * as AndroidBlocker from "./modules/drift-blocker";

const Native = NativeModules.ScreenTimeModule;

/**
 * Android routes to a completely different mechanism — see
 * modules/drift-blocker. The two share nothing but this interface: iOS asks the
 * OS to shield apps and the OS enforces it; Android watches the foreground and
 * covers blocked apps with our own screen.
 *
 * Every function below branches on Android FIRST and leaves the iOS path
 * untouched underneath, so nothing here can change iOS behaviour.
 *
 * The one thing that does not map is presentAppPicker: Apple ships a system
 * sheet and hides the chosen bundle IDs, Android has no picker at all, so the
 * app has to render its own list. It returns false on Android and the UI layer
 * opens AndroidBlockerModal instead.
 */
const IS_ANDROID = Platform.OS === "android";

/**
 * True when the iOS native module is actually present.
 *
 * Distinct from isAvailable() and load-bearing. isAvailable() now answers "can
 * Drift block apps on this device", which is true on Android — so the features
 * that exist ONLY on iOS (widgets, Live Activities, Health, Siri) must NOT gate
 * on it. Reaching `Native.foo` on Android after an isAvailable() check would
 * dereference an undefined module and throw a TypeError, not no-op.
 */
const hasIOSNative = () =>
  Platform.OS === "ios" && !!Native && typeof Native.applyShield === "function";

export const isAvailable = () =>
  hasIOSNative() || (IS_ANDROID && AndroidBlocker.isAvailable());

/** Android-only: the full permission + enforcement picture. */
export const getAndroidStatus = () => AndroidBlocker.getStatus();
export const androidBlocker = AndroidBlocker;

export async function requestAuthorization() {
  if (IS_ANDROID) {
    // Nothing to request: both Android permissions are granted in Settings
    // screens, not dialogs. Report what is currently true and let the caller
    // send the user to AndroidBlockerModal if it is not enough.
    const st = await AndroidBlocker.getStatus();
    return st.ready ? "approved" : "denied";
  }
  if (!isAvailable()) return "unavailable";
  try { return await Native.requestAuthorization(); }
  catch (e) { return `error:${e?.message || "unknown"}`; }
}

export async function getAuthorizationStatus() {
  if (IS_ANDROID) {
    const st = await AndroidBlocker.getStatus();
    return st.ready ? "approved" : "denied";
  }
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
  // No system picker exists on Android; the caller shows AndroidBlockerModal.
  if (IS_ANDROID) return false;
  if (!isAvailable()) return false;
  try { await Native.presentFamilyActivityPicker(); return true; }
  catch { return false; }
}

/** Shield all app categories (free tier — blocks social, entertainment, etc.). */
export async function applyShieldCategories() {
  // Android has no notion of app CATEGORIES - the user picks apps by name -
  // so the category shield collapses onto the ordinary one.
  if (IS_ANDROID) return AndroidBlocker.applyShield();
  if (!isAvailable() || typeof Native.applyShieldCategories !== "function") return false;
  try { await Native.applyShieldCategories(); return true; }
  catch { return false; }
}

/** Shield the user's previously picked apps. Safe to call repeatedly. */
export async function applyShield() {
  if (IS_ANDROID) return AndroidBlocker.applyShield();
  if (!isAvailable()) return false;
  try { await Native.applyShield(); return true; }
  catch { return false; }
}

/** Remove the shield. Safe to call when no shield is active. */
export async function clearShield() {
  if (IS_ANDROID) { await AndroidBlocker.clearShield(); return; }
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
  if (IS_ANDROID) return AndroidBlocker.startBalanceMonitoring(seconds);
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
  if (IS_ANDROID) { await AndroidBlocker.stopBalanceMonitoring(); return; }
  if (!isAvailable()) return;
  try { await Native.stopBalanceMonitoring(); } catch {}
}

/**
 * Returns seconds of blocked-app usage iOS counted since last read. Resets counter.
 */
export async function consumeUsedSeconds() {
  if (IS_ANDROID) return AndroidBlocker.consumeUsedSeconds();
  if (!isAvailable()) return 0;
  try { return (await Native.consumeUsedSeconds()) || 0; }
  catch { return 0; }
}

/**
 * Returns true if iOS depleted the user's balance while Drift was closed
 * (the DriftMonitor extension fired). Reading also clears the flag.
 */
export async function consumeDepletedFlag() {
  if (IS_ANDROID) return AndroidBlocker.consumeDepletedFlag();
  if (!isAvailable()) return false;
  try { return !!(await Native.consumeDepletedFlag()); }
  catch { return false; }
}

/** Persist the current earned balance to App Group storage for widgets. */
export async function updateSharedBalance(seconds) {
  if (!hasIOSNative() || typeof Native.updateSharedBalance !== "function") return false;
  try {
    await Native.updateSharedBalance(Math.max(0, Math.floor(Number(seconds) || 0)));
    return true;
  } catch {
    return false;
  }
}

export async function consumePendingHealthEarn() {
  if (!hasIOSNative() || typeof Native.consumePendingHealthEarn !== "function") return 0;
  try { return Math.max(0, Number(await Native.consumePendingHealthEarn()) || 0); }
  catch { return 0; }
}

export async function startDriftInLiveActivity(title, seconds) {
  if (!hasIOSNative() || typeof Native.startDriftInLiveActivity !== "function") {
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
  if (!hasIOSNative() || typeof Native.updateDriftInLiveActivity !== "function") return false;
  try {
    await Native.updateDriftInLiveActivity(Math.max(0, Math.floor(Number(seconds) || 0)));
    return true;
  } catch {
    return false;
  }
}

export async function endDriftInLiveActivity() {
  if (!hasIOSNative() || typeof Native.endDriftInLiveActivity !== "function") return false;
  try {
    await Native.endDriftInLiveActivity();
    return true;
  } catch {
    return false;
  }
}

export async function setProStatus(isPro) {
  if (!hasIOSNative() || typeof Native.setProStatus !== "function") return;
  try { await Native.setProStatus(!!isPro); } catch {}
}

/**
 * Mirror the in-app theme toggle into the shared App Group so the shield
 * (block screen) renders in the same light/dark theme as the app.
 */
export async function setAppearance(isDark) {
  if (IS_ANDROID) { await AndroidBlocker.setAppearance(isDark); return; }
  if (!isAvailable() || typeof Native.setAppearance !== "function") return;
  try { await Native.setAppearance(!!isDark); } catch {}
}

/**
 * Consume any pending Siri / App Intents handoff.
 * Returns { taskName?: string, driftInMinutes?: number } and clears the flags.
 */
export async function consumePendingSiriTask() {
  if (!hasIOSNative() || typeof Native.consumePendingSiriTask !== "function") return {};
  try { return (await Native.consumePendingSiriTask()) || {}; }
  catch { return {}; }
}

/** Return a diagnostics dump for debugging the DeviceActivity pipeline. */
export async function getDiagnostics() {
  if (IS_ANDROID) return AndroidBlocker.getDiagnostics();
  if (!isAvailable()) return { available: false };
  try { return await Native.getDiagnostics(); }
  catch (e) { return { error: e?.message }; }
}
