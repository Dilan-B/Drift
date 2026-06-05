import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ── Project values — anon key is safe to ship (RLS-bounded). ──
export const SUPABASE_URL  = "https://kxsikaymdykepcniozlp.supabase.co";
export const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4c2lrYXltZHlrZXBjbmlvemxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MzEzMDksImV4cCI6MjA5NjEwNzMwOX0.lORjy6XQNBASj28svb9cdqlh9mkvzxu1dy0f77_QrIs";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

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
  install_date timestamptz default now(),
  sub_active  boolean default false,
  sub_expires timestamptz,
  updated_at  timestamptz default now()
);
alter table profiles enable row level security;
create policy "Users can read all profiles"    on profiles for select using (true);
create policy "Users can update own profile"   on profiles for update using (auth.uid() = id);
create policy "Users can insert own profile"   on profiles for insert with check (auth.uid() = id);

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
  const { error } = await supabase.rpc("upsert_screen_time", {
    p_user_id: userId,
    p_date:    today,
    p_minutes: minutesEarned,
  });
  // If RPC doesn't exist yet, fall back to direct upsert:
  if (error) {
    await supabase.from("screen_time").upsert(
      { user_id: userId, date: today, minutes: minutesEarned, unlocks: 1 },
      { onConflict: "user_id,date", ignoreDuplicates: false }
    );
  }
}

// Helper: get friends with today's screen time
export async function getFriendsWithScreenTime(userId) {
  if (!userId) return [];
  const today = new Date().toISOString().slice(0, 10);

  // Get accepted friends
  const { data: friends } = await supabase
    .from("friendships")
    .select("user_id, friend_id")
    .eq("status", "accepted")
    .or(`user_id.eq.${userId},friend_id.eq.${userId}`);

  if (!friends?.length) return [];

  const friendIds = friends.map(f => f.user_id === userId ? f.friend_id : f.user_id);

  // Get their profiles + today's screen time
  const { data: profiles } = await supabase
    .from("profiles")
    .select(`id, username, avatar_seed, screen_time(minutes, unlocks, date)`)
    .in("id", friendIds);

  return (profiles || []).map(p => ({
    id:       p.id,
    username: p.username,
    seed:     p.avatar_seed,
    minutes:  p.screen_time?.find(s => s.date === today)?.minutes ?? 0,
    unlocks:  p.screen_time?.find(s => s.date === today)?.unlocks ?? 0,
  }));
}
