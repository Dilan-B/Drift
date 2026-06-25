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

async function getAuthCipherKey() {
  let keyHex = await SecureStore.getItemAsync(AUTH_KEYSTORE_KEY);
  if (!keyHex) {
    keyHex = aes.utils.hex.fromBytes(randomBytes(32));
    await SecureStore.setItemAsync(AUTH_KEYSTORE_KEY, keyHex, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }
  return aes.utils.hex.toBytes(keyHex);
}

const encryptedAuthStorage = {
  async getItem(key) {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;

    try {
      const payload = JSON.parse(raw);
      if (payload?.access_token || payload?.refresh_token || payload?.currentSession) {
        await encryptedAuthStorage.setItem(key, raw);
        return raw;
      }
      const cipherKey = await getAuthCipherKey();
      const iv = aes.utils.hex.toBytes(payload.iv);
      const encrypted = aes.utils.hex.toBytes(payload.value);
      const ctr = new aes.ModeOfOperation.ctr(cipherKey, new aes.Counter(iv));
      return aes.utils.utf8.fromBytes(ctr.decrypt(encrypted));
    } catch {
      await AsyncStorage.removeItem(key).catch(() => {});
      return null;
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

// Auto-recover from "Invalid Refresh Token" — a stale session in AsyncStorage
// whose refresh token Supabase no longer recognizes. Sign the user out cleanly
// so the app falls through to the login screen instead of crashing.
supabase.auth.onAuthStateChange((event, session) => {
  if (event === "TOKEN_REFRESHED" && !session) {
    // Refresh failed — clear local session
    supabase.auth.signOut().catch(() => {});
  }
});

// Wrap getSession so a refresh failure during boot doesn't propagate as an
// unhandled error.
export async function safeGetSession() {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      // Stale refresh token — wipe and continue
      await supabase.auth.signOut().catch(() => {});
      return { data: { session: null }, error: null };
    }
    return { data, error: null };
  } catch (e) {
    await supabase.auth.signOut().catch(() => {});
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

  return (profiles || []).map(p => ({
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
