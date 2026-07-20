/**
 * calendarSync.js
 * OPTIONAL calendar → task import.
 *
 * Off by default. When enabled, Drift reads today's events from the calendars
 * the user picked and offers them as tasks. Read-only: we never create, edit,
 * or delete calendar events, and nothing is uploaded — events are converted to
 * local tasks on-device.
 *
 * Dedupe: every imported task remembers its calendar event id, so re-syncing
 * (or syncing twice in a day) never produces duplicates.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

let Calendar = null;
try { Calendar = require("expo-calendar"); } catch {}

const ENABLED_KEY   = "drift_calendar_sync_enabled";
const CALENDARS_KEY = "drift_calendar_ids";
const IMPORTED_KEY  = "drift_calendar_imported";  // { [eventId]: dateKey }

// Events we should never turn into tasks: all-day blocks, declined invites,
// and anything absurdly long (a multi-day "vacation" is not a task).
const MAX_EVENT_MINUTES = 300;
const MIN_EVENT_MINUTES = 10;

export function calendarAvailable() {
  return !!Calendar;
}

// ── Settings ─────────────────────────────────────────────────
export async function isCalendarSyncEnabled() {
  try { return (await AsyncStorage.getItem(ENABLED_KEY)) === "1"; } catch { return false; }
}

export async function setCalendarSyncEnabled(on) {
  try {
    if (on) await AsyncStorage.setItem(ENABLED_KEY, "1");
    else await AsyncStorage.removeItem(ENABLED_KEY);
  } catch {}
}

export async function getSelectedCalendarIds() {
  try {
    const raw = await AsyncStorage.getItem(CALENDARS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

export async function setSelectedCalendarIds(ids) {
  try { await AsyncStorage.setItem(CALENDARS_KEY, JSON.stringify(ids || [])); } catch {}
}

// ── Permission + calendar list ───────────────────────────────
export async function requestCalendarPermission() {
  if (!Calendar) return false;
  try {
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    return status === "granted";
  } catch { return false; }
}

/**
 * Is this calendar backed by a Google account?
 *
 * We read the device calendar store, which already includes Google calendars
 * whenever the user has added their Google account to the phone (iOS Settings
 * → Calendar → Accounts). So "Google Calendar" needs no OAuth — it just needs
 * to be identified, which is what this does: Google shows up as a CalDAV
 * source whose name/owner is the gmail address or literally "Google".
 */
function looksGoogle(c) {
  const hay = [
    c?.source?.name,
    c?.source?.type,
    c?.ownerAccount,
    c?.title,
  ].filter(Boolean).join(" ").toLowerCase();
  return /google|gmail|googlemail/.test(hay);
}

export async function listCalendars() {
  if (!Calendar) return [];
  try {
    const { status } = await Calendar.getCalendarPermissionsAsync();
    if (status !== "granted") {
      const ok = await requestCalendarPermission();
      if (!ok) return [];
    }
    const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    return (cals || [])
      .filter(c => c?.id)
      .map(c => ({
        id: c.id,
        title: c.title || "Calendar",
        color: c.color || null,
        source: c.source?.name || "",
        isGoogle: looksGoogle(c),
        // Birthday/holiday feeds are noise as tasks — flagged so the UI can
        // avoid auto-selecting them.
        isSubscribed: c?.allowsModifications === false,
      }))
      // Google first, then everything else, alphabetical within each group.
      .sort((a, b) => (b.isGoogle - a.isGoogle) || a.title.localeCompare(b.title));
  } catch { return []; }
}

/**
 * Default calendar selection, applied the first time sync is switched on:
 * prefer Google calendars, fall back to the writable device calendars.
 * Returns the ids it chose (already persisted).
 */
export async function applyDefaultCalendarSelection() {
  const existing = await getSelectedCalendarIds();
  if (existing.length > 0) return existing;

  const cals = await listCalendars();
  if (cals.length === 0) return [];

  const google = cals.filter(c => c.isGoogle && !c.isSubscribed);
  const chosen = google.length > 0
    ? google
    : cals.filter(c => !c.isSubscribed);

  const ids = chosen.map(c => c.id);
  await setSelectedCalendarIds(ids);
  return ids;
}

// ── Category guessing ────────────────────────────────────────
// Same spirit as the Add Task title heuristics — a sensible default the user
// can override in the confirm sheet.
function guessCategory(text) {
  const lo = (text || "").toLowerCase();
  if (/gym|workout|run|training|yoga|swim|lift|climb/.test(lo))          return "physical";
  if (/walk|hike|outside|park|garden/.test(lo))                          return "outdoor";
  if (/class|study|lecture|revision|homework|exam|read/.test(lo))        return "learning";
  if (/dinner|lunch|coffee|party|birthday|drinks|catch ?up|date/.test(lo)) return "social";
  if (/meeting|standup|stand-up|sync|1:1|call|review|interview|work/.test(lo)) return "work";
  return "life";
}

function minutesBetween(start, end) {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (!isFinite(s) || !isFinite(e) || e <= s) return null;
  return Math.round((e - s) / 60000);
}

function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Import tracking (dedupe) ─────────────────────────────────
async function getImported() {
  try {
    const raw = await AsyncStorage.getItem(IMPORTED_KEY);
    const map = raw ? JSON.parse(raw) : {};
    return map && typeof map === "object" ? map : {};
  } catch { return {}; }
}

export async function markImported(eventIds) {
  const map = await getImported();
  const today = dateKey();
  for (const id of eventIds || []) map[id] = today;
  // Keep the map from growing forever: drop anything older than ~30 days.
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const cutoffKey = dateKey(cutoff);
  for (const [id, day] of Object.entries(map)) {
    if (typeof day === "string" && day < cutoffKey) delete map[id];
  }
  try { await AsyncStorage.setItem(IMPORTED_KEY, JSON.stringify(map)); } catch {}
}

// ── The actual fetch ─────────────────────────────────────────
/**
 * Today's importable events, already filtered and shaped like task drafts.
 * Returns [] for every failure mode (no module, no permission, nothing on).
 */
export async function fetchTodayEvents() {
  if (!Calendar) return [];
  try {
    const { status } = await Calendar.getCalendarPermissionsAsync();
    if (status !== "granted") return [];

    const ids = await getSelectedCalendarIds();
    if (ids.length === 0) return [];

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    const events = await Calendar.getEventsAsync(ids, start, end);
    const imported = await getImported();

    return (events || [])
      .filter(ev => {
        if (!ev?.id || ev.allDay) return false;
        if (imported[ev.id]) return false;                 // already imported
        if (ev.status === "CANCELED" || ev.status === "canceled") return false;
        const mins = minutesBetween(ev.startDate, ev.endDate);
        return mins !== null && mins >= MIN_EVENT_MINUTES && mins <= MAX_EVENT_MINUTES;
      })
      .map(ev => {
        const mins = minutesBetween(ev.startDate, ev.endDate) || 30;
        const title = (ev.title || "Event").slice(0, 80);
        return {
          eventId: ev.id,
          title,
          cat: guessCategory(`${title} ${ev.location || ""}`),
          minutes: mins,
          startDate: ev.startDate,
        };
      })
      .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
  } catch {
    return [];
  }
}
