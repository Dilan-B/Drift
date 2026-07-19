/**
 * places.js
 * Location-based task suggestions.
 *
 * The user saves their own places ("Gym", "Library", "Office") by standing at
 * them and tapping save — we store a coordinate + radius + a task template.
 * We then geofence those regions; arriving at one fires a local notification
 * ("At the gym — add 'Workout'?"). Tapping it opens a prefilled sheet in the
 * app where the task can be edited before confirming.
 *
 * Why saved places instead of a POI/Places API: no API key, no cost, no
 * per-request upload of the user's coordinates to a third party, and it's more
 * accurate — YOUR gym, not "a gym near here". Coordinates never leave the
 * device; there is no server component to this feature at all.
 *
 * Everything degrades safely: missing native module, denied permission, or
 * no saved places all end as quiet no-ops.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

let Location = null;
let TaskManager = null;
let Notifications = null;
try { Location = require("expo-location"); } catch {}
try { TaskManager = require("expo-task-manager"); } catch {}
try { Notifications = require("expo-notifications"); } catch {}

export const GEOFENCE_TASK = "drift-place-geofence";
const PLACES_KEY   = "drift_saved_places";
const ENABLED_KEY  = "drift_place_suggestions_enabled";
const COOLDOWN_MS  = 4 * 60 * 60 * 1000; // don't re-suggest the same place for 4h

// iOS caps an app at 20 monitored regions; stay well under it.
export const MAX_PLACES = 12;
export const DEFAULT_RADIUS_M = 150;

// Suggested defaults when creating a place — the user can change all of it.
export const PLACE_PRESETS = [
  { label: "Gym",     title: "Workout",            cat: "physical", minutes: 45 },
  { label: "Office",  title: "Focused work block", cat: "work",     minutes: 60 },
  { label: "Library", title: "Study session",      cat: "learning", minutes: 60 },
  { label: "Home",    title: "Tidy up",            cat: "life",     minutes: 15 },
  { label: "Park",    title: "Walk outside",       cat: "outdoor",  minutes: 30 },
];

// ── Storage ──────────────────────────────────────────────────
export async function getPlaces() {
  try {
    const raw = await AsyncStorage.getItem(PLACES_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

async function writePlaces(list) {
  try { await AsyncStorage.setItem(PLACES_KEY, JSON.stringify(list)); } catch {}
}

export async function isSuggestionsEnabled() {
  try { return (await AsyncStorage.getItem(ENABLED_KEY)) === "1"; } catch { return false; }
}

async function setSuggestionsEnabledFlag(on) {
  try {
    if (on) await AsyncStorage.setItem(ENABLED_KEY, "1");
    else await AsyncStorage.removeItem(ENABLED_KEY);
  } catch {}
}

// ── Permissions ──────────────────────────────────────────────
// Geofencing needs BACKGROUND ("Always") location. We ask for foreground
// first — asking for Always cold is a near-guaranteed decline on iOS.
export async function requestLocationPermission() {
  if (!Location) return { granted: false, reason: "unavailable" };
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== "granted") return { granted: false, reason: "denied" };
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status !== "granted") return { granted: false, reason: "foreground_only" };
    return { granted: true };
  } catch {
    return { granted: false, reason: "unavailable" };
  }
}

export async function getCurrentCoords() {
  if (!Location) return null;
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (fg.status !== "granted") {
      const req = await Location.requestForegroundPermissionsAsync();
      if (req.status !== "granted") return null;
    }
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  } catch { return null; }
}

// ── Place CRUD ───────────────────────────────────────────────
export async function addPlace({ label, title, cat, minutes, latitude, longitude, radius }) {
  const list = await getPlaces();
  if (list.length >= MAX_PLACES) return { ok: false, reason: "limit" };
  const place = {
    id: `place_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    label: String(label || "Place").slice(0, 40),
    title: String(title || label || "Task").slice(0, 80),
    cat: cat || "life",
    minutes: Math.max(5, Math.min(300, Number(minutes) || 30)),
    latitude, longitude,
    radius: Math.max(80, Math.min(1000, Number(radius) || DEFAULT_RADIUS_M)),
    enabled: true,
    lastSuggestedAt: 0,
  };
  const next = [...list, place];
  await writePlaces(next);
  await syncGeofences();
  return { ok: true, place };
}

export async function removePlace(id) {
  const next = (await getPlaces()).filter(p => p.id !== id);
  await writePlaces(next);
  await syncGeofences();
}

export async function updatePlace(id, patch) {
  const next = (await getPlaces()).map(p => p.id === id ? { ...p, ...patch } : p);
  await writePlaces(next);
  await syncGeofences();
}

// ── Geofencing ───────────────────────────────────────────────
// Registers every enabled place as a monitored region. Called whenever the
// place list or the master toggle changes, and once at boot.
export async function syncGeofences() {
  if (!Location || !TaskManager) return false;
  try {
    const enabled = await isSuggestionsEnabled();
    const places = (await getPlaces()).filter(p => p.enabled !== false);

    const running = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false);
    if (!enabled || places.length === 0) {
      if (running) await Location.stopGeofencingAsync(GEOFENCE_TASK).catch(() => {});
      return false;
    }

    const bg = await Location.getBackgroundPermissionsAsync().catch(() => null);
    if (bg?.status !== "granted") return false;

    const regions = places.slice(0, MAX_PLACES).map(p => ({
      identifier: p.id,
      latitude: p.latitude,
      longitude: p.longitude,
      radius: p.radius || DEFAULT_RADIUS_M,
      notifyOnEnter: true,
      notifyOnExit: false,
    }));

    // startGeofencingAsync replaces the existing region set for this task.
    await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
    return true;
  } catch {
    return false;
  }
}

export async function setSuggestionsEnabled(on) {
  await setSuggestionsEnabledFlag(on);
  if (on) {
    const perm = await requestLocationPermission();
    if (!perm.granted) {
      await setSuggestionsEnabledFlag(false);
      return perm;
    }
  }
  await syncGeofences();
  return { granted: !!on };
}

// ── Arrival → notification ───────────────────────────────────
// Called from the background task when a region is entered. Cooldown-guarded
// so pacing in and out of the geofence can't spam the user (same discipline
// as the "time's up" latch).
export async function handleRegionEnter(regionId) {
  if (!Notifications) return;
  const places = await getPlaces();
  const place = places.find(p => p.id === regionId);
  if (!place || place.enabled === false) return;

  const now = Date.now();
  if (now - (place.lastSuggestedAt || 0) < COOLDOWN_MS) return;

  await writePlaces(places.map(p => p.id === regionId ? { ...p, lastSuggestedAt: now } : p));

  try {
    await Notifications.scheduleNotificationAsync({
      identifier: `drift-place-${place.id}`,
      content: {
        title: `You're at ${place.label}`,
        body: `Add "${place.title}" (${place.minutes}m)? Tap to confirm.`,
        data: {
          type: "place_suggestion",
          placeId: place.id,
          title: place.title,
          cat: place.cat,
          minutes: place.minutes,
          label: place.label,
        },
      },
      trigger: null,
    });
  } catch {}
}

// ── Background task registration ─────────────────────────────
// MUST be defined at module scope so it exists on a cold start (iOS may wake
// the app directly into this task with no UI). Import this module from the app
// entry so registration always happens.
if (TaskManager) {
  try {
    if (!TaskManager.isTaskDefined(GEOFENCE_TASK)) {
      TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
        if (error) return;
        try {
          const eventType = data?.eventType;
          const region = data?.region;
          const ENTER = Location?.GeofencingEventType?.Enter ?? 1;
          if (eventType === ENTER && region?.identifier) {
            await handleRegionEnter(region.identifier);
          }
        } catch {}
      });
    }
  } catch {}
}
