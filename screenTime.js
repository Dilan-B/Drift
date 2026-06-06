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
