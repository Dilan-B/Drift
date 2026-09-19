/**
 * reviewPrompt.js
 * Decides whether now is a moment we may ask for an App Store review.
 *
 * Apple shows its in-app review sheet at most three times per user per 365
 * days, and decides by itself whether any given request actually displays. We
 * used to ask exactly once, ever — after the third completed task — which spent
 * one of those three and threw the other two away, without even knowing whether
 * the one we spent had been shown.
 *
 * Now: up to three asks in any rolling year, at least 90 days apart, each at a
 * moment the user has just succeeded at something. Spacing them ourselves
 * matters because Apple's throttle is silent — ask twice in a week and the
 * second is simply swallowed, which is a wasted ask, not a second chance.
 *
 * Every caller must go through claimReviewPrompt(). It records the ask when it
 * says yes, so two triggers landing in the same moment (a task finishing as a
 * session completes) cannot both show the screen.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const LOG_KEY    = "drift_review_prompts";       // JSON array of epoch ms
const LEGACY_KEY = "drift_review_prompt_shown";  // the old once-ever flag, "1"

const DAY_MS       = 24 * 60 * 60 * 1000;
const YEAR_MS      = 365 * DAY_MS;
const MAX_PER_YEAR = 3;            // Apple's own ceiling; asking more is waste
const MIN_GAP_MS   = 90 * DAY_MS;

let inFlight = null;

/**
 * Resolves true if the caller should show the review prompt now — and if so,
 * has already recorded it. Resolves false on any storage failure: when we
 * cannot tell how recently we asked, not asking is the right default.
 */
export function claimReviewPrompt(now = Date.now()) {
  // A second trigger arriving while the first is still reading storage loses.
  if (inFlight) return inFlight.then(() => false);

  inFlight = (async () => {
    try {
      let log;
      try { log = JSON.parse((await AsyncStorage.getItem(LOG_KEY)) || "[]"); } catch { log = null; }
      if (!Array.isArray(log)) {
        // Unreadable history means we cannot tell how recently we asked. Start
        // the clock now rather than ask: it repairs the entry, and the worst
        // case is one ask delayed by 90 days instead of one wasted on a user
        // Apple has already been prompted for.
        await AsyncStorage.setItem(LOG_KEY, JSON.stringify([now]));
        return false;
      }

      // Someone who saw the old once-ever prompt has an ask we have no date for.
      // Count it as happening now: the next ask waits the full gap, rather than
      // firing at them on the next task after this update installs.
      if (!log.length && (await AsyncStorage.getItem(LEGACY_KEY)) === "1") {
        await AsyncStorage.setItem(LOG_KEY, JSON.stringify([now]));
        return false;
      }

      const recent = log.filter(t => typeof t === "number" && now - t < YEAR_MS);
      if (recent.length >= MAX_PER_YEAR) return false;

      const last = recent.length ? Math.max(...recent) : 0;
      if (last && now - last < MIN_GAP_MS) return false;

      recent.push(now);
      await AsyncStorage.setItem(LOG_KEY, JSON.stringify(recent));
      return true;
    } catch {
      return false;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
