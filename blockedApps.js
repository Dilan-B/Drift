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

export async function getBlockedApps() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export async function setBlockedApps(apps) {
  await AsyncStorage.setItem(KEY, JSON.stringify(apps));
}

// ── Native bridge (no-op in Expo Go) ─────────────────────────
// Replace these once you wire in a real native blocker.
let nativeBlocker = null;
try {
  // Example: nativeBlocker = require("react-native-screen-time-api");
} catch { nativeBlocker = null; }

export async function applyBlocking(appsList) {
  if (!nativeBlocker?.apply) return { applied: false, reason: "Native blocker not available in Expo Go" };
  try { await nativeBlocker.apply(appsList); return { applied: true }; }
  catch (e) { return { applied: false, reason: e?.message }; }
}

export async function clearBlocking() {
  if (!nativeBlocker?.clear) return;
  try { await nativeBlocker.clear(); } catch {}
}
