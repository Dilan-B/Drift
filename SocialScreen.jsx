/**
 * SocialScreen.jsx
 * Friends, pending requests, and live challenges.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Image, LayoutAnimation, Modal, Platform, RefreshControl, Share,
  StyleSheet, Text, TextInput, TouchableOpacity, UIManager, View, Vibration,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import AICheckModal from "./AICheckModal";
import { supabase, getFriendsWithScreenTime } from "./supabase";
import { CloseIcon, LockIcon, UsersIcon } from "./Icons";
import ChallengeSheet from "./ChallengeModal";
import Swipeable from "./Swipeable";
import { cached, invalidateCache, rateLimited } from "./apiGuards";

let Clipboard = null;
try { Clipboard = require("expo-clipboard"); } catch { Clipboard = null; }

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const terra = "#2FAB72";
const FD = "Georgia";
const FB = undefined;
const FO = "Orbitron_700Bold";
const FK = "Oswald_700Bold";

const palette = (dark) => dark ? {
  bg: "#0E1B17",
  card: "#16261F",
  card2: "#102019",
  ink: "#E8F5EC",
  mid: "#8FB49F",
  faint: "#5E806C",
  border: "rgba(255,255,255,0.10)",
  wash: "rgba(47,171,114,0.12)",
  input: "#102019",
} : {
  bg: "#F4F9F6",
  card: "#FFFFFF",
  card2: "#EAF7F0",
  ink: "#1A2B1F",
  mid: "#6B8A78",
  faint: "#A8BFB5",
  border: "rgba(26,43,31,0.10)",
  wash: "#E4F5EE",
  input: "#FFFFFF",
};

const cleanUsername = (raw) =>
  (raw || "").trim().replace(/^@/, "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);

const SIX_MONTHS_MS = 183 * 24 * 60 * 60 * 1000;
const CHALLENGE_CACHE_EPOCH = "challenge-reset-2026-06-05";
const LOADING_MESSAGES = ["Almost there", "Working on it", "Syncing updates", "Still loading"];

function smoothUpdate(fn) {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  fn();
}

function getStake(challenge) {
  const penaltyMins = challenge.type === "dare" ? 30 : 15;
  const xp = challenge.type === "dare" ? 20 : 30;
  return { penaltyMins, xp };
}

function isSubActive(profile) {
  if (!profile?.sub_active) return false;
  return !profile.sub_expires || new Date(profile.sub_expires) > new Date();
}

function Avatar({ username = "?", uri, size = 42 }) {
  const initials = username.slice(0, 2).toUpperCase();
  const hue = username.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  if (uri && !uri.startsWith?.("data:image/")) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: "#234" }} />;
  }
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: `hsl(${hue},32%,28%)`,
      alignItems: "center", justifyContent: "center",
    }}>
      <Text style={{ color: `hsl(${hue},55%,78%)`, fontSize: size * 0.34, fontWeight: "700" }}>{initials}</Text>
    </View>
  );
}

function FriendRow({ friend, onChallenge, onViewStats, isPremium, dark }) {
  const th = palette(dark);
  const bar = Math.min(friend.minutes / 120, 1);
  const fmtMins = m => m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim();
  const hasMinutes = friend.minutes > 0;

  return (
    <View style={[s.row, { backgroundColor: th.card, borderColor: th.border }]}>
      <View style={s.friendIdentity}>
        <Avatar username={friend.username} uri={friend.avatar_url} size={46} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.name, { color: th.ink }]} numberOfLines={1}>@{friend.username}</Text>
          {hasMinutes && <Text style={[s.friendMeta, { color: th.mid }]}>{fmtMins(friend.minutes)} screen time today</Text>}
        </View>
      </View>
      {hasMinutes && (
        <View style={[s.barBg, { backgroundColor: dark ? "rgba(255,255,255,0.08)" : "rgba(26,43,31,0.07)" }]}>
          <View style={[s.barFill, { width: `${bar * 100}%`, backgroundColor: terra }]} />
        </View>
      )}
      <View style={s.friendActions}>
        <TouchableOpacity
          onPress={() => onViewStats(friend)}
          style={[s.statsBtn, { backgroundColor: dark ? "rgba(255,255,255,0.05)" : "#F5FAF7", borderColor: th.border }]}
        >
          <Text style={[s.statsBtnText, { color: th.ink }]}>View stats</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => isPremium ? onChallenge(friend) : onChallenge(null)}
          style={[s.chalBtn, { backgroundColor: th.wash, borderColor: isPremium ? terra : th.border }]}
        >
          {isPremium ? <Text style={s.chalBtnText}>Challenge</Text> : <LockIcon size={16} color={th.mid} />}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function LoadingState({ elapsedMs, dark }) {
  const th = palette(dark);
  if (elapsedMs < 2000) return <View style={s.loadingSpace} />;
  if (elapsedMs < 4000) {
    return <ActivityIndicator color={terra} style={{ marginTop: 40 }} />;
  }
  const dynamic = elapsedMs >= 5000;
  const text = dynamic
    ? LOADING_MESSAGES[Math.floor(elapsedMs / 1100) % LOADING_MESSAGES.length]
    : "Loading friends";
  return (
    <View style={s.loadingTextWrap}>
      <Text style={[s.loadingText, { color: th.mid }]}>{text}</Text>
    </View>
  );
}

function FriendStatsModal({ friend, dark, onClose, onChallenge, isPremium }) {
  const th = palette(dark);
  if (!friend) return null;
  const fmtMins = m => m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim();
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={s.modalShade}>
        <View style={[s.detailCard, { backgroundColor: th.card, borderColor: th.border }]}>
          <TouchableOpacity onPress={onClose} style={[s.detailClose, { backgroundColor: th.card2, borderColor: th.border }]}>
            <CloseIcon size={16} color={th.mid} />
          </TouchableOpacity>
          <View style={s.statsProfileHead}>
            <Avatar username={friend.username} uri={friend.avatar_url} size={64} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[s.challengeKicker, { color: terra }]}>FRIEND PROFILE</Text>
              <Text style={[s.detailTitle, { color: th.ink }]} numberOfLines={1}>@{friend.username}</Text>
            </View>
          </View>
          <View style={[s.statsGrid, { borderColor: th.border }]}>
            <View style={[s.statTile, { backgroundColor: th.card2 }]}>
              <Text style={[s.statValue, { color: th.ink }]}>{fmtMins(friend.minutes || 0)}</Text>
              <Text style={[s.statLabel, { color: th.mid }]}>Screen time today</Text>
            </View>
            <View style={[s.statTile, { backgroundColor: th.card2 }]}>
              <Text style={[s.statValue, { color: th.ink }]}>{friend.unlocks || 0}</Text>
              <Text style={[s.statLabel, { color: th.mid }]}>Completed sessions</Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={() => {
              onClose();
              isPremium ? onChallenge(friend) : onChallenge(null);
            }}
            style={[s.detailSolid, { marginTop: 18 }]}
          >
            <Text style={{ color: "#fff", fontWeight: "900" }}>Challenge</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function ChallengeRow({ item, myId, dark, onPress, onVerify }) {
  const th = palette(dark);
  const incoming = item.challenged_id === myId && item.status === "pending";
  const outgoingPending = item.challenger_id === myId && item.status === "pending";
  const mineDone = item.challenger_id === myId ? item.challenger_done : item.challenged_done;
  const label = item.title || item.exercise?.replace(/_/g, " ") || "Challenge";
  const fromName = item.challenger?.username || item.challenger_username || "friend";
  const toName = item.challenged?.username || "friend";
  const stake = getStake(item);

  return (
    <TouchableOpacity
      activeOpacity={0.84}
      onPress={() => incoming || outgoingPending ? onPress(item) : (!mineDone && item.status === "active" ? onVerify(item) : onPress(item))}
      style={[s.challengeBox, { backgroundColor: th.card2, borderColor: th.border }]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[s.challengeKicker, { color: terra }]}>
          {incoming ? "NEW CHALLENGE" : outgoingPending ? "AWAITING REPLY" : item.status === "active" ? "ACTIVE CHALLENGE" : "CHALLENGE"}
        </Text>
        <Text style={[s.challengeTitle, { color: th.ink }]} numberOfLines={1}>
          {incoming ? `@${fromName}` : outgoingPending ? `To @${toName}` : label}
        </Text>
        <Text style={[s.challengeSub, { color: th.mid }]} numberOfLines={1}>
          {incoming ? label : outgoingPending ? "Waiting for them to accept or deny" : mineDone ? "Waiting for result" : "Tap to verify"}
        </Text>
      </View>
      <View style={[s.stakePill, { backgroundColor: th.card, borderColor: th.border }]}>
        <Text style={[s.stakePillText, { color: terra }]}>+{stake.xp} XP</Text>
        <Text style={[s.stakePillSub, { color: th.mid }]}>-{stake.penaltyMins}m</Text>
      </View>
    </TouchableOpacity>
  );
}

function ChallengeDetailModal({ challenge, myId, dark, accepting, acceptedBurst, onAccept, onDecline, onClose }) {
  const th = palette(dark);
  if (!challenge) return null;
  const stake = getStake(challenge);
  const label = challenge.title || challenge.exercise?.replace(/_/g, " ") || "Challenge";
  const fromName = challenge.challenger?.username || "friend";
  const canRespond = challenge.status === "pending" && challenge.challenged_id === myId;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={s.modalShade}>
        <View style={[s.detailCard, { backgroundColor: th.card, borderColor: th.border }]}>
          <TouchableOpacity onPress={onClose} style={[s.detailClose, { backgroundColor: th.card2, borderColor: th.border }]}>
            <CloseIcon size={16} color={th.mid} />
          </TouchableOpacity>
          <Text style={[s.challengeKicker, { color: terra }]}>CHALLENGE FROM @{fromName}</Text>
          <Text style={[s.detailTitle, { color: th.ink }]}>{label}</Text>
          {!!challenge.description && <Text style={[s.detailBody, { color: th.mid }]}>{challenge.description}</Text>}
          <View style={[s.detailStake, { backgroundColor: th.card2, borderColor: th.border }]}>
            <Text style={[s.detailStakeText, { color: th.ink }]}>First verified wins +{stake.xp} XP</Text>
            <Text style={[s.detailBody, { color: th.mid }]}>The other person loses {stake.penaltyMins} minutes of screen time.</Text>
          </View>
          {acceptedBurst && (
            <View style={s.burstWrap} pointerEvents="none">
              {[0, 1, 2, 3, 4, 5].map(i => <View key={i} style={[s.burstDot, { transform: [{ rotate: `${i * 60}deg` }, { translateY: -34 }] }]} />)}
            </View>
          )}
          {canRespond ? (
            <View style={s.detailActions}>
              <TouchableOpacity onPress={() => onDecline(challenge.id)} disabled={accepting} style={[s.detailGhost, { borderColor: th.border }]}>
                <Text style={{ color: th.mid, fontWeight: "800" }}>Deny</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => onAccept(challenge.id)} disabled={accepting} style={s.detailSolid}>
                <Text style={{ color: "#fff", fontWeight: "900" }}>{accepting ? "Accepting" : "Accept"}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={onClose} style={[s.detailSolid, { marginTop: 18 }]}>
              <Text style={{ color: "#fff", fontWeight: "900" }}>Close</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

function ChallengeOutcomeModal({ outcome, dark, onClose }) {
  const th = palette(dark);
  if (!outcome) return null;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={s.modalShade}>
        <View style={[s.detailCard, { backgroundColor: th.card, borderColor: th.border }]}>
          <Text style={[s.challengeKicker, { color: outcome.won ? terra : "#E05050" }]}>
            {outcome.won ? "CHALLENGE WON" : "CHALLENGE LOST"}
          </Text>
          <Text style={[s.detailTitle, { color: th.ink }]}>
            {outcome.won ? `+${outcome.xp} XP` : `-${outcome.penaltyMins} minutes`}
          </Text>
          <Text style={[s.detailBody, { color: th.mid }]}>
            {outcome.won
              ? "You verified first and claimed the reward."
              : "Your friend verified first, so the stake was applied."}
          </Text>
          <TouchableOpacity onPress={onClose} style={[s.detailSolid, s.continueBtn]}>
            <Text style={s.continueText}>Continue</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function PastChallengeRow({ item, myId, dark }) {
  const th = palette(dark);
  const label = item.title || item.exercise?.replace(/_/g, " ") || "Challenge";
  const stake = getStake(item);
  const winnerName =
    item.winner_id === myId ? "you" :
    item.winner_id === item.challenger_id ? (item.challenger?.username || "friend") :
    item.winner_id === item.challenged_id ? (item.challenged?.username || "friend") :
    item.status === "declined" ? "declined" : "not set";
  return (
    <View style={[s.pastRow, { backgroundColor: th.card, borderColor: th.border }]}>
      <Text style={[s.challengeTitle, { color: th.ink }]} numberOfLines={1}>{label}</Text>
      <Text style={[s.challengeSub, { color: th.mid }]}>
        {item.status === "declined" ? "Declined" : `First finished: ${winnerName} · +${stake.xp} XP / -${stake.penaltyMins}m`}
      </Text>
    </View>
  );
}

export default function SocialScreen({ userId, isPremium, onOpenPaywall, onSwipeLockChange, onChallengeResolved, dark = false }) {
  const th = palette(dark);
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingElapsed, setLoadingElapsed] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [addUsername, setAddUsername] = useState("");
  const [adding, setAdding] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [challengeTarget, setChallengeTarget] = useState(null);
  const [myProfile, setMyProfile] = useState(null);
  const [copiedFlag, setCopiedFlag] = useState(false);
  const [friendRequests, setFriendRequests] = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [verifyingChallenge, setVerifyingChallenge] = useState(null);
  const [toast, setToast] = useState("");
  const [showPast, setShowPast] = useState(false);
  const [selectedChallenge, setSelectedChallenge] = useState(null);
  const [acceptingChallenge, setAcceptingChallenge] = useState(false);
  const [acceptedBurst, setAcceptedBurst] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const [knownChallengeStatus, setKnownChallengeStatus] = useState({});
  const [statsFriend, setStatsFriend] = useState(null);
  const showedCachedFriendsRef = useRef(false);

  useEffect(() => {
    onSwipeLockChange?.(!!challengeTarget || showAdd || !!selectedChallenge || !!statsFriend || showPast);
    return () => onSwipeLockChange?.(false);
  }, [challengeTarget, showAdd, selectedChallenge, statsFriend, showPast, onSwipeLockChange]);

  useEffect(() => {
    showedCachedFriendsRef.current = false;
  }, [userId]);

  useEffect(() => {
    if (!loading) {
      setLoadingElapsed(0);
      return undefined;
    }
    const startedAt = Date.now();
    const id = setInterval(() => setLoadingElapsed(Date.now() - startedAt), 250);
    return () => clearInterval(id);
  }, [loading]);

  const loadProfile = useCallback(async () => {
    if (!userId) return;
    let { data, error } = await cached(`social_profile_${userId}`, 30_000, () => supabase
      .from("profiles")
      .select("id, username, avatar_url, sub_active, sub_expires")
      .eq("id", userId)
      .maybeSingle());
    if (error && /avatar_url|schema cache/i.test(error.message || "")) {
      const fallback = await supabase
        .from("profiles")
        .select("id, username, sub_active, sub_expires")
        .eq("id", userId)
        .maybeSingle();
      data = fallback.data;
    }
    if (data?.username) {
      setMyProfile(data);
      return;
    }

    const { data: { user } } = await cached(`auth_user_${userId}`, 60_000, () =>
      rateLimited(`auth_user_${userId}`, { limit: 20, windowMs: 60_000 }, () =>
        supabase.auth.getUser()
      )
    );
    const meta = user?.user_metadata || {};
    const base = cleanUsername(meta.username || meta.full_name);
    const candidate = base.length >= 3 ? base : ("drifter" + Math.random().toString(36).slice(2, 10));
      for (let i = 0; i < 5; i++) {
        const tryName = i === 0 ? candidate : `${candidate.slice(0, 18)}_${i + 1}`;
      let { data: inserted, error } = await rateLimited(`profile_create_${userId}`, { limit: 5, windowMs: 10 * 60_000 }, () =>
        supabase
          .from("profiles")
          .insert({ id: userId, username: tryName })
          .select("id, username, avatar_url, sub_active, sub_expires")
          .single()
      );
      if (error && /avatar_url|schema cache/i.test(error.message || "")) {
        const fallback = await supabase
          .from("profiles")
          .select("id, username, sub_active, sub_expires")
          .eq("id", userId)
          .maybeSingle();
        inserted = fallback.data;
        error = fallback.error;
      }
      if (!error) { setMyProfile(inserted); break; }
      if (!/duplicate|unique/i.test(error.message || "")) break;
    }
  }, [userId]);

  const loadFriends = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    const cacheKey = `drift_friends_cache_${userId}`;
    const cached = await AsyncStorage.getItem(cacheKey).catch(() => null);
    if (cached && !showedCachedFriendsRef.current) {
      try { smoothUpdate(() => setFriends(JSON.parse(cached))); } catch {}
      showedCachedFriendsRef.current = true;
    }
    const data = await getFriendsWithScreenTime(userId);
    if (data?.length || !cached) smoothUpdate(() => setFriends(data || []));
    if (data) AsyncStorage.setItem(cacheKey, JSON.stringify(data)).catch(() => {});
    setLoading(false);
    setRefreshing(false);
  }, [userId]);

  const loadRequests = useCallback(async () => {
    if (!userId) return;
    let { data, error } = await supabase
      .from("friendships")
      .select("id, user_id, profiles!friendships_user_id_fkey(username, avatar_url)")
      .eq("friend_id", userId)
      .eq("status", "pending");
    if (error && /avatar_url|schema cache/i.test(error.message || "")) {
      const fallback = await supabase
        .from("friendships")
        .select("id, user_id, profiles!friendships_user_id_fkey(username)")
        .eq("friend_id", userId)
        .eq("status", "pending");
      data = fallback.data;
    }
    smoothUpdate(() => setFriendRequests(data || []));
  }, [userId]);

  const loadChallenges = useCallback(async () => {
    if (!userId) return;
    const cutoffIso = new Date(Date.now() - SIX_MONTHS_MS).toISOString();
    let { data, error } = await supabase
      .from("challenges")
      .select("*, challenger:profiles!challenges_challenger_id_fkey(username, avatar_url), challenged:profiles!challenges_challenged_id_fkey(username, avatar_url)")
      .or(`challenger_id.eq.${userId},challenged_id.eq.${userId}`)
      .in("status", ["pending", "active", "completed", "declined"])
      .gte("created_at", cutoffIso)
      .order("created_at", { ascending: false });
    if (error && /avatar_url|schema cache/i.test(error.message || "")) {
      const fallback = await supabase
        .from("challenges")
        .select("*, challenger:profiles!challenges_challenger_id_fkey(username), challenged:profiles!challenges_challenged_id_fkey(username)")
        .or(`challenger_id.eq.${userId},challenged_id.eq.${userId}`)
        .in("status", ["pending", "active", "completed", "declined"])
        .gte("created_at", cutoffIso)
        .order("created_at", { ascending: false });
      data = fallback.data;
    }
    smoothUpdate(() => setChallenges(data || []));
  }, [userId]);

  const loadAll = useCallback(async () => {
    await Promise.all([loadProfile(), loadFriends(), loadRequests(), loadChallenges()]);
  }, [loadProfile, loadFriends, loadRequests, loadChallenges]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`social:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "challenges" }, loadChallenges)
      .on("postgres_changes", { event: "*", schema: "public", table: "friendships" }, () => { loadRequests(); loadFriends(); })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${userId}` }, payload => smoothUpdate(() => setMyProfile(payload.new)))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, loadChallenges, loadFriends, loadRequests]);

  useEffect(() => {
    if (!userId) return;
    const id = setInterval(() => {
      loadFriends();
      loadRequests();
      loadChallenges();
    }, 8000);
    return () => clearInterval(id);
  }, [userId, loadFriends, loadRequests, loadChallenges]);

  const addFriend = async () => {
    const username = cleanUsername(addUsername);
    if (!username) return;
    setAdding(true);
    try {
      // Exact (case-insensitive) match only. Wildcard `%q%` searches enable
      // username enumeration — never enable them.
      const { data: profile, error: lookupErr } = await rateLimited(`friend_lookup_${userId}`, { limit: 30, windowMs: 60_000 }, () =>
        cached(`profile_lookup_${username}`, 30_000, () => supabase
          .from("profiles")
          .select("id, username")
          .ilike("username", username)
          .maybeSingle())
      );

      if (lookupErr) { Alert.alert("Lookup failed", "Please try again."); return; }
      if (!profile) { Alert.alert("Not found", `@${username} doesn't have a Drift account.`); return; }
      if (profile.id === userId) { Alert.alert("That's you", "You can't add yourself."); return; }

      const { data: reverse } = await supabase
        .from("friendships")
        .select("id")
        .eq("user_id", profile.id)
        .eq("friend_id", userId)
        .eq("status", "pending")
        .maybeSingle();

      if (reverse?.id) {
        await rateLimited(`friend_accept_${userId}`, { limit: 30, windowMs: 60_000 }, () =>
          supabase.from("friendships").update({ status: "accepted" }).eq("id", reverse.id)
        );
        invalidateCache(`friends_screen_time_${userId}`);
        setToast(`You and @${profile.username} are now friends`);
        setTimeout(() => setToast(""), 2200);
        setAddUsername("");
        setShowAdd(false);
        loadAll();
        return;
      }

      const { error } = await rateLimited(`friend_request_${userId}`, { limit: 20, windowMs: 60_000 }, () =>
        supabase.from("friendships").insert({ user_id: userId, friend_id: profile.id, status: "pending" })
      );
      if (error && error.code !== "23505") Alert.alert("Error", error.message);
      else {
        setAddUsername("");
        setShowAdd(false);
        setToast(error?.code === "23505" ? "Request already sent" : `Friend request sent to @${profile.username}`);
        setTimeout(() => setToast(""), 2200);
        loadAll();
      }
    } finally {
      setAdding(false);
    }
  };

  const acceptRequest = async (id) => {
    await rateLimited(`friend_accept_${userId}`, { limit: 30, windowMs: 60_000 }, () =>
      supabase.from("friendships").update({ status: "accepted" }).eq("id", id)
    );
    invalidateCache(`friends_screen_time_${userId}`);
    smoothUpdate(() => setFriendRequests(p => p.filter(r => r.id !== id)));
    loadAll();
  };

  const handleChallenge = (friend) => {
    if (!friend) { onOpenPaywall?.(); return; }
    setChallengeTarget(friend);
  };

  const markChallengeDone = async (challenge) => {
    const mine = challenge.challenger_id === userId ? "challenger_done" : "challenged_done";
    const winnerId = challenge.winner_id || userId;
    await rateLimited(`challenge_done_${userId}`, { limit: 30, windowMs: 60_000 }, () => supabase.from("challenges").update({
      [mine]: true,
      status: "completed",
      winner_id: winnerId,
    }).eq("id", challenge.id));

    setVerifyingChallenge(null);
    loadChallenges();
  };

  const applyResolvedChallenge = useCallback(async (challenge) => {
    if (!challenge?.id || challenge.status !== "completed" || !challenge.winner_id) return;
    const appliedKey = `drift_challenge_stake_${CHALLENGE_CACHE_EPOCH}_${challenge.id}_${userId}`;
    const alreadyApplied = await AsyncStorage.getItem(appliedKey).catch(() => null);
    if (alreadyApplied) return;
    const stake = getStake(challenge);
    const won = challenge.winner_id === userId;
    onChallengeResolved?.({ won, ...stake, challenge });
    await AsyncStorage.setItem(appliedKey, "1").catch(() => {});
    setOutcome({ won, ...stake, challenge });
  }, [userId, onChallengeResolved]);

  useEffect(() => {
    if (!userId) return;
    challenges
      .filter(c => c.status === "completed" && c.winner_id)
      .forEach(c => { applyResolvedChallenge(c); });
  }, [challenges, userId, applyResolvedChallenge]);

  useEffect(() => {
    if (!userId || challenges.length === 0) return;
    setKnownChallengeStatus(prev => {
      const next = { ...prev };
      challenges.forEach(ch => {
        const id = String(ch.id);
        const oldStatus = prev[id];
        if (oldStatus && oldStatus === "pending" && ch.challenger_id === userId && ch.status !== "pending") {
          const name = ch.challenged?.username || "friend";
          const msg = ch.status === "active"
            ? `@${name} accepted your challenge`
            : ch.status === "declined"
              ? `@${name} denied your challenge`
              : "";
          if (msg) {
            setToast(msg);
            setTimeout(() => setToast(""), 2400);
          }
        }
        next[id] = ch.status;
      });
      return next;
    });
  }, [challenges, userId]);

  const visibleChallenges = useMemo(
    () => challenges.filter(c => c.status === "active" || c.status === "pending"),
    [challenges, userId]
  );
  const pastChallenges = useMemo(() => {
    const cutoff = Date.now() - SIX_MONTHS_MS;
    return challenges.filter(c => (
      (c.status === "completed" || c.status === "declined") &&
      (!c.created_at || new Date(c.created_at).getTime() >= cutoff)
    ));
  }, [challenges]);

  const acceptChallenge = async (id) => {
    setAcceptingChallenge(true);
    await rateLimited(`challenge_respond_${userId}`, { limit: 30, windowMs: 60_000 }, () =>
      supabase.from("challenges").update({ status: "active" }).eq("id", id)
    );
    Vibration.vibrate(18);
    setAcceptedBurst(true);
    setTimeout(() => {
      setAcceptedBurst(false);
      setSelectedChallenge(null);
      setAcceptingChallenge(false);
      loadChallenges();
    }, 680);
  };

  const declineChallenge = async (id) => {
    await rateLimited(`challenge_respond_${userId}`, { limit: 30, windowMs: 60_000 }, () =>
      supabase.from("challenges").update({ status: "declined" }).eq("id", id)
    );
    setSelectedChallenge(null);
    loadChallenges();
  };

  // Cancel a challenge YOU sent that hasn't been accepted yet.
  // SOFT delete — the row stays in the DB with status='cancelled' for audit.
  // Optimistic: remove from visible list immediately, roll back on failure.
  const cancelOutgoingChallenge = async (id) => {
    const before = challenges;
    smoothUpdate(() => setChallenges(prev => prev.filter(c => c.id !== id)));
    const { error } = await rateLimited(`challenge_cancel_${userId}`, { limit: 30, windowMs: 60_000 }, () =>
      supabase
        .from("challenges")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", id)
        .eq("challenger_id", userId) // RLS enforces this too
        .eq("status", "pending")
    );
    if (error) {
      setChallenges(before);
      Alert.alert("Couldn't cancel", error.message || "The other player may have already responded.");
    }
  };

  if (!userId) return (
    <View style={[s.center, { backgroundColor: th.bg }]}>
      <Text style={[s.emptyTitle, { color: th.ink }]}>Sign in to see friends</Text>
      <Text style={[s.emptySub, { color: th.mid }]}>Create an account to compare screen time with friends.</Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: th.bg }}>
      {!!toast && (
        <View style={s.toast} pointerEvents="none">
          <Text style={s.toastText}>{toast}</Text>
        </View>
      )}

      <View style={[s.header, { borderColor: th.border }]}>
        <Text style={[s.headerTitle, { color: th.ink }]}>Friends</Text>
        <TouchableOpacity onPress={() => setShowAdd(v => !v)} style={[s.addBtn, { backgroundColor: th.wash }]}>
          <Text style={s.addBtnText}>{showAdd ? "Cancel" : "+ Add"}</Text>
        </TouchableOpacity>
      </View>

      {showAdd && (
        <View style={[s.addRow, { borderColor: th.border }]}>
          <TextInput
            style={[s.input, { backgroundColor: th.input, borderColor: th.border, color: th.ink }]}
            placeholder="@username"
            placeholderTextColor={th.faint}
            value={addUsername}
            onChangeText={setAddUsername}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="send"
            onSubmitEditing={addFriend}
          />
          <TouchableOpacity onPress={addFriend} disabled={adding} style={s.sendBtn}>
            {adding ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.sendBtnText}>Send</Text>}
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <LoadingState elapsedMs={loadingElapsed} dark={dark} />
      ) : (
        <FlatList
          data={friends}
          keyExtractor={f => f.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadAll(); }} tintColor={terra} />}
          ListHeaderComponent={
            <>
              {!!myProfile?.username && (
                <View style={[s.usernameCard, { backgroundColor: th.card2, borderColor: dark ? "rgba(47,171,114,0.28)" : "rgba(47,171,114,0.2)" }]}>
                  <Avatar username={myProfile.username} uri={myProfile.avatar_url} size={48} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[s.cardKicker, { color: terra }]}>YOUR USERNAME</Text>
                    <Text style={[s.usernameText, { color: th.ink }]} numberOfLines={1}>@{myProfile.username}</Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <TouchableOpacity onPress={async () => {
                      if (Clipboard?.setStringAsync) {
                        await Clipboard.setStringAsync(`@${myProfile.username}`);
                        setCopiedFlag(true);
                        setTimeout(() => setCopiedFlag(false), 1400);
                      } else {
                        Share.share({ message: `@${myProfile.username}` }).catch(() => {});
                      }
                    }} style={s.compactSolid}>
                      <Text style={s.compactSolidText}>{copiedFlag ? "Copied" : "Copy"}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => {
                      const link = `drift://add-friend/${myProfile.username}`;
                      Share.share({
                        message: `Add me on Drift: ${link}`,
                        url: link,
                      }).catch(() => {});
                    }} style={s.compactSolid}>
                      <Text style={s.compactSolidText}>Share</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {friendRequests.length > 0 && (
                <View style={[s.pendingBox, { backgroundColor: th.card, borderColor: th.border }]}>
                  <Text style={[s.cardKicker, { color: terra }]}>FRIEND REQUESTS</Text>
                  {friendRequests.map(r => (
                    <View key={r.id} style={s.pendingRow}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <Avatar username={r.profiles?.username} uri={r.profiles?.avatar_url} size={34} />
                        <Text style={[s.pendingName, { color: th.ink }]}>@{r.profiles?.username}</Text>
                      </View>
                      <TouchableOpacity onPress={() => acceptRequest(r.id)} style={s.smallSolid}>
                        <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>Accept</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              {visibleChallenges.length > 0 && (
                <View style={{ marginBottom: 10 }}>
                  {visibleChallenges.map(ch => {
                    const canCancel = ch.challenger_id === userId && ch.status === "pending";
                    const row = (
                      <ChallengeRow
                        item={ch}
                        myId={userId}
                        dark={dark}
                        onPress={setSelectedChallenge}
                        onVerify={setVerifyingChallenge}
                      />
                    );
                    if (!canCancel) {
                      return <View key={ch.id} style={{ marginBottom: 8 }}>{row}</View>;
                    }
                    return (
                      <View key={ch.id} style={{ marginBottom: 8 }}>
                        <Swipeable
                          onDelete={() => cancelOutgoingChallenge(ch.id)}
                          confirmTitle="Cancel this challenge?"
                          confirmMessage={`The challenge to @${ch.challenged?.username || "friend"} will be withdrawn.`}
                        >
                          {row}
                        </Swipeable>
                      </View>
                    );
                  })}
                </View>
              )}

              {!isPremium && (
                <TouchableOpacity onPress={onOpenPaywall} style={[s.trialBanner, { backgroundColor: dark ? "rgba(90,180,212,0.13)" : "#E6F4FB" }]}>
                  <LockIcon size={12} color="#5AB4D4" />
                  <Text style={[s.trialText, { color: dark ? "#8DD4EA" : "#2A7FA0" }]}>Upgrade to challenge friends</Text>
                </TouchableOpacity>
              )}
            </>
          }
          ListFooterComponent={
            <TouchableOpacity
              onPress={() => setShowPast(true)}
              style={[s.pastButton, { backgroundColor: th.card, borderColor: th.border }]}
            >
              <Text style={[s.pastButtonText, { color: terra }]}>Past challenges</Text>
              <Text style={[s.challengeSub, { color: th.mid }]}>
                {pastChallenges.length} stored from the last 6 months
              </Text>
            </TouchableOpacity>
          }
          renderItem={({ item }) => (
            <FriendRow
              friend={item}
              onChallenge={handleChallenge}
              onViewStats={setStatsFriend}
              isPremium={isPremium}
              dark={dark}
            />
          )}
          ListEmptyComponent={
            <View style={s.center}>
              <View style={{ marginBottom: 14 }}><UsersIcon size={62} color={th.faint} /></View>
              <Text style={[s.emptyTitle, { color: th.ink }]}>No friends yet</Text>
              <Text style={[s.emptySub, { color: th.mid, marginBottom: 28 }]}>Add friends by username to{"\n"}see their screen time today.</Text>
            </View>
          }
          contentContainerStyle={{ padding: 16, paddingBottom: 96, flexGrow: 1 }}
        />
      )}

      {challengeTarget && (
        <ChallengeSheet
          userId={userId}
          target={challengeTarget}
          userIsPremium={isPremium}
          onSwipeLockChange={onSwipeLockChange}
          onSent={() => { setChallengeTarget(null); loadChallenges(); }}
          onClose={() => setChallengeTarget(null)}
          dark={dark}
        />
      )}

      <AICheckModal
        visible={!!verifyingChallenge}
        task={verifyingChallenge ? {
          title: verifyingChallenge.title || verifyingChallenge.exercise,
          minutes: verifyingChallenge.duration_mins || Math.ceil((verifyingChallenge.secs || 60) / 60),
        } : null}
        onVerified={() => markChallengeDone(verifyingChallenge)}
        onCancel={() => setVerifyingChallenge(null)}
        dark={dark}
      />

      <ChallengeDetailModal
        challenge={selectedChallenge}
        myId={userId}
        dark={dark}
        accepting={acceptingChallenge}
        acceptedBurst={acceptedBurst}
        onAccept={acceptChallenge}
        onDecline={declineChallenge}
        onClose={() => setSelectedChallenge(null)}
      />

      <ChallengeOutcomeModal
        outcome={outcome}
        dark={dark}
        onClose={() => setOutcome(null)}
      />

      <FriendStatsModal
        friend={statsFriend}
        dark={dark}
        onClose={() => setStatsFriend(null)}
        onChallenge={handleChallenge}
        isPremium={isPremium}
      />

      <Modal visible={showPast} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPast(false)}>
        <View style={{ flex: 1, backgroundColor: th.bg }}>
          <View style={[s.pastHeader, { borderColor: th.border }]}>
            <Text style={[s.headerTitle, { color: th.ink }]}>Past Challenges</Text>
            <TouchableOpacity onPress={() => setShowPast(false)} style={s.smallSolid}>
              <Text style={{ color: "#fff", fontWeight: "800", fontSize: 12 }}>Close</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={pastChallenges}
            keyExtractor={item => String(item.id)}
            renderItem={({ item }) => <PastChallengeRow item={item} myId={userId} dark={dark} />}
            ListEmptyComponent={
              <View style={s.center}>
                <Text style={[s.emptyTitle, { color: th.ink }]}>No past challenges</Text>
                <Text style={[s.emptySub, { color: th.mid }]}>Resolved challenges live here for 6 months.</Text>
              </View>
            }
            contentContainerStyle={{ padding: 16, paddingBottom: 40, flexGrow: 1 }}
          />
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 18, paddingTop: 48, paddingBottom: 12,
    borderBottomWidth: 0.5,
  },
  headerTitle: { fontFamily: FD, fontSize: 30, fontWeight: "300", fontStyle: "italic" },
  addBtn: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: terra },
  addBtnText: { color: terra, fontSize: 14, fontWeight: "800" },
  addRow: { flexDirection: "row", gap: 8, padding: 12, borderBottomWidth: 0.5 },
  input: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 14, fontSize: 14 },
  sendBtn: { paddingHorizontal: 18, borderRadius: 12, backgroundColor: terra, alignItems: "center", justifyContent: "center" },
  sendBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  usernameCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 18, padding: 14, borderWidth: 1, marginBottom: 12 },
  cardKicker: { fontFamily: FK, fontSize: 10, letterSpacing: 1.4, marginBottom: 2 },
  usernameText: { fontFamily: FK, fontSize: 20 },
  compactSolid: { backgroundColor: terra, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9 },
  compactSolidText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  pendingBox: { padding: 12, borderRadius: 16, borderWidth: 1, marginBottom: 12 },
  pendingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 8 },
  pendingName: { fontSize: 14, fontWeight: "700" },
  challengeBox: { flexDirection: "row", alignItems: "center", gap: 12, padding: 13, borderRadius: 16, borderWidth: 1, marginBottom: 8 },
  challengeKicker: { fontFamily: FK, fontSize: 9, letterSpacing: 1.2, marginBottom: 2 },
  challengeTitle: { fontFamily: FK, fontSize: 15 },
  challengeSub: { fontSize: 12, marginTop: 2, lineHeight: 17 },
  smallSolid: { backgroundColor: terra, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 8 },
  smallGhost: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 8 },
  trialBanner: { marginBottom: 12, padding: 11, borderRadius: 13, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  trialText: { fontSize: 12, fontWeight: "700" },
  pastButton: { borderWidth: 1, borderRadius: 16, padding: 14, alignItems: "center", marginTop: 8 },
  pastButtonText: { fontFamily: FK, fontSize: 16 },
  pastHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingTop: 54, paddingBottom: 14, borderBottomWidth: 0.5 },
  pastRow: { borderWidth: 1, borderRadius: 15, padding: 14, marginBottom: 9 },
  row: { padding: 14, marginBottom: 10, borderWidth: 1, borderRadius: 18 },
  friendIdentity: { flexDirection: "row", alignItems: "center", gap: 12 },
  name: { fontSize: 16, fontWeight: "800" },
  friendMeta: { fontSize: 12, fontWeight: "600", marginTop: 3 },
  barBg: { height: 5, borderRadius: 3, overflow: "hidden", marginTop: 12 },
  barFill: { height: 5, borderRadius: 3 },
  friendActions: { flexDirection: "row", gap: 10, marginTop: 13 },
  statsBtn: { flex: 0.9, minHeight: 44, borderRadius: 13, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  statsBtnText: { fontSize: 13, fontWeight: "800" },
  chalBtn: { flex: 1.15, minHeight: 46, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 13, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  chalBtnText: { color: terra, fontSize: 14, fontWeight: "900" },
  loadingSpace: { minHeight: 96 },
  loadingTextWrap: { minHeight: 120, alignItems: "center", justifyContent: "center" },
  loadingText: { fontSize: 13, fontWeight: "800" },
  statsProfileHead: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 16, paddingRight: 36 },
  statsGrid: { flexDirection: "row", gap: 10, borderTopWidth: 1, paddingTop: 14 },
  statTile: { flex: 1, borderRadius: 15, padding: 13 },
  statValue: { fontFamily: FK, fontSize: 20 },
  statLabel: { fontSize: 11, fontWeight: "700", marginTop: 3 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyTitle: { fontFamily: FD, fontSize: 22, fontStyle: "italic", marginBottom: 8 },
  emptySub: { fontSize: 13, textAlign: "center", lineHeight: 20 },
  toast: {
    position: "absolute", top: 14, left: 18, right: 18, zIndex: 50,
    backgroundColor: terra, borderRadius: 14, paddingVertical: 11, paddingHorizontal: 14,
    alignItems: "center",
  },
  toastText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  modalShade: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.48)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  detailCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 22,
    borderWidth: 1,
    padding: 20,
    overflow: "hidden",
  },
  detailClose: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  detailTitle: { fontFamily: FK, fontSize: 26, marginTop: 6, marginBottom: 8 },
  detailBody: { fontSize: 13, lineHeight: 20 },
  detailStake: { borderWidth: 1, borderRadius: 16, padding: 14, marginTop: 16 },
  detailStakeText: { fontFamily: FK, fontSize: 16, marginBottom: 4 },
  detailActions: { flexDirection: "row", gap: 10, marginTop: 18 },
  detailGhost: { flex: 1, borderWidth: 1, borderRadius: 14, padding: 14, alignItems: "center" },
  detailSolid: { flex: 1, borderRadius: 14, padding: 14, alignItems: "center", backgroundColor: terra },
  continueBtn: { flex: 0, marginTop: 18, width: "100%" },
  continueText: { color: "#FFFFFF", fontWeight: "900", fontSize: 15 },
  burstWrap: {
    position: "absolute",
    left: 0, right: 0, top: 0, bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  burstDot: {
    position: "absolute",
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: terra,
    opacity: 0.55,
  },
});
