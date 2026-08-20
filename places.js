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

// Imported for its side effects as much as its exports: notifications.js
// installs the foreground notification handler at module scope. Without it a
// geofence that fires while the app is open schedules a notification the OS
// then declines to display, which looks exactly like the geofence not firing.
// Required lazily so a missing module can't take the geofence task down with
// it — this file must stay importable on a cold background wake.
let notif = null;
try { notif = require("./notifications"); } catch {}

export const GEOFENCE_TASK = "drift-place-geofence";
const PLACES_KEY   = "drift_saved_places";
const ENABLED_KEY  = "drift_place_suggestions_enabled";
// Fingerprint of the region set currently handed to the OS, so a no-op sync
// doesn't restart monitoring (see syncGeofences).
const REGIONS_SIG_KEY = "drift_place_regions_sig";
const COOLDOWN_MS  = 4 * 60 * 60 * 1000; // don't re-suggest the same place for 4h

// iOS caps an app at 20 monitored regions; stay well under it.
export const MAX_PLACES = 12;
export const DEFAULT_RADIUS_M = 150;

/**
 * Place bank — typeahead suggestions when naming a saved place.
 *
 * Each entry carries the task template we prefill on arrival. `alt` holds extra
 * search terms so people find an entry by whatever they call it ("uni" → Campus,
 * "grocery" → Supermarket). Everything is editable after saving; this is a
 * starting point, not a constraint — a name that matches nothing still saves
 * fine and falls back to DEFAULT_PLACE's template.
 */
export const DEFAULT_PLACE = { title: "Focus block", cat: "life", minutes: 30 };

export const PLACE_SUGGESTIONS = [
  // ── Fitness & sport ──
  { label: "Gym",              title: "Workout",              cat: "physical", minutes: 45, alt: "fitness weights lifting" },
  { label: "Home gym",         title: "Workout",              cat: "physical", minutes: 30 },
  { label: "Climbing gym",     title: "Climbing session",     cat: "physical", minutes: 60, alt: "bouldering" },
  { label: "Yoga studio",      title: "Yoga class",           cat: "physical", minutes: 60 },
  { label: "Pilates studio",   title: "Pilates class",        cat: "physical", minutes: 50 },
  { label: "CrossFit box",     title: "WOD",                  cat: "physical", minutes: 60 },
  { label: "Boxing gym",       title: "Boxing training",      cat: "physical", minutes: 60, alt: "martial arts mma" },
  { label: "Dojo",             title: "Martial arts class",   cat: "physical", minutes: 60, alt: "karate judo taekwondo" },
  { label: "Dance studio",     title: "Dance practice",       cat: "physical", minutes: 60 },
  { label: "Pool",             title: "Swim",                 cat: "physical", minutes: 45, alt: "swimming aquatic natatorium" },
  { label: "Track",            title: "Track workout",        cat: "physical", minutes: 45, alt: "running athletics" },
  { label: "Tennis court",     title: "Tennis",               cat: "physical", minutes: 60 },
  { label: "Basketball court", title: "Basketball",           cat: "physical", minutes: 60, alt: "hoops" },
  { label: "Soccer field",     title: "Soccer",               cat: "physical", minutes: 90, alt: "football pitch" },
  { label: "Golf course",      title: "Play a round",         cat: "physical", minutes: 120, alt: "driving range" },
  { label: "Ice rink",         title: "Skate",                cat: "physical", minutes: 60, alt: "hockey skating" },
  { label: "Ski slope",        title: "Ski run",              cat: "physical", minutes: 120, alt: "snowboard mountain resort" },
  { label: "Skate park",       title: "Skate session",        cat: "physical", minutes: 45 },
  { label: "Bouldering wall",  title: "Bouldering",           cat: "physical", minutes: 60 },
  { label: "Physio clinic",    title: "Rehab exercises",      cat: "physical", minutes: 30, alt: "physical therapy" },

  // ── Work ──
  { label: "Office",           title: "Focused work block",   cat: "work",     minutes: 60, alt: "workplace job" },
  { label: "Home office",      title: "Focused work block",   cat: "work",     minutes: 60, alt: "desk wfh" },
  { label: "Coworking space",  title: "Deep work",            cat: "work",     minutes: 90, alt: "wework shared" },
  { label: "Client site",      title: "Client visit",         cat: "work",     minutes: 60 },
  { label: "Warehouse",        title: "Shift tasks",          cat: "work",     minutes: 60, alt: "depot storage" },
  { label: "Workshop",         title: "Build session",        cat: "work",     minutes: 60, alt: "garage makerspace" },
  { label: "Studio",           title: "Studio session",       cat: "work",     minutes: 90, alt: "recording art" },
  { label: "Lab",              title: "Lab work",             cat: "work",     minutes: 90, alt: "laboratory research" },
  { label: "Job site",         title: "Site work",            cat: "work",     minutes: 90, alt: "construction" },
  { label: "Conference center",title: "Session notes",        cat: "work",     minutes: 45, alt: "convention expo" },

  // ── Learning ──
  { label: "Library",          title: "Study session",        cat: "learning", minutes: 60 },
  { label: "Campus",           title: "Study session",        cat: "learning", minutes: 60, alt: "university college uni school" },
  { label: "Lecture hall",     title: "Lecture",              cat: "learning", minutes: 60, alt: "classroom" },
  { label: "Study room",       title: "Study session",        cat: "learning", minutes: 90 },
  { label: "Bookstore",        title: "Read a chapter",       cat: "learning", minutes: 30 },
  { label: "Music school",     title: "Practice",             cat: "learning", minutes: 45, alt: "lesson conservatory" },
  { label: "Language school",  title: "Language practice",    cat: "learning", minutes: 45 },
  { label: "Tutoring center",  title: "Tutoring session",     cat: "learning", minutes: 60 },
  { label: "Museum",           title: "Explore an exhibit",   cat: "learning", minutes: 60, alt: "gallery exhibition" },
  { label: "Science center",   title: "Explore",              cat: "learning", minutes: 60, alt: "planetarium aquarium" },

  // ── Outdoors ──
  { label: "Park",             title: "Walk outside",         cat: "outdoor",  minutes: 30 },
  { label: "Trailhead",        title: "Hike",                 cat: "outdoor",  minutes: 90, alt: "hiking trail" },
  { label: "Beach",            title: "Beach walk",           cat: "outdoor",  minutes: 45, alt: "shore coast" },
  { label: "Lake",             title: "Walk by the water",    cat: "outdoor",  minutes: 45, alt: "reservoir pond" },
  { label: "River",            title: "Riverside walk",       cat: "outdoor",  minutes: 45, alt: "canal" },
  { label: "Mountain",         title: "Hike",                 cat: "outdoor",  minutes: 120, alt: "summit peak" },
  { label: "Forest",           title: "Walk in the woods",    cat: "outdoor",  minutes: 60, alt: "woods nature" },
  { label: "Botanical garden", title: "Garden walk",          cat: "outdoor",  minutes: 45 },
  { label: "Community garden", title: "Garden work",          cat: "outdoor",  minutes: 45, alt: "allotment" },
  { label: "Campground",       title: "Camp chores",          cat: "outdoor",  minutes: 45, alt: "camping campsite" },
  { label: "Bike trail",       title: "Ride",                 cat: "outdoor",  minutes: 60, alt: "cycling bicycle" },
  { label: "Dog park",         title: "Walk the dog",         cat: "outdoor",  minutes: 30 },
  { label: "Marina",           title: "Time on the water",    cat: "outdoor",  minutes: 90, alt: "harbor boat dock" },
  { label: "Farm",             title: "Farm chores",          cat: "outdoor",  minutes: 60, alt: "ranch barn stable" },

  // ── Social ──
  { label: "Cafe",             title: "Catch up",             cat: "social",   minutes: 45, alt: "coffee shop starbucks espresso" },
  { label: "Restaurant",       title: "Meal out",             cat: "social",   minutes: 60, alt: "dinner lunch diner" },
  { label: "Bar",              title: "Drinks",               cat: "social",   minutes: 90, alt: "pub tavern brewery" },
  { label: "Friend's place",   title: "Hang out",             cat: "social",   minutes: 90, alt: "friends house" },
  { label: "Family home",      title: "Family time",          cat: "social",   minutes: 90, alt: "parents mom dad grandma relatives" },
  { label: "Community center", title: "Community event",      cat: "social",   minutes: 60 },
  { label: "Church",           title: "Service",              cat: "social",   minutes: 60, alt: "mosque temple synagogue worship" },
  { label: "Club",             title: "Club meetup",          cat: "social",   minutes: 90, alt: "society meeting" },
  { label: "Stadium",          title: "Watch the game",       cat: "social",   minutes: 120, alt: "arena match" },
  { label: "Theater",          title: "See a show",           cat: "social",   minutes: 120, alt: "cinema movies playhouse" },
  { label: "Concert venue",    title: "See live music",       cat: "social",   minutes: 120, alt: "music hall gig" },
  { label: "Bowling alley",    title: "Bowling",              cat: "social",   minutes: 90 },
  { label: "Game store",       title: "Game night",           cat: "social",   minutes: 90, alt: "board games arcade" },
  { label: "Volunteer site",   title: "Volunteer shift",      cat: "social",   minutes: 90, alt: "charity shelter food bank" },

  // ── Errands & life ──
  { label: "Home",             title: "Tidy up",              cat: "life",     minutes: 15, alt: "apartment flat house" },
  { label: "Supermarket",      title: "Groceries",            cat: "life",     minutes: 30, alt: "grocery store food shopping" },
  { label: "Pharmacy",         title: "Pick up prescription", cat: "life",     minutes: 15, alt: "chemist drugstore" },
  { label: "Bank",             title: "Bank errand",          cat: "life",     minutes: 20, alt: "credit union atm" },
  { label: "Post office",      title: "Post office errand",   cat: "life",     minutes: 15, alt: "mail parcel shipping" },
  { label: "Laundromat",       title: "Laundry",              cat: "life",     minutes: 45, alt: "laundry washing" },
  { label: "Dry cleaner",      title: "Dry cleaning drop-off",cat: "life",     minutes: 10 },
  { label: "Hardware store",   title: "Pick up supplies",     cat: "life",     minutes: 30, alt: "diy home depot" },
  { label: "Mall",             title: "Shopping trip",        cat: "life",     minutes: 60, alt: "shopping center outlet" },
  { label: "Barber",           title: "Haircut",              cat: "life",     minutes: 30, alt: "salon hairdresser" },
  { label: "Doctor's office",  title: "Appointment",          cat: "life",     minutes: 30, alt: "clinic gp physician" },
  { label: "Dentist",          title: "Dental appointment",   cat: "life",     minutes: 30, alt: "orthodontist" },
  { label: "Vet",              title: "Vet visit",            cat: "life",     minutes: 30, alt: "veterinarian animal" },
  { label: "Car repair shop",  title: "Car errand",           cat: "life",     minutes: 30, alt: "mechanic garage auto" },
  { label: "Gas station",      title: "Fill up",              cat: "life",     minutes: 10, alt: "petrol fuel charging" },
  { label: "Car wash",         title: "Wash the car",         cat: "life",     minutes: 20 },
  { label: "Storage unit",     title: "Storage sort-out",     cat: "life",     minutes: 45 },
  { label: "Recycling center", title: "Drop off recycling",   cat: "life",     minutes: 20, alt: "dump tip waste" },
  { label: "Daycare",          title: "Pickup",               cat: "life",     minutes: 15, alt: "nursery preschool kids" },
  { label: "School pickup",    title: "School run",           cat: "life",     minutes: 20, alt: "kids children" },
  { label: "Airport",          title: "Travel admin",         cat: "life",     minutes: 30, alt: "flight terminal" },
  { label: "Train station",    title: "Commute reading",      cat: "life",     minutes: 30, alt: "rail subway metro platform" },
  { label: "Bus stop",         title: "Commute reading",      cat: "life",     minutes: 20, alt: "transit" },
  { label: "Hotel",            title: "Unwind",               cat: "life",     minutes: 30, alt: "airbnb motel lodging" },
  { label: "Spa",              title: "Recovery time",        cat: "life",     minutes: 60, alt: "sauna massage wellness" },
  { label: "Nail salon",       title: "Appointment",          cat: "life",     minutes: 45 },
  { label: "Therapist",        title: "Therapy session",      cat: "life",     minutes: 50, alt: "counselor counselling psychologist" },
  { label: "Meditation center",title: "Meditate",             cat: "life",     minutes: 20, alt: "mindfulness zen" },
];

// Kept for callers that just want a sensible starting template.
export const PLACE_PRESETS = PLACE_SUGGESTIONS.slice(0, 5);

/**
 * Typeahead match over the bank, best first:
 *   0 label prefix        "gy" → Gym
 *   1 label word start    "gym" → Boxing gym
 *   2 alias word start    "uni" → Campus
 *   3 substring anywhere  "uni" → Storage unit
 * Substring ranks last on purpose: a word buried mid-label ("commUNIty") is a
 * far weaker signal than an alias the user actually calls the place.
 */
export function matchPlaces(query, limit = 8) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return PLACE_SUGGESTIONS.slice(0, limit);

  const scored = [];
  for (const p of PLACE_SUGGESTIONS) {
    const label = p.label.toLowerCase();
    let score = null;
    if (label.startsWith(q)) score = 0;
    else if (label.split(/[\s'-]+/).some(w => w.startsWith(q))) score = 1;
    else if ((p.alt || "").split(/\s+/).some(w => w.startsWith(q))) score = 2;
    else if (label.includes(q)) score = 3;
    if (score !== null) scored.push({ p, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.p.label.localeCompare(b.p.label))
    .slice(0, limit)
    .map(x => x.p);
}

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
    // iOS treats regions under ~100m as unreliable and can ignore them
    // outright, so a place saved at 80m looked fine in the UI and never fired.
    radius: Math.max(100, Math.min(1000, Number(radius) || DEFAULT_RADIUS_M)),
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

    // startGeofencingAsync replaces the region set wholesale, and doing that
    // resets the OS's inside/outside state for every region — which can drop
    // the very next crossing. Skip the restart when the set hasn't changed.
    const signature = regions
      .map(r => `${r.identifier}:${r.latitude.toFixed(5)},${r.longitude.toFixed(5)},${r.radius}`)
      .sort()
      .join("|");
    const prev = await AsyncStorage.getItem(REGIONS_SIG_KEY).catch(() => null);
    if (running && prev === signature) return true;

    await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
    await AsyncStorage.setItem(REGIONS_SIG_KEY, signature).catch(() => {});
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

    // A place arrival's only output is a notification, so notification
    // permission is part of the feature, not an unrelated setting. Asking here
    // — right after the user opted in — is the one moment the request has
    // obvious context. Not fatal if declined: geofencing still runs and the
    // diagnostics will name this as the blocker rather than failing silently.
    let notifOk = true;
    if (notif?.requestNotificationPermission) {
      notifOk = await notif.requestNotificationPermission().catch(() => false);
    }
    await syncGeofences();
    return { granted: true, notifications: notifOk };
  }
  await syncGeofences();
  return { granted: false };
}

// ── Arrival → notification ────────────────────────────
// Called from the background task when a region is entered, from the
// already-inside sweep below, and from testArrival(). Cooldown-guarded so
// pacing in and out of the geofence can't spam the user (same discipline as
// the "time's up" latch).
//
// `force` skips the cooldown. Only the test button passes it — a user checking
// whether the feature works must not be told nothing happened because they
// genuinely arrived three hours ago.
//
// Returns a reason on every failure path. This used to return void, so an
// arrival that produced no notification gave the app nothing to report and the
// user nothing to fix.
export async function handleRegionEnter(regionId, { force = false, source = "geofence" } = {}) {
  if (!Notifications) return { ok: false, reason: "no_notifications_module" };
  const places = await getPlaces();
  const place = places.find(p => p.id === regionId);
  if (!place) return { ok: false, reason: "unknown_place" };
  if (place.enabled === false) return { ok: false, reason: "place_disabled" };

  const now = Date.now();
  const since = now - (place.lastSuggestedAt || 0);
  if (!force && since < COOLDOWN_MS) {
    return { ok: false, reason: "cooldown", retryInMs: COOLDOWN_MS - since };
  }

  // Permission is checked HERE, not only at enable time. Notifications can be
  // revoked in Settings long after place suggestions were switched on, and the
  // old code scheduled into the void and then marked the place as suggested —
  // burning a four-hour cooldown on a notification nobody ever saw.
  let allowed = false;
  if (notif?.requestNotificationPermission) {
    allowed = await notif.requestNotificationPermission().catch(() => false);
  } else {
    try { allowed = (await Notifications.getPermissionsAsync())?.status === "granted"; } catch {}
  }
  if (!allowed) return { ok: false, reason: "notifications_denied" };

  try {
    await Notifications.scheduleNotificationAsync({
      // Unique per firing. A fixed identifier meant a second arrival REPLACED
      // the first notification rather than adding one, so a suggestion the user
      // hadn't tapped yet silently disappeared.
      identifier: `drift-place-${place.id}-${now}`,
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
          source,
        },
      },
      trigger: null,
    });
  } catch {
    return { ok: false, reason: "schedule_failed" };
  }

  // Only now is the cooldown spent.
  await writePlaces(places.map(p => p.id === regionId ? { ...p, lastSuggestedAt: now } : p));
  return { ok: true, place };
}

// ── The already-inside problem ────────────────────────
// iOS fires an Enter event only when you CROSS a region boundary. If monitoring
// begins while you are already inside — exactly what happens when someone saves
// "Gym" while standing at the gym, or opens the app after arriving — no event
// ever fires, and the feature looks broken on the one occasion the user is
// watching for it.
//
// This closes that gap: on foreground, take a single position fix and treat
// "inside a saved radius" as an arrival, subject to the same cooldown. It needs
// only foreground permission, so it also works for people who granted While
// Using but declined Always.
const EARTH_R = 6371000;

export function distanceMeters(a, b) {
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude), lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export async function checkArrivalNow() {
  if (!(await isSuggestionsEnabled())) return { ok: false, reason: "disabled" };
  const places = (await getPlaces()).filter(p => p.enabled !== false);
  if (!places.length) return { ok: false, reason: "no_places" };

  const here = await getCurrentCoords();
  if (!here) return { ok: false, reason: "no_fix" };

  // Nearest first, so standing where two saved places overlap suggests the one
  // you are actually at.
  const inside = places
    .map(p => ({ p, d: distanceMeters(here, p) }))
    .filter(x => x.d <= (x.p.radius || DEFAULT_RADIUS_M))
    .sort((a, b) => a.d - b.d);

  if (!inside.length) return { ok: false, reason: "not_at_a_place" };
  return await handleRegionEnter(inside[0].p.id, { source: "foreground" });
}

// ── Diagnostics ────────────────────────────────
// Every failure path in syncGeofences() returned a bare `false`, so "arriving
// at the gym does nothing" had six indistinguishable causes and no way to tell
// them apart from inside the app. This names the one that applies.
export async function getGeofenceStatus() {
  const status = {
    moduleOk: !!(Location && TaskManager),
    taskDefined: false,
    enabled: false,
    placeCount: 0,
    foreground: "unknown",
    background: "unknown",
    notifications: "unknown",
    monitoring: false,
    servicesEnabled: null,
    ready: false,
    blocker: null,
  };

  if (!status.moduleOk) {
    status.blocker = "expo-location or expo-task-manager is missing from this build.";
    return status;
  }

  try { status.taskDefined = !!TaskManager.isTaskDefined(GEOFENCE_TASK); } catch {}
  status.enabled = await isSuggestionsEnabled();
  status.placeCount = (await getPlaces()).filter(p => p.enabled !== false).length;

  try { status.servicesEnabled = await Location.hasServicesEnabledAsync(); } catch {}
  try { status.foreground = (await Location.getForegroundPermissionsAsync())?.status || "unknown"; } catch {}
  try { status.background = (await Location.getBackgroundPermissionsAsync())?.status || "unknown"; } catch {}
  try { status.monitoring = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK); } catch {}
  if (Notifications) {
    try { status.notifications = (await Notifications.getPermissionsAsync())?.status || "unknown"; } catch {}
  } else {
    status.notifications = "unavailable";
  }

  // First blocker wins, listed in the order the user has to fix them.
  status.blocker =
    !status.enabled                      ? "Place suggestions are switched off."
    : status.placeCount === 0            ? "No places saved yet — save one while you're standing at it."
    : status.servicesEnabled === false   ? "Location Services is off for the whole device (Settings › Privacy › Location Services)."
    : status.foreground !== "granted"    ? "Drift has no location permission (Settings › Drift › Location)."
    : status.background !== "granted"    ? "Location is set to While Using. Arrivals need Always (Settings › Drift › Location › Always)."
    : status.notifications !== "granted" ? "Notifications are off, so an arrival has no way to reach you (Settings › Drift › Notifications)."
    : !status.taskDefined                ? "The background task didn't register. Fully quit and reopen Drift."
    : !status.monitoring                 ? "Regions aren't being monitored yet — tap Re-arm."
    : null;

  status.ready = !status.blocker;
  return status;
}

/**
 * Fire the arrival flow for one saved place on demand.
 *
 * A test is only worth anything if it exercises the REAL path — same cooldown
 * bookkeeping, same notification payload, same tap handler — so the only thing
 * this skips is having to physically be there. When the pipeline isn't wired
 * up it reports the blocker, which is the part that was previously invisible.
 */
export async function testArrival(placeId) {
  const status = await getGeofenceStatus();

  // Don't fail a notification test on the two blockers that affect only
  // BACKGROUND firing — the user can still confirm the notification and its tap
  // handler work, and the status object carries the caveat.
  const fatal = !!status.blocker &&
    !status.blocker.startsWith("Location is set to While Using") &&
    !status.blocker.startsWith("Regions aren't");
  if (fatal) return { ok: false, reason: "blocked", blocker: status.blocker, status };

  let id = placeId;
  if (!id) {
    const places = (await getPlaces()).filter(p => p.enabled !== false);
    if (!places.length) return { ok: false, reason: "blocked", blocker: "No places saved yet.", status };
    id = places[0].id;
  }

  const res = await handleRegionEnter(id, { force: true, source: "test" });
  return res.ok
    ? { ok: true, place: res.place, status }
    : { ok: false, reason: res.reason, status };
}

// ── Background task registration ─────────────────────────────
// MUST be defined at module scope so it exists on a cold start (iOS may wake
// the app directly into this task with no UI). Import this module from the app
// entry so registration always happens.
if (TaskManager) {
  try {
    if (!TaskManager.isTaskDefined(GEOFENCE_TASK)) {
      TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
        if (error) {
          // Surfaced in the device log only. A geofence error here is usually
          // the OS revoking Always permission mid-flight, which the in-app
          // diagnostics report properly on next open.
          console.warn("[places] geofence task error:", error?.message || error);
          return;
        }
        try {
          const eventType = data?.eventType;
          const region = data?.region;
          const ENTER = Location?.GeofencingEventType?.Enter ?? 1;
          if (eventType === ENTER && region?.identifier) {
            const res = await handleRegionEnter(region.identifier);
            if (!res?.ok) console.warn("[places] arrival not delivered:", res?.reason);
          }
        } catch (e) {
          console.warn("[places] arrival threw:", e?.message);
        }
      });
    }
  } catch {}
}
