/**
 * screenTimeStats.js
 * How much earned screen time was actually SPENT, per day.
 *
 * `credits.spent` already existed but is not this number. It is a running
 * session total that boot-restore resets to 0 (see the balanceSeconds branch in
 * Drift.jsx), so it answers "since this install woke up" rather than "today" —
 * which is why the Grove had no daily figure and friends' screen time was
 * always blank.
 *
 * This keeps a real per-day ledger, keyed by local day so it rolls over at the
 * user's midnight rather than UTC's. It is written from the drain tick, which
 * is the only place that knows time was consumed, and is the source for both
 * the Grove stat and the friends leaderboard.
 *
 * DELIBERATELY LOCAL-FIRST. The drain tick runs every few seconds; sending each
 * one to Postgres would be absurd. Writes land in AsyncStorage immediately and
 * are flushed to the server on a throttle, on backgrounding, and at day
 * rollover.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { syncScreenTime } from "./supabase";

const KEY = uid => `drift_spend_ledger_${uid || "anon"}`;

// Keep a week plus a day of slack. Enough for the weekly chart, small enough
// that the blob stays trivial to parse on every tick.
const KEEP_DAYS = 8;

// Server flush cadence. 90s means a friend's leaderboard position is at most a
// minute and a half stale, which is well inside what anyone would notice, at
// roughly 40 writes over a heavy day.
const FLUSH_EVERY_MS = 90_000;

const dayKeyOf = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
export const todayKey = () => dayKeyOf(new Date());

// In-memory mirror so the drain tick never awaits a disk read. Shape:
// { uid, days: { "YYYY-MM-DD": seconds }, lastFlushAt, dirty }
let mem = null;

async function load(userId) {
  if (mem && mem.uid === userId) return mem;
  let days = {};
  try {
    const raw = await AsyncStorage.getItem(KEY(userId));
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") days = parsed.days || {};
  } catch {}
  mem = { uid: userId, days, lastFlushAt: 0, dirty: false };
  return mem;
}

function prune(days) {
  const keys = Object.keys(days).sort();
  if (keys.length <= KEEP_DAYS) return days;
  const drop = keys.slice(0, keys.length - KEEP_DAYS);
  const out = { ...days };
  for (const k of drop) delete out[k];
  return out;
}

async function persist(state) {
  try {
    await AsyncStorage.setItem(KEY(state.uid), JSON.stringify({ days: state.days }));
  } catch {}
}

/**
 * Record `seconds` of earned screen time consumed right now.
 * Safe to call on every drain tick; cheap, and only flushes on a throttle.
 */
export async function recordSpend(userId, seconds) {
  const secs = Math.max(0, Math.round(Number(seconds) || 0));
  if (!secs) return;

  const state = await load(userId);
  const k = todayKey();
  state.days[k] = (state.days[k] || 0) + secs;
  state.days = prune(state.days);
  state.dirty = true;

  await persist(state);

  if (Date.now() - state.lastFlushAt > FLUSH_EVERY_MS) {
    flush(userId).catch(() => {});
  }
}

/** Seconds of screen time spent today. */
export async function getTodaySpentSeconds(userId) {
  const state = await load(userId);
  return state.days[todayKey()] || 0;
}

/** Whole minutes spent today — the figure the UI shows. */
export async function getTodaySpentMinutes(userId) {
  return Math.floor((await getTodaySpentSeconds(userId)) / 60);
}

/** `{ "YYYY-MM-DD": seconds }` for the retained window. */
export async function getSpendByDay(userId) {
  const state = await load(userId);
  return { ...state.days };
}

/**
 * Push today's total to the server so friends can see it.
 *
 * Failure is silent and non-destructive: the local ledger is the source of
 * truth and the next flush re-sends the (larger) running total, so a missed
 * write self-heals rather than losing the day.
 */
export async function flush(userId, { earnedMinutes } = {}) {
  if (!userId) return;
  const state = await load(userId);
  state.lastFlushAt = Date.now();
  const spentMinutes = Math.floor((state.days[todayKey()] || 0) / 60);
  try {
    await syncScreenTime(userId, earnedMinutes, { spentMinutes });
    state.dirty = false;
  } catch {}
}

/** Drop the cached mirror — call on sign-out so the next user starts clean. */
export function resetCache() {
  mem = null;
}
