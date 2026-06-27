/**
 * contacts.js
 * Privacy-safe contact matching for the Grove.
 *
 * Flow:
 *   1. Ask for Contacts permission (expo-contacts).
 *   2. Read contact emails, normalise (trim + lowercase), and SHA-256 hash them
 *      LOCALLY with expo-crypto. Raw emails NEVER leave the device.
 *   3. Send only the hashes to the `match-contacts` edge function, which looks
 *      them up against Drift users' email hashes (server-side, service role)
 *      and returns the matched Drift accounts.
 *   4. Caller adds matches as friends; non-matches can be invited via a share
 *      link.
 *
 * Drift is email-signup only, so matching is by email hash. Phone numbers are
 * not matched (we never collect them) — contacts without a Drift email simply
 * fall into the "invite" bucket.
 *
 * Requires `expo-contacts` (npx expo install expo-contacts). Safe no-op if the
 * module is missing.
 */
import { Share } from "react-native";
import * as Crypto from "expo-crypto";
import { supabase } from "./supabase";

let Contacts = null;
try { Contacts = require("expo-contacts"); } catch {}

const INVITE_URL = "https://driftproductivity.com";

export function contactsAvailable() {
  return !!Contacts;
}

/** Pull contact emails, hash them, and ask the server which are on Drift. */
export async function findContactsOnDrift() {
  if (!Contacts) return { available: false, matches: [], contactsCount: 0 };

  let status;
  try {
    ({ status } = await Contacts.getPermissionsAsync());
    if (status !== "granted") ({ status } = await Contacts.requestPermissionsAsync());
  } catch {
    return { available: true, denied: true, matches: [], contactsCount: 0 };
  }
  if (status !== "granted") return { available: true, denied: true, matches: [], contactsCount: 0 };

  let raw;
  try {
    ({ data: raw } = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.Emails, Contacts.Fields.Name],
    }));
  } catch {
    return { available: true, error: "read_failed", matches: [], contactsCount: 0 };
  }

  const emails = new Set();
  (raw || []).forEach(c => (c.emails || []).forEach(e => {
    const v = String(e?.email || "").trim().toLowerCase();
    if (v && v.includes("@")) emails.add(v);
  }));

  const emailList = [...emails].slice(0, 3000);
  if (emailList.length === 0) {
    return { available: true, matches: [], contactsCount: (raw || []).length };
  }

  let hashes;
  try {
    hashes = await Promise.all(
      emailList.map(e => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, e))
    );
  } catch {
    return { available: true, error: "hash_failed", matches: [], contactsCount: (raw || []).length };
  }

  try {
    const { data, error } = await supabase.functions.invoke("match-contacts", {
      body: { emailHashes: hashes },
    });
    if (error || data?.error) {
      return { available: true, error: "lookup_failed", matches: [], contactsCount: (raw || []).length };
    }
    return {
      available: true,
      matches: Array.isArray(data?.matches) ? data.matches : [],
      contactsCount: (raw || []).length,
    };
  } catch {
    return { available: true, error: "lookup_failed", matches: [], contactsCount: (raw || []).length };
  }
}

/** Share a Drift download link with contacts who aren't on Drift yet. */
export async function inviteContacts() {
  try {
    await Share.share({
      message: `I'm using Drift to earn my screen time instead of doom-scrolling — join me: ${INVITE_URL}`,
    });
    return true;
  } catch {
    return false;
  }
}
