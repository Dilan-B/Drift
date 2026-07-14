import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import "react-native-get-random-values";
import * as SecureStore from "expo-secure-store";
import * as aes from "aes-js";
import { cached, invalidateCache, rateLimited } from "./apiGuards";

// ── Project values — anon key is safe to ship (RLS-bounded). ──
export const SUPABASE_URL  = "https://kxsikaymdykepcniozlp.supabase.co";
export const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4c2lrYXltZHlrZXBjbmlvemxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MzEzMDksImV4cCI6MjA5NjEwNzMwOX0.lORjy6XQNBASj28svb9cdqlh9mkvzxu1dy0f77_QrIs";

const AUTH_KEYSTORE_KEY = "drift_supabase_auth_key";

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

// Single-flight, process-memoized cipher-key resolution. CRITICAL: at sign-in
// Supabase writes the session several times in quick succession, and getItem may
// run concurrently too — each call hits getAuthCipherKey independently. Without
// serialization, two concurrent calls on a fresh install both read a null key,
// each MINT A DIFFERENT AES key, and race to persist it: the session gets
// encrypted with one key while the Keychain keeps the other, so every later cold
// start decrypts to garbage and signs the user out. Memoizing one shared promise
// guarantees the key is read/generated exactly once per process and every caller
// uses the same bytes. On failure we clear the memo so a later call can retry
// (and never cache a key born from a transient miss).
let cipherKeyPromise = null;

function getAuthCipherKey() {
  if (!cipherKeyPromise) {
    cipherKeyPromise = (async () => {
      // A transient Keychain read failure must NOT cause us to mint a NEW key —
      // that would orphan the already-encrypted session. Only generate when a
      // read SUCCEEDS and definitively returns null (genuine first run); read
      // errors throw out of here so the memo is cleared and the ciphertext is
      // left untouched for a later (successful) read instead of being wiped.
      let keyHex = await SecureStore.getItemAsync(AUTH_KEYSTORE_KEY);
      if (keyHex == null) {
        // One retry in case the very first read was a transient miss.
        keyHex = await SecureStore.getItemAsync(AUTH_KEYSTORE_KEY);
      }
      if (keyHex == null) {
        keyHex = aes.utils.hex.fromBytes(randomBytes(32));
        await SecureStore.setItemAsync(AUTH_KEYSTORE_KEY, keyHex, {
          keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
        });
        // Adopt whatever actually persisted. If a concurrent first-run path (or a
        // prior process) already wrote a key, the Keychain is the source of truth
        // and we use its bytes rather than our just-generated ones — so all
        // ciphertext and all readers converge on a single key.
        const persisted = await SecureStore.getItemAsync(AUTH_KEYSTORE_KEY);
        if (persisted != null) keyHex = persisted;
      }
      return aes.utils.hex.toBytes(keyHex);
    })();
    // Don't cache a rejected promise — let the next caller retry the read.
    cipherKeyPromise.catch(() => { cipherKeyPromise = null; });
  }
  return cipherKeyPromise;
}

const encryptedAuthStorage = {
  async getItem(key) {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;

    try {
      const payload = JSON.parse(raw);
      // Legacy / unencrypted session stored in the clear → migrate to encrypted.
      if (payload?.access_token || payload?.refresh_token || payload?.currentSession) {
        await encryptedAuthStorage.setItem(key, raw);
        return raw;
      }
      // Encrypted blob.
      if (payload?.iv && payload?.value) {
        const cipherKey = await getAuthCipherKey();
        const iv = aes.utils.hex.toBytes(payload.iv);
        const encrypted = aes.utils.hex.toBytes(payload.value);
        const ctr = new aes.ModeOfOperation.ctr(cipherKey, new aes.Counter(iv));
        const decrypted = aes.utils.utf8.fromBytes(ctr.decrypt(encrypted));
        // AES-CTR with a wrong key silently produces garbage (it doesn't throw).
        // A real Supabase session is JSON — if it doesn't look like JSON, the key
        // didn't match. Return null (session appears absent THIS launch) but keep
        // the ciphertext on disk so a later read with the right key restores it,
        // instead of handing Supabase junk that it treats as a corrupt session.
        const t = decrypted.trimStart();
        return (t.startsWith("{") || t.startsWith("[")) ? decrypted : null;
      }
      // Unknown shape — hand back as-is rather than destroying it.
      return raw;
    } catch {
      // Never wipe on a transient read/parse error.
      return raw;
    }
  },
  async setItem(key, value) {
    const cipherKey = await getAuthCipherKey();
    const iv = randomBytes(16);
    const ctr = new aes.ModeOfOperation.ctr(cipherKey, new aes.Counter(iv));
    const encrypted = ctr.encrypt(aes.utils.utf8.toBytes(value));
    await AsyncStorage.setItem(key, JSON.stringify({
      iv: aes.utils.hex.fromBytes(iv),
      value: aes.utils.hex.fromBytes(encrypted),
    }));
  },
  async removeItem(key) {
    await AsyncStorage.removeItem(key);
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    storage: encryptedAuthStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// NOTE: We deliberately do NOT auto-signOut on `TOKEN_REFRESHED && !session`.
// A failed refresh is usually transient (the app cold-starts before the network
// is ready, a brief 5xx, etc.); nuking the session there is exactly what logs
// users out on force-close. Supabase already clears the session itself on a
// *definitive* invalid_grant (emitting SIGNED_OUT), so transient failures should
// simply be retried by autoRefreshToken — not destroyed by us.
supabase.auth.onAuthStateChange(() => {});

// Wrap getSession so a refresh failure during boot doesn't propagate as an
// unhandled error.
export async function safeGetSession() {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      const msg = error?.message || "";
      if (/invalid.*refresh|refresh.*expired/i.test(msg)) {
        await supabase.auth.signOut().catch(() => {});
        return { data: { session: null }, error: null };
      }
      // Transient errors (network, 5xx) — return whatever data we got so the
      // cached session (if any) isn't thrown away on a flaky cold start.
      return { data: data || { session: null }, error: null };
    }
    return { data, error: null };
  } catch {
    return { data: { session: null }, error: null };
  }
}

// ─────────────────────────────────────────────────────────────
// SUPABASE SETUP — run this SQL in your Supabase SQL editor once:
// Dashboard → SQL Editor → New Query → paste below → Run
// ─────────────────────────────────────────────────────────────
/*

-- Profiles (one row per user)
create table if not exists profiles (
  id          uuid primary key references auth.users on delete cascade,
  username    text unique not null,
  avatar_seed text default 'drift',
  avatar_url  text,
  install_date timestamptz default now(),
  sub_active  boolean default false,
  sub_expires timestamptz,
  updated_at  timestamptz default now()
);
alter table profiles enable row level security;
create policy "Users can read all profiles"    on profiles for select using (true);
create policy "Users can update own profile"   on profiles for update using (auth.uid() = id);
create policy "Users can insert own profile"   on profiles for insert with check (auth.uid() = id);
create unique index if not exists profiles_username_lower_key on profiles (lower(username));

-- Auth already enforces one account per email. This trigger enforces one
-- profile username per signup and fails signup if the username is missing
-- or already taken.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_username text;
begin
  clean_username := lower(regexp_replace(coalesce(new.raw_user_meta_data->>'username', ''), '[^a-z0-9_]', '', 'g'));

  if length(clean_username) < 3 or length(clean_username) > 20 then
    raise exception 'invalid_username';
  end if;

  insert into public.profiles (id, username)
  values (new.id, clean_username);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Screen time earned per day
create table if not exists screen_time (
  id          bigserial primary key,
  user_id     uuid references profiles(id) on delete cascade not null,
  date        date not null default current_date,
  minutes     int  not null default 0,
  unlocks     int  not null default 0,
  unique (user_id, date)
);
alter table screen_time enable row level security;
create policy "Users can read all screen time" on screen_time for select using (true);
create policy "Users can upsert own screen time" on screen_time for all using (auth.uid() = user_id);

-- Friendships
create table if not exists friendships (
  id          bigserial primary key,
  user_id     uuid references profiles(id) on delete cascade not null,
  friend_id   uuid references profiles(id) on delete cascade not null,
  status      text not null default 'pending' check (status in ('pending','accepted')),
  created_at  timestamptz default now(),
  unique (user_id, friend_id)
);
alter table friendships enable row level security;
create policy "Users can manage own friendships" on friendships for all using (
  auth.uid() = user_id or auth.uid() = friend_id
);

-- Challenges between friends
create table if not exists challenges (
  id            bigserial primary key,
  challenger_id uuid references profiles(id) on delete cascade not null,
  challenged_id uuid references profiles(id) on delete cascade not null,
  type          text not null check (type in ('dare','compete')),
  exercise      text not null,
  title         text,
  description   text,
  duration_mins int,
  ai_required   boolean default false,
  reps          int,
  secs          int,
  status        text not null default 'pending' check (status in ('pending','active','completed','declined')),
  winner_id     uuid references profiles(id),
  challenger_done boolean default false,
  challenged_done boolean default false,
  created_at    timestamptz default now(),
  expires_at    timestamptz default (now() + interval '24 hours')
);
alter table challenges enable row level security;
create policy "Challenge participants can read" on challenges for select using (
  auth.uid() = challenger_id or auth.uid() = challenged_id
);
create policy "Challenger can insert"  on challenges for insert with check (auth.uid() = challenger_id);
create policy "Participants can update" on challenges for update using (
  auth.uid() = challenger_id or auth.uid() = challenged_id
);

*/

// ─────────────────────────────────────────────────────────────
// Helper: remote app config (force-update gate, store URL). Public, non-
// sensitive key/value rows in app_config. See schema_v11_app_config.sql.
// ─────────────────────────────────────────────────────────────
export async function getAppConfig() {
  try {
    const { data, error } = await supabase.from("app_config").select("key, value");
    if (error) return {};
    const map = {};
    (data || []).forEach(r => { if (r?.key != null) map[r.key] = r.value; });
    return map;
  } catch {
    return {};
  }
}

// True if `current` semantic version is strictly older than `minimum`.
export function isVersionOutdated(current, minimum) {
  if (!current || !minimum) return false;
  const c = String(current).split(".").map(n => parseInt(n, 10) || 0);
  const m = String(minimum).split(".").map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(c.length, m.length); i++) {
    const cc = c[i] || 0, mm = m[i] || 0;
    if (cc < mm) return true;
    if (cc > mm) return false;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────
// Helper: redeem a custom Pro code. Validated + granted server-side by the
// `redeem-code` edge function (which writes pro_overrides with the service
// role). Codes, limits and expiry live in the redeem_codes table — see
// schema_v10_redeem_codes.sql. Returns { success, reason }.
// ─────────────────────────────────────────────────────────────
export async function redeemProCode(code) {
  const clean = String(code || "").trim().toUpperCase();
  if (!clean) return { success: false, reason: "empty" };
  try {
    const { data, error } = await rateLimited(`redeem_code`, { limit: 8, windowMs: 10 * 60_000 }, () =>
      supabase.functions.invoke("redeem-code", { body: { code: clean } })
    );
    if (error) return { success: false, reason: error.message || "failed" };
    if (data?.error) return { success: false, reason: data.error };
    return { success: !!data?.success, reason: data?.reason || (data?.success ? "granted" : "failed") };
  } catch (e) {
    return { success: false, reason: e?.message || "failed" };
  }
}

// ─────────────────────────────────────────────────────────────
// Helper: persist the pre-signup onboarding answers (analytics).
// Stores both flattened columns (for easy querying) and the raw object.
// Requires schema_v9_onboarding.sql. Safe no-op on any error.
// ─────────────────────────────────────────────────────────────
export async function saveOnboardingResponses(userId, answers) {
  if (!userId || !answers || typeof answers !== "object") return;
  const keys = ["usage", "wakeup", "distractions", "age", "goals", "tasks", "difficulty"];
  if (!keys.some(k => answers[k] != null)) return; // nothing meaningful (e.g. sign-in path)
  const first = (k) => Array.isArray(answers[k]) ? (answers[k][0] ?? null) : (answers[k] ?? null);
  const arr   = (k) => Array.isArray(answers[k]) ? answers[k] : (answers[k] != null ? [answers[k]] : []);
  try {
    await rateLimited(`onboarding_${userId}`, { limit: 5, windowMs: 60_000 }, () =>
      supabase.from("onboarding_responses").upsert({
        user_id:      userId,
        usage:        first("usage"),
        wakeup:       first("wakeup"),
        age:          first("age"),
        difficulty:   first("difficulty"),
        distractions: arr("distractions"),
        goals:        arr("goals"),
        tasks:        arr("tasks"),
        answers,
      }, { onConflict: "user_id" })
    );
  } catch {}
}

// ─────────────────────────────────────────────────────────────
// Helper: sync today's screen time for current user
// ─────────────────────────────────────────────────────────────
export async function syncScreenTime(userId, minutesEarned) {
  if (!userId) return;
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await rateLimited(`screen_time_${userId}`, { limit: 60, windowMs: 60_000 }, () => supabase.rpc("upsert_screen_time", {
    p_user_id: userId,
    p_date:    today,
    p_minutes: minutesEarned,
  }));
  // If RPC doesn't exist yet, fall back to direct upsert:
  if (error) {
    await rateLimited(`screen_time_${userId}`, { limit: 60, windowMs: 60_000 }, () => supabase.from("screen_time").upsert(
      { user_id: userId, date: today, minutes: minutesEarned, unlocks: 1 },
      { onConflict: "user_id,date", ignoreDuplicates: false }
    ));
  }
  invalidateCache(`friends_screen_time_`);
}

// Helper: get friends with today's screen time
export async function getFriendsWithScreenTime(userId) {
  if (!userId) return [];
  return cached(`friends_screen_time_${userId}`, 15_000, async () => {
  const today = new Date().toISOString().slice(0, 10);

  // Get accepted friends
  const { data: friends } = await supabase
    .from("friendships")
    .select("user_id, friend_id")
    .eq("status", "accepted")
    .or(`user_id.eq.${userId},friend_id.eq.${userId}`);

  if (!friends?.length) return [];

  const friendIds = friends.map(f => f.user_id === userId ? f.friend_id : f.user_id);

  // Get their profiles + today's screen time. Older live schemas may not have
  // avatar_url yet, so fall back without it instead of clearing the list.
  let { data: profiles, error: profileErr } = await supabase
    .from("profiles")
    .select(`id, username, avatar_seed, avatar_url, total_xp, screen_time(minutes, unlocks, date)`)
    .in("id", friendIds)
    .eq("screen_time.date", today);

  if (profileErr && /avatar_url|schema cache/i.test(profileErr.message || "")) {
    const fallback = await supabase
      .from("profiles")
      .select(`id, username, avatar_seed, total_xp, screen_time(minutes, unlocks, date)`)
      .in("id", friendIds)
      .eq("screen_time.date", today);
    profiles = fallback.data;
  }

  const cleanAvatarUrl = (url) =>
    typeof url === "string" && url.startsWith("data:image/") ? null : url;

  return (profiles || [])
    // Hide anonymized/deleted accounts (delete-account renames them to
    // "deleted_<id>"). They shouldn't show as friends, and their friendship
    // rows are removed on deletion so they can't be re-managed anyway.
    .filter(p => !/^deleted_/i.test(p.username || ""))
    .map(p => ({
      id:       p.id,
      username: p.username,
      seed:     p.avatar_seed,
      avatar_url: cleanAvatarUrl(p.avatar_url),
      totalXp:  Number(p.total_xp || 0),
      minutes:  p.screen_time?.find(s => s.date === today)?.minutes ?? 0,
      unlocks:  p.screen_time?.find(s => s.date === today)?.unlocks ?? 0,
    }));
  });
}
