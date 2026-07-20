/**
 * haptics.js
 * Thin optional wrapper over expo-haptics.
 *
 * expo-haptics is NOT currently a dependency — adding it requires a native
 * rebuild of the dev client. This module is written so the app works either
 * way: if the package is present the taps are real, and if it isn't every call
 * is a silent no-op. Install with `npx expo install expo-haptics` and rebuild;
 * no call site needs to change.
 *
 * Every function swallows its own errors. Feedback is a nicety — it must never
 * be able to break the interaction it's decorating.
 */
import { Platform } from "react-native";

let Haptics = null;
try { Haptics = require("expo-haptics"); } catch {}

export const hapticsAvailable = () => !!Haptics;

/**
 * The light tick used when a value snaps to a new step while dragging.
 * Deliberately the lightest option — a slider crossing ten steps fires this
 * ten times, and anything heavier turns into a buzz.
 */
export function selectionTick() {
  if (!Haptics || Platform.OS === "web") return;
  try { Haptics.selectionAsync(); } catch {}
}

/** A single soft tap — for committing a choice, not for scrubbing. */
export function impactLight() {
  if (!Haptics || Platform.OS === "web") return;
  try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
}

/** Success / failure notification taps. */
export function notify(ok = true) {
  if (!Haptics || Platform.OS === "web") return;
  try {
    Haptics.notificationAsync(
      ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning
    );
  } catch {}
}
