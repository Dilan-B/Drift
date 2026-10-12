/**
 * loyaltyPricing.js
 * Drift Pro monthly gets cheaper the longer someone stays subscribed.
 *
 *   months paid without a break   0–1    2–3    4–5    6–7    8+
 *   price                        4.99   4.49   3.99   3.49   2.99
 *
 * Unsubscribing or lapsing resets it: the next subscription starts at $4.99.
 * The server owns the clock — profiles.sub_paid_since, written only by the
 * RevenueCat webhook (schema_v22) — and my_loyalty_pricing() turns it into a
 * tier. Nothing here decides who is eligible; it only asks.
 *
 * Apple won't let an app change one subscriber's price on its own. Each step
 * is a promotional offer on com.drift.pro.month that the subscriber confirms
 * with one tap on Apple's sheet, and it starts at their next renewal. The offer
 * lengths overlap the schedule (2 months per step, 12 at the floor) so a
 * subscriber who accepts each step as it comes never goes back up. One who
 * ignores a step pays $4.99 again once their current offer runs out, until
 * they accept the one they're on.
 *
 * Off unless BOTH app_config.loyalty_pricing = 'true' AND the offer exists on
 * the product in App Store Connect (findLoyaltyDiscount in useSubscription.js),
 * so a build can ship before the store side is set up.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase, getAppConfig } from "./supabase";

/** offerId must match the promotional offer identifiers in App Store Connect. */
export const LOYALTY_LADDER = [
  { tier: 0, price: "$4.99", offerId: null },
  { tier: 1, price: "$4.49", offerId: "loyalty_449" },
  { tier: 2, price: "$3.99", offerId: "loyalty_399" },
  { tier: 3, price: "$3.49", offerId: "loyalty_349" },
  { tier: 4, price: "$2.99", offerId: "loyalty_299" },
];

/** The $2.99 offer lasts 12 months, so the floor is offered again each year. */
const FLOOR_OFFER_MONTHS = 12;
const FLOOR_STARTS_AT_MONTH = 8;

/** Days to wait before asking again after "Not now". */
const SNOOZE_DAYS = 3;

/**
 * The caller's loyalty step, or null when there is nothing to offer: feature
 * switched off, not paying, not on monthly, still at $4.99, or any failure.
 * A failure must never produce an offer, so every path that isn't a clean
 * answer is null.
 */
export async function fetchLoyaltyStep() {
  try {
    const [cfg, res] = await Promise.all([
      getAppConfig(),
      supabase.rpc("my_loyalty_pricing"),
    ]);
    if (String(cfg?.loyalty_pricing ?? "").trim().toLowerCase() !== "true") return null;
    if (res?.error || !res?.data) return null;
    const { tier, months, paid_since: paidSince, product } = res.data;
    if (product !== "com.drift.pro.month" || !paidSince) return null;
    const step = LOYALTY_LADDER[Math.max(0, Math.min(4, Number(tier) || 0))];
    if (!step?.offerId) return null;
    // A key that changes when there is something new to accept: a new run
    // (paidSince), a new step, or a new year at the floor.
    const cycle = step.tier === 4
      ? Math.floor(Math.max(0, (Number(months) || 0) - FLOOR_STARTS_AT_MONTH) / FLOOR_OFFER_MONTHS)
      : 0;
    return { ...step, months: Number(months) || 0, key: `${paidSince}:${step.tier}:${cycle}` };
  } catch {
    return null;
  }
}

const doneKey   = (uid) => `drift_loyalty_done:${uid}`;
const snoozeKey = (uid) => `drift_loyalty_snooze:${uid}`;

/** Whether this step should be offered now (not accepted, not snoozed). */
export async function shouldOfferStep(uid, step) {
  if (!uid || !step?.key) return false;
  try {
    const [done, snooze] = await Promise.all([
      AsyncStorage.getItem(doneKey(uid)),
      AsyncStorage.getItem(snoozeKey(uid)),
    ]);
    if (done === step.key) return false;
    const [snoozedKey, until] = String(snooze || "").split("|");
    if (snoozedKey === step.key && Number(until) > Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

export function markStepAccepted(uid, step) {
  return AsyncStorage.setItem(doneKey(uid), step.key).catch(() => {});
}

export function snoozeStep(uid, step) {
  const until = Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000;
  return AsyncStorage.setItem(snoozeKey(uid), `${step.key}|${until}`).catch(() => {});
}
