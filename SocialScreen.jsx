/**
 * SocialScreen.jsx
 * Friends list — shows each friend's screen time earned today.
 * Locked challenge feature shown after 7-day trial.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, RefreshControl,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { supabase, getFriendsWithScreenTime } from "./supabase";

const ink = {
  void: "#16120E", deep: "#1E1B15", mid: "#8A7E70",
  faint: "#BFB5A6", border: "rgba(255,255,255,0.09)",
};
const terra = "#D4622A";
const FD = "Georgia";
const FB = undefined;

// Simple avatar from initials
function Avatar({ username = "?", size = 40 }) {
  const initials = username.slice(0, 2).toUpperCase();
  const hue = username.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: `hsl(${hue},35%,25%)`,
      alignItems: "center", justifyContent: "center",
    }}>
      <Text style={{ color: `hsl(${hue},55%,75%)`, fontSize: size * 0.35, fontWeight: "600" }}>
        {initials}
      </Text>
    </View>
  );
}

function FriendRow({ friend, onChallenge, isPremium }) {
  const bar = Math.min(friend.minutes / 120, 1); // 2h max bar
  const fmtMins = m => m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60 > 0 ? `${m % 60}m` : ""}`.trim();

  return (
    <View style={s.row}>
      <Avatar username={friend.username} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
          <Text style={s.name}>@{friend.username}</Text>
          <Text style={s.time}>{friend.minutes > 0 ? fmtMins(friend.minutes) : "none yet"}</Text>
        </View>
        {/* Screen time bar */}
        <View style={s.barBg}>
          <View style={[s.barFill, { width: `${bar * 100}%` }]} />
        </View>
        <Text style={s.sub}>
          {friend.unlocks} unlock{friend.unlocks !== 1 ? "s" : ""} today
        </Text>
      </View>
      <TouchableOpacity
        onPress={() => isPremium ? onChallenge(friend) : onChallenge(null)}
        style={[s.chalBtn, !isPremium && s.chalBtnLocked]}
      >
        <Text style={[s.chalBtnText, !isPremium && { color: "#4A3828" }]}>
          {isPremium ? "Challenge" : "🔒"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export default function SocialScreen({ userId, isPremium, onOpenPaywall }) {
  const [friends,     setFriends]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [addUsername, setAddUsername] = useState("");
  const [adding,      setAdding]      = useState(false);
  const [showAdd,     setShowAdd]     = useState(false);
  const [challengeTarget, setChallengeTarget] = useState(null);

  const load = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    const data = await getFriendsWithScreenTime(userId);
    setFriends(data);
    setLoading(false);
    setRefreshing(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const addFriend = async () => {
    const username = addUsername.trim().replace(/^@/, "");
    if (!username) return;
    setAdding(true);
    try {
      // Look up the user
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("id, username")
        .eq("username", username)
        .single();

      if (error || !profile) {
        Alert.alert("Not found", `@${username} doesn't have a Drift account yet.`);
        setAdding(false);
        return;
      }
      if (profile.id === userId) {
        Alert.alert("That's you", "You can't add yourself.");
        setAdding(false);
        return;
      }

      const { error: e2 } = await supabase.from("friendships").insert({
        user_id: userId, friend_id: profile.id, status: "pending",
      });

      if (e2 && e2.code !== "23505") {
        Alert.alert("Error", e2.message);
      } else {
        Alert.alert("Request sent", `Friend request sent to @${username}.`);
        setAddUsername("");
        setShowAdd(false);
        load();
      }
    } finally {
      setAdding(false);
    }
  };

  const handleChallenge = (friend) => {
    if (!friend) {
      // Not premium — open paywall
      onOpenPaywall?.();
      return;
    }
    setChallengeTarget(friend);
  };

  // Pending requests for this user (as challenged_id)
  const [pending, setPending] = useState([]);
  useEffect(() => {
    if (!userId) return;
    supabase
      .from("friendships")
      .select("id, user_id, profiles!friendships_user_id_fkey(username)")
      .eq("friend_id", userId)
      .eq("status", "pending")
      .then(({ data }) => setPending(data || []));
  }, [userId, friends]);

  const acceptRequest = async (id) => {
    await supabase.from("friendships").update({ status: "accepted" }).eq("id", id);
    setPending(p => p.filter(r => r.id !== id));
    load();
  };

  if (!userId) return (
    <View style={s.center}>
      <Text style={s.emptyTitle}>Sign in to see friends</Text>
      <Text style={s.emptySub}>Create an account to compare screen time with friends.</Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: ink.void }}>

      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>Friends</Text>
        <TouchableOpacity onPress={() => setShowAdd(v => !v)} style={s.addBtn}>
          <Text style={s.addBtnText}>{showAdd ? "Cancel" : "+ Add"}</Text>
        </TouchableOpacity>
      </View>

      {/* Add friend input */}
      {showAdd && (
        <View style={s.addRow}>
          <TextInput
            style={s.input}
            placeholder="@username"
            placeholderTextColor="#4A3828"
            value={addUsername}
            onChangeText={setAddUsername}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="send"
            onSubmitEditing={addFriend}
          />
          <TouchableOpacity onPress={addFriend} disabled={adding} style={s.sendBtn}>
            {adding
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.sendBtnText}>Send</Text>
            }
          </TouchableOpacity>
        </View>
      )}

      {/* Pending requests */}
      {pending.length > 0 && (
        <View style={s.pendingBox}>
          <Text style={s.pendingLabel}>Friend requests</Text>
          {pending.map(r => (
            <View key={r.id} style={s.pendingRow}>
              <Text style={s.pendingName}>@{r.profiles?.username}</Text>
              <TouchableOpacity onPress={() => acceptRequest(r.id)} style={s.acceptBtn}>
                <Text style={s.acceptBtnText}>Accept</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* Premium badge or trial notice */}
      {!isPremium && (
        <TouchableOpacity onPress={onOpenPaywall} style={s.trialBanner}>
          <Text style={s.trialText}>🔒 Upgrade to challenge friends · from $2.99/mo</Text>
        </TouchableOpacity>
      )}

      {/* Friends list */}
      {loading
        ? <ActivityIndicator color={terra} style={{ marginTop: 40 }} />
        : (
          <FlatList
            data={friends}
            keyExtractor={f => f.id}
            renderItem={({ item }) => (
              <FriendRow
                friend={item}
                onChallenge={handleChallenge}
                isPremium={isPremium}
              />
            )}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => { setRefreshing(true); load(); }}
                tintColor={terra}
              />
            }
            ListEmptyComponent={
              <View style={s.center}>
                <Text style={s.emptyTitle}>No friends yet</Text>
                <Text style={s.emptySub}>Add friends by username to{"\n"}see their screen time today.</Text>
              </View>
            }
            contentContainerStyle={{ padding: 16, paddingBottom: 80, flexGrow: 1 }}
          />
        )
      }

      {/* Challenge modal — imported lazily to avoid circular dep */}
      {challengeTarget && (
        <ChallengeSheet
          userId={userId}
          target={challengeTarget}
          onClose={() => setChallengeTarget(null)}
        />
      )}
    </View>
  );
}

// ── Inline challenge sheet (avoid separate import for simplicity) ─
import ChallengeSheet from "./ChallengeModal";

// ── Styles ────────────────────────────────────────────────────
const s = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingTop: 56, paddingBottom: 12,
    borderBottomWidth: 0.5, borderColor: "rgba(255,255,255,0.07)",
  },
  headerTitle: { fontFamily: FD, fontSize: 24, color: "#F0E8D8", fontWeight: "300", fontStyle: "italic" },
  addBtn: {
    paddingVertical: 6, paddingHorizontal: 14, borderRadius: 10,
    borderWidth: 0.5, borderColor: terra, backgroundColor: "rgba(212,98,42,0.1)",
  },
  addBtnText: { color: terra, fontSize: 13, fontWeight: "600" },
  addRow: {
    flexDirection: "row", gap: 8, padding: 12,
    borderBottomWidth: 0.5, borderColor: "rgba(255,255,255,0.06)",
  },
  input: {
    flex: 1, backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 0.5, borderColor: "rgba(255,255,255,0.1)", borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 14,
    color: "#F0E8D8", fontSize: 14,
  },
  sendBtn: {
    paddingHorizontal: 18, borderRadius: 10,
    backgroundColor: terra, alignItems: "center", justifyContent: "center",
  },
  sendBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  pendingBox: {
    margin: 12, padding: 12, borderRadius: 12,
    borderWidth: 0.5, borderColor: "rgba(212,98,42,0.3)",
    backgroundColor: "rgba(212,98,42,0.07)",
  },
  pendingLabel: { fontSize: 11, color: terra, fontWeight: "600", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8 },
  pendingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
  pendingName: { color: "#C0B0A0", fontSize: 14 },
  acceptBtn: { paddingVertical: 5, paddingHorizontal: 14, borderRadius: 8, backgroundColor: terra },
  acceptBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  trialBanner: {
    marginHorizontal: 12, marginTop: 8, padding: 10, borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 0.5, borderColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
  },
  trialText: { color: "#5A4838", fontSize: 12 },
  row: {
    flexDirection: "row", alignItems: "center",
    padding: 14, marginBottom: 8,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 0.5, borderColor: "rgba(255,255,255,0.07)",
    borderRadius: 14,
  },
  name:    { color: "#F0E8D8", fontSize: 14, fontWeight: "500" },
  time:    { color: terra, fontSize: 14, fontWeight: "600", fontFamily: FD },
  barBg:   { height: 3, backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 2, overflow: "hidden" },
  barFill: { height: 3, backgroundColor: terra, borderRadius: 2 },
  sub:     { fontSize: 11, color: "#4A3828", marginTop: 4 },
  chalBtn: {
    marginLeft: 10, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 8,
    borderWidth: 0.5, borderColor: terra, backgroundColor: "rgba(212,98,42,0.12)",
  },
  chalBtnLocked: { borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.03)" },
  chalBtnText: { color: terra, fontSize: 12, fontWeight: "600" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyTitle: { fontFamily: FD, fontSize: 20, color: "#F0E8D8", fontStyle: "italic", marginBottom: 8 },
  emptySub:   { fontSize: 13, color: "#4A3828", textAlign: "center", lineHeight: 20 },
});
