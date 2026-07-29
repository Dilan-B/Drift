/**
 * analytics.js
 * Lightweight event tracking for Drift. Fire-and-forget inserts to the
 * analytics_events table in Supabase. Events are batched and flushed every
 * 10 seconds or when the app backgrounds.
 *
 * ── Key events ──────────────────────────────────────────────────────────
 *   onboarding_started
 *   onboarding_step_completed   { step }
 *   onboarding_completed
 *   signup_completed            { method: "google" | "email" | "family" }
 *   task_created
 *   task_completed
 *   task_verified
 *   screen_time_earned          { minutes }
 *   shield_activated
 *   shield_deactivated
 *   app_opened
 *   app_backgrounded
 *   referral_shared
 *   review_prompted
 *   review_completed
 * ────────────────────────────────────────────────────────────────────────
 */

import { AppState, Platform } from "react-native";
import Constants from "expo-constants";
import { supabase } from "./supabase";

// ── State ───────────────────────────────────────────────────────────────

let _userId = null;
let _queue = [];
let _timer = null;

const FLUSH_INTERVAL_MS = 10_000;

// ── Device info (computed once) ─────────────────────────────────────────

const _deviceInfo = {
  platform: Platform.OS,
  os_version: Platform.Version,
  app_version:
    Constants.expoConfig?.version ??
    Constants.manifest?.version ??
    "unknown",
};

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Store the authenticated user ID for subsequent track() calls.
 * Call this right after sign-in / session restore.
 */
export function identify(userId) {
  _userId = userId;
}

/**
 * Queue an analytics event. Silently no-ops if no user is identified yet.
 *
 * @param {string} eventName
 * @param {object} [properties={}]
 */
export function track(eventName, properties = {}) {
  if (!_userId) return;

  _queue.push({
    user_id: _userId,
    event_name: eventName,
    properties,
    device_info: _deviceInfo,
    created_at: new Date().toISOString(),
  });

  // Start the flush timer if it isn't already running.
  if (!_timer) {
    _timer = setTimeout(_flush, FLUSH_INTERVAL_MS);
  }
}

/**
 * Convenience wrapper for screen-view events.
 *
 * @param {string} screenName
 */
export function trackScreen(screenName) {
  track("screen_view", { screen: screenName });
}

// ── Flush logic ─────────────────────────────────────────────────────────

async function _flush() {
  _timer = null;
  if (_queue.length === 0) return;

  const batch = _queue.splice(0); // grab + clear
  try {
    await supabase.from("analytics_events").insert(batch);
  } catch (_) {
    // Fire-and-forget: swallow errors so analytics never crashes the app.
  }
}

// ── App-state listener (flush on background) ────────────────────────────

let _appStateSubscription = null;

export function startAnalytics() {
  if (_appStateSubscription) return; // already running
  _appStateSubscription = AppState.addEventListener("change", (state) => {
    if (state === "background" || state === "inactive") {
      _flush();
    }
  });
}

export function stopAnalytics() {
  if (_timer) {
    clearTimeout(_timer);
    _timer = null;
  }
  _flush();
  if (_appStateSubscription) {
    _appStateSubscription.remove();
    _appStateSubscription = null;
  }
}
