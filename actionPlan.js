/**
 * actionPlan.js
 * The user's written plan for cutting their own screen time.
 *
 * WHY THIS IS DELIBERATELY NOT AI
 * Every other judgement call in Drift that could be a model call already is one
 * (evaluate-task, verify-task). This one is not, on purpose:
 *
 *   - It has to be inspectable. A plan someone is asked to commit to should be
 *     arithmetic they can check, not a paragraph a model produced. Every number
 *     below is derived from their own answers by a formula in this file.
 *   - It has to work offline, instantly, and for free. Opening a planning screen
 *     is not a moment to wait on a network round-trip.
 *   - It has to be stable. The same answers must always produce the same plan,
 *     or "revise my plan" becomes a slot machine.
 *
 * WHERE THE BASELINE COMES FROM
 * Apple does not expose Screen Time totals to apps — DeviceActivity reports
 * threshold crossings, not readable usage — and Drift only tracks the minutes
 * it has itself unlocked, which is a floor, not a total. So the baseline is
 * self-reported, seeded from today's actual spend when there is one. That is
 * also how screen-time research instruments collect it.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = (userId) => `drift_action_plan_${userId || "anon"}`;

/**
 * Minutes of screen time earned per minute of task.
 *
 * MIRRORS MAX_REWARD_RATIO in Drift.jsx. It is duplicated rather than imported
 * because Drift.jsx exports nothing and importing the shell here would be a
 * circular dependency. If that constant moves, this must move with it — the
 * plan's whole "what it costs you" figure is built on it.
 */
export const EARN_RATIO = 0.5;

export const HARDEST = [
  { key: "morning",   label: "Mornings",   window: [7 * 60,  11 * 60] },
  { key: "afternoon", label: "Afternoons", window: [13 * 60, 17 * 60] },
  { key: "evening",   label: "Evenings",   window: [18 * 60, 21 * 60] },
  { key: "late",      label: "Late night", window: null },  // uses phone-down time
];

export const SWAPS = [
  { key: "walk",    label: "Go for a walk" },
  { key: "read",    label: "Read" },
  { key: "sleep",   label: "Sleep earlier" },
  { key: "friend",  label: "Message a friend properly" },
  { key: "move",    label: "Train or stretch" },
  { key: "tidy",    label: "Tidy one thing" },
  { key: "make",    label: "Work on something of mine" },
];

export const DEFAULT_PLAN = {
  baselineMinutes: 180,
  targetMinutes:   120,
  phoneDownHour:   21,
  phoneDownMinute: 45,
  hardest:         "evening",
  swaps:           [],
  createdAt:       null,
  updatedAt:       null,
};

export async function getPlan(userId) {
  try {
    const raw = await AsyncStorage.getItem(KEY(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? { ...DEFAULT_PLAN, ...parsed } : null;
  } catch { return null; }
}

export async function savePlan(userId, patch) {
  const existing = (await getPlan(userId)) || { ...DEFAULT_PLAN };
  const now = new Date().toISOString();
  const next = {
    ...existing,
    ...patch,
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };
  try { await AsyncStorage.setItem(KEY(userId), JSON.stringify(next)); } catch {}
  return next;
}

export async function clearPlan(userId) {
  try { await AsyncStorage.removeItem(KEY(userId)); } catch {}
}

const clampMins = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));
const pad = (n) => String(n).padStart(2, "0");

/** "HH:MM", the format blocked-hours rules are stored in. */
export const toTimeString = (mins) => {
  const n = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;
};

export function formatClock(hour, minute) {
  const h24 = ((hour % 24) + 24) % 24;
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${pad(minute)} ${suffix}`;
}

export const formatDuration = (mins) => {
  const m = Math.max(0, Math.round(mins));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  if (r === 0) return `${h} hr`;
  return `${h} hr ${r} min`;
};

/**
 * Everything the plan screen displays, derived from the answers alone.
 *
 * The number that does the work here is `dailyTaskMinutes`. Drift caps rewards
 * at half a task's length, so an hour on Instagram is two hours of tasks. Most
 * people have never seen that exchange rate written down, and seeing it is
 * usually what makes the target feel like a real decision rather than a wish.
 */
export function derivePlan(plan) {
  const baseline = clampMins(plan?.baselineMinutes ?? DEFAULT_PLAN.baselineMinutes, 15, 720);
  // A target above baseline is not a reduction plan; clamp rather than reject,
  // so the screen never gets stuck in an unusable state.
  const target = clampMins(plan?.targetMinutes ?? DEFAULT_PLAN.targetMinutes, 0, baseline);

  const savedPerDay = baseline - target;
  const reductionPct = baseline > 0 ? Math.round((savedPerDay / baseline) * 100) : 0;
  const dailyTaskMinutes = Math.ceil(target / EARN_RATIO);

  return {
    baseline,
    target,
    savedPerDay,
    reductionPct,
    dailyTaskMinutes,
    weeklyHoursSaved: Math.round((savedPerDay * 7) / 60 * 10) / 10,
    yearlyDaysSaved:  Math.round((savedPerDay * 365) / 1440 * 10) / 10,
    phoneDownLabel: formatClock(
      plan?.phoneDownHour ?? DEFAULT_PLAN.phoneDownHour,
      plan?.phoneDownMinute ?? DEFAULT_PLAN.phoneDownMinute,
    ),
  };
}

/**
 * The blocked-hours rules this plan implies: an overnight window from their
 * phone-down time to 6am, plus a shorter one over whichever stretch they said
 * was hardest.
 *
 * Returned in the exact shape BlockedHoursModal saves, so these can be merged
 * straight into the existing rules.
 */
export function suggestedRules(plan) {
  const downMins =
    (((plan?.phoneDownHour ?? DEFAULT_PLAN.phoneDownHour) % 24) * 60) +
    (plan?.phoneDownMinute ?? DEFAULT_PLAN.phoneDownMinute);

  const rules = [{
    id: `bh_plan_night`,
    start: toTimeString(downMins),
    end: toTimeString(6 * 60),
    enabled: true,
  }];

  const hardest = HARDEST.find(h => h.key === plan?.hardest);
  // "Late night" is already covered by the overnight window above — adding a
  // second rule for it would just overlap itself.
  if (hardest?.window) {
    rules.push({
      id: `bh_plan_${hardest.key}`,
      start: toTimeString(hardest.window[0]),
      end: toTimeString(hardest.window[1]),
      enabled: true,
    });
  }
  return rules;
}

/**
 * Merge suggested rules into whatever the user already has, without clobbering
 * their own windows. A rule this plan created before (same id) is replaced;
 * anything else is left exactly as it was.
 */
export function mergeRules(existing, suggested) {
  const suggestedIds = new Set(suggested.map(r => r.id));
  const kept = (existing || []).filter(r => !suggestedIds.has(r?.id));
  return [...kept, ...suggested];
}

/** One-line summary for the Lab row. */
export function planSummary(plan) {
  if (!plan) return "Set a screen-time goal and get a concrete plan for it.";
  const d = derivePlan(plan);
  return `${formatDuration(d.target)} a day, phone down by ${d.phoneDownLabel}.`;
}
