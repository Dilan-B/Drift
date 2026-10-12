/**
 * freeTier.js
 * What a personal account gets without Pro ("Seedling"), in one place.
 *
 * Drift used to be paid-only: no subscription, no app. Teens mostly cannot
 * start an App Store subscription without a parent's card, so the hard paywall
 * turned away the audience the app is built for. The free tier is the core loop
 * with limits; Pro is everything past them; Family stays subscribe-to-start.
 *
 *   Free:  up to FREE_BLOCK_LIMIT blocked picks, FREE_DAILY_TASKS photo-checked
 *          tasks a day (flat, duration-based credits), plant stages 1–3,
 *          focus sessions.
 *   Pro:   unlimited picks and tasks, AI-valued credits, recurring tasks,
 *          blocked hours, Lockbox, plant stages 4+, friend challenges.
 *
 * Client checks here are UX only. The task allowance is enforced by
 * verify-task (app_config.free_daily_tasks, schema_v21) and the pick cap by
 * the native picker (DRIFT_FREE_BLOCK_LIMIT in ScreenTimeModule.swift).
 */
import { getAppConfig } from "./supabase";

/** Apps + categories + websites. Mirrors DRIFT_FREE_BLOCK_LIMIT in Swift. */
export const FREE_BLOCK_LIMIT = 3;

/**
 * Approved tasks per local day. The live number is app_config.free_daily_tasks
 * (read by fetchFreeDailyTasks); this is the fallback, and must match the
 * seeded value and verify-task's FREE_DAILY_TASKS_DEFAULT.
 */
export const FREE_DAILY_TASKS = 3;

/**
 * Highest plant stage a free user sees, as an index into LEVELS: 0 Seedling,
 * 1 Sprout, 2 Sapling. XP keeps accruing past it, so upgrading reveals the
 * stage they have actually earned rather than starting them over.
 */
export const FREE_MAX_LEVEL_IDX = 2;

/** The level index to SHOW: the real one for Pro, capped for free. */
export function displayLevelIdx(realIdx, isPro) {
  return isPro ? realIdx : Math.min(realIdx, FREE_MAX_LEVEL_IDX);
}

/** Tasks completed on `dayKey` (the app's todayKey()) in a task history. */
export function tasksDoneOn(taskHistory, dayKey) {
  if (!Array.isArray(taskHistory)) return 0;
  return taskHistory.filter(t => t?.completedDate === dayKey).length;
}

/**
 * The live daily allowance from app_config, falling back to FREE_DAILY_TASKS.
 * Reading the same row the server enforces keeps "2 of 3 today" from
 * disagreeing with the 402 the user gets on the next check.
 */
export async function fetchFreeDailyTasks() {
  try {
    const raw = (await getAppConfig())?.free_daily_tasks;
    const n = parseInt(String(raw ?? ""), 10);
    return Number.isFinite(n) && n >= 0 ? n : FREE_DAILY_TASKS;
  } catch {
    return FREE_DAILY_TASKS;
  }
}
