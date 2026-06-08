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
import { fetchBlockedApps, addBlockedApp, removeBlockedApp, cache } from "./sync";

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
  // Diff against last cached set so we know what to add vs soft-remove.
  await AsyncStorage.setItem(KEY, JSON.stringify(apps));
  const uid = await currentUserId();
  if (!uid) return;
  try {
    const remote = await fetchBlockedApps(uid);
    const remoteIds = new Set(remote.map(a => a.id));
    const localIds  = new Set(apps.map(a => a.id));
    // Add anything in local that's not in remote
    for (const a of apps) {
      if (!remoteIds.has(a.id)) await addBlockedApp(uid, a);
    }
    // Soft-remove anything in remote that's no longer in local
    for (const a of remote) {
      if (!localIds.has(a.id)) await removeBlockedApp(uid, a.id);
    }
  } catch (e) {
    console.warn("setBlockedApps sync:", e?.message);
  }
}

// ── Native bridge ─────────────────────────────────────────────
// iOS uses Apple's Screen Time API (Family Controls + ManagedSettings).
// Requires the custom dev client (will NOT work in Expo Go).
import {
  applyShield as nativeApplyShield,
  clearShield as nativeClearShield,
  isAvailable as nativeIsAvailable,
  requestAuthorization as nativeRequestAuth,
  getAuthorizationStatus as nativeAuthStatus,
  presentAppPicker as nativePresentPicker,
} from "./screenTime";

export const isNativeBlockingAvailable = nativeIsAvailable;
export const requestScreenTimeAuth     = nativeRequestAuth;
export const getScreenTimeAuthStatus   = nativeAuthStatus;
export const pickBlockedAppsNative     = nativePresentPicker;

export async function applyBlocking(_appsList) {
  if (!nativeIsAvailable()) {
    return { applied: false, reason: "Screen Time API unavailable (Expo Go or non-iOS)" };
  }
  const status = await nativeAuthStatus();
  if (status !== "approved") {
    const next = await nativeRequestAuth();
    if (next !== "approved") return { applied: false, reason: "Authorization not granted" };
  }
  const ok = await nativeApplyShield();
  return ok ? { applied: true } : { applied: false, reason: "Failed to apply shield" };
}

export async function clearBlocking() {
  await nativeClearShield();
}
