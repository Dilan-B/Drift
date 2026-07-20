/**
 * blockedApps.js
 * Storage + native bridge for the user's blocked-apps list.
 *
 * IMPORTANT — what works where:
 *
 *  • Expo Go (today):
 *      Stores the list locally. We CANNOT actually block other apps from
 *      Expo Go — no Apple/Google API is exposed. The app uses this list
 *      to show banners ("you should be focused") if the user re-opens
 *      Drift mid-session, and to know what to block once you add native
 *      modules.
 *
 *  • iOS dev client + Family Controls entitlement:
 *      Add `react-native-screen-time-api` (or your own bridge to the
 *      ManagedSettings / DeviceActivity frameworks). Call
 *      `nativeBlocker.apply(list)` when a focus task starts and
 *      `nativeBlocker.clear()` when it ends.
 *
 *  • Android dev client + accessibility service:
 *      Add `react-native-accessibility-engine` or a custom service that
 *      uses UsageStatsManager. Wire it to the same hooks below.
 *
 * The functions below are written so that swapping in real native modules
 * is a one-line change in `applyBlocking` / `clearBlocking`.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { fetchBlockedApps, syncBlockedApps, cache } from "./sync";

const KEY = "drift_blocked_apps";

// A small starter list of common attention-killers. The user can edit it.
export const SUGGESTED_APPS = [
  { id: "instagram", name: "Instagram" },
  { id: "tiktok",    name: "TikTok"    },
  { id: "x",         name: "X (Twitter)" },
  { id: "youtube",   name: "YouTube"   },
  { id: "facebook",  name: "Facebook"  },
  { id: "snapchat",  name: "Snapchat"  },
  { id: "reddit",    name: "Reddit"    },
  { id: "discord",   name: "Discord"   },
  { id: "twitch",    name: "Twitch"    },
  { id: "netflix",   name: "Netflix"   },
];

async function currentUserId() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id || null;
  } catch { return null; }
}

export async function getBlockedApps() {
  // Source of truth: Supabase. AsyncStorage is a cache for offline boot.
  const uid = await currentUserId();
  if (uid) {
    try {
      const remote = await fetchBlockedApps(uid);
      if (remote) {
        await AsyncStorage.setItem(KEY, JSON.stringify(remote));
        return remote;
      }
    } catch {}
  }
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export async function setBlockedApps(apps) {
  // Local cache first so the change is instant offline / on next boot.
  await AsyncStorage.setItem(KEY, JSON.stringify(apps));
  const uid = await currentUserId();
  if (!uid) return;
  // One batched, parallel reconcile instead of a per-app sequential loop.
  await syncBlockedApps(uid, apps);
}

// ── Native bridge ─────────────────────────────────────────────
// iOS uses Apple's Screen Time API (Family Controls + ManagedSettings).
// Requires the custom dev client (will NOT work in Expo Go).
import {
  applyShield as nativeApplyShield,
  applyShieldCategories as nativeApplyShieldCategories,
  clearShield as nativeClearShield,
  isAvailable as nativeIsAvailable,
  requestAuthorization as nativeRequestAuth,
  getAuthorizationStatus as nativeAuthStatus,
  presentAppPicker as nativePresentPicker,
  getDiagnostics as nativeGetDiagnostics,
} from "./screenTime";

export const isNativeBlockingAvailable = nativeIsAvailable;
export const requestScreenTimeAuth     = nativeRequestAuth;
export const getScreenTimeAuthStatus   = nativeAuthStatus;
export const pickBlockedAppsNative     = nativePresentPicker;

/**
 * Ensure Screen Time access, then present Apple's picker directly.
 * Lets callers (the profile row) open the real picker without routing through
 * an in-app explainer screen first. Returns why it bailed so the caller can
 * decide whether to explain, upgrade, or stay silent.
 */
export async function openNativeAppPicker() {
  if (!nativeIsAvailable()) return { opened: false, reason: "unavailable" };
  let status = await nativeAuthStatus();
  if (status !== "approved") {
    status = await nativeRequestAuth();
    if (status !== "approved") return { opened: false, reason: "denied", status };
  }
  const ok = await nativePresentPicker();
  return ok ? { opened: true, status } : { opened: false, reason: "picker_failed", status };
}

/**
 * How many things the user has actually picked in Apple's picker.
 *
 * Apple hides the selection itself, but the native diagnostics dump reports
 * token counts, which is enough to answer "has anything been chosen yet?".
 * Returns 0 whenever we can't tell (no native module, pre-iOS 16, throw) —
 * callers treat that as "nothing selected", so a build without the bridge
 * never claims a selection exists.
 */
export async function getBlockedSelectionCount() {
  if (!nativeIsAvailable()) return 0;
  try {
    const d = await nativeGetDiagnostics();
    return (d?.pickedAppCount || 0) + (d?.pickedCategoryCount || 0) + (d?.pickedWebCount || 0);
  } catch { return 0; }
}

export async function applyBlocking(_appsList, { freeTier = false } = {}) {
  if (!nativeIsAvailable()) {
    return { applied: false, reason: "Screen Time API unavailable (Expo Go or non-iOS)" };
  }
  const status = await nativeAuthStatus();
  if (status !== "approved") {
    const next = await nativeRequestAuth();
    if (next !== "approved") return { applied: false, reason: "Authorization not granted" };
  }
  // App selection is no longer a Pro feature, so the user's own picks win for
  // everyone. `freeTier` now only decides the FALLBACK: if a free user somehow
  // has nothing selected, shield the broad categories rather than nothing at
  // all. Pro users with an empty selection get the same treatment as before —
  // applyShield on an empty selection, which is a no-op by design.
  const picked = await getBlockedSelectionCount();
  const ok = picked > 0
    ? await nativeApplyShield()
    : (freeTier ? await nativeApplyShieldCategories() : await nativeApplyShield());
  return ok ? { applied: true } : { applied: false, reason: "Failed to apply shield" };
}

export async function clearBlocking() {
  await nativeClearShield();
}
