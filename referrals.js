/**
 * referrals.js
 * Referral system with tracked codes and rewards.
 *
 * Each user gets a unique 6-char referral code. When a new user enters
 * someone's code after signup, both get 15 bonus screen-time minutes.
 */
import { Share, Platform } from "react-native";
import { supabase } from "./supabase";

const INVITE_BASE_URL = "https://driftproductivity.com";

/** Fetch the current user's referral code and stats. */
export async function getReferralInfo() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("referral_code")
    .eq("id", user.id)
    .single();

  const { count } = await supabase
    .from("referral_events")
    .select("id", { count: "exact", head: true })
    .eq("referrer_id", user.id);

  return {
    code: profile?.referral_code || null,
    referralCount: count || 0,
    bonusMinutesEarned: (count || 0) * 15,
  };
}

/** Share the user's referral link. */
export async function shareReferralLink(code) {
  if (!code) return false;
  const link = `${INVITE_BASE_URL}?ref=${code}`;
  try {
    await Share.share({
      message: Platform.OS === "ios"
        ? `I use Drift to earn my screen time — join with my code ${code} for 15 bonus minutes: ${link}`
        : `I use Drift to earn my screen time — join with my code ${code} for 15 bonus minutes: ${link}`,
      url: Platform.OS === "ios" ? link : undefined,
    });
    return true;
  } catch {
    return false;
  }
}

/** Apply a referral code after signup. Returns { ok, error, bonus_minutes }. */
export async function applyReferralCode(code) {
  if (!code || code.trim().length === 0) return { error: "empty_code" };

  const { data, error } = await supabase.rpc("apply_referral_code", {
    code: code.trim().toUpperCase(),
  });

  if (error) return { error: error.message };
  return data;
}
