/**
 * ProfileScreen.jsx
 * Full-screen profile/settings page.
 */
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { supabase } from "./supabase";
import { FF, getTheme } from "./theme";
import { cached, invalidateCache, rateLimited } from "./apiGuards";
import FeedbackModal from "./FeedbackModal";
import RedeemCodeModal from "./RedeemCodeModal";
import ShareCard from "./ShareCard";
import { getReferralInfo } from "./referrals";
import {
  CloseIcon, PhoneIcon, SparkleIcon, CheckIcon,
} from "./Icons";

let ImagePicker = null;
let ImageManipulator = null;
try { ImagePicker = require("expo-image-picker"); } catch {}
try { ImageManipulator = require("expo-image-manipulator"); } catch {}

// Organic-editorial type system (see theme.js): Playfair for display moments,
// DM Sans for UI text, Orbitron strictly for small-caps kickers.
const FO = FF.display;    // display serif — avatar initials, username
const FOM = FF.kicker;    // kicker — tiny letterspaced labels, row CTAs
const FK = FF.bodyMed;    // medium sans — row titles, buttons
const FB = FF.body;       // body sans

const normalizeUsername = (raw) =>
  (raw || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);

function validateUsername(raw) {
  const u = normalizeUsername(raw);
  if (u.length < 3) return "Username must be at least 3 characters.";
  if (u.length > 20) return "Username can be at most 20 characters.";
  if (!/^[a-z0-9_]+$/.test(u)) return "Use letters, numbers, and underscores only.";
  return null;
}

function initials(username = "?") {
  return username.slice(0, 2).toUpperCase();
}

function isInlineImage(uri) {
  return typeof uri === "string" && uri.startsWith("data:image/");
}

async function prepareAvatar(uri) {
  if (ImageManipulator?.manipulateAsync) {
    const out = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 360 } }],
      { compress: 0.72, format: ImageManipulator.SaveFormat.JPEG }
    );
    return out.uri;
  }
  return uri;
}

async function uploadAvatar(userId, sourceUri) {
  return rateLimited(`avatar_upload_${userId}`, { limit: 6, windowMs: 60 * 60_000 }, async () => {
    const optimizedUri = await prepareAvatar(sourceUri);
    const bytes = await fetch(optimizedUri).then(r => r.arrayBuffer());
    const path = `${userId}/avatar-${Date.now()}.jpg`;
    const { error } = await supabase.storage
      .from("avatars")
      .upload(path, bytes, {
        contentType: "image/jpeg",
        cacheControl: "31536000",
        upsert: false,
      });
    if (error) throw error;
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    return data.publicUrl;
  });
}

export default function ProfileScreen({
  userId, userEmail, username, subActive, trialDays, screenTimeStatus,
  // Blocked apps/hours, recurring and automatic tasks now live in The Lab, so
  // this screen no longer takes handlers for them.
  dark = false, onClose, onProfileChange,
  onRequestScreenTime, onUpgrade, onSignOut, onDeleteAccount, onProRedeemed,
  inAppPage = false,
}) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;
  const [profile, setProfile] = useState(null);
  const [draftUsername, setDraftUsername] = useState(username || "");
  const [savingName, setSavingName] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [busyActions, setBusyActions] = useState({});
  const [shareOpen, setShareOpen] = useState(false);
  const [stats, setStats] = useState({ streak: 0, tasksCompleted: 0, minutesEarned: 0 });
  const [referralCode, setReferralCode] = useState("");

  useEffect(() => {
    if (!userId) return;
    (async () => {
      let { data, error } = await cached(`profile_${userId}`, 30_000, () => supabase
        .from("profiles")
        .select("username, avatar_url, sub_active, sub_expires")
        .eq("id", userId)
        .maybeSingle());
      if (error && /avatar_url|schema cache/i.test(error.message || "")) {
        const fallback = await supabase
          .from("profiles")
          .select("username, sub_active, sub_expires")
          .eq("id", userId)
          .maybeSingle();
        data = fallback.data;
      }
      if (data) {
        if (isInlineImage(data.avatar_url)) data.avatar_url = null;
        setProfile(data);
        setDraftUsername(data.username || username || "");
        onProfileChange?.(data);
      }
    })();
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const [{ count: tc }, { data: p }, { data: tasks }] = await Promise.all([
        supabase.from("tasks").select("*", { count: "exact", head: true }).eq("user_id", userId).eq("completed", true),
        supabase.from("profiles").select("current_streak, referral_code").eq("id", userId).maybeSingle(),
        supabase.from("tasks").select("credits").eq("user_id", userId).eq("completed", true),
      ]);
      if (p?.referral_code) setReferralCode(p.referral_code);
      const mins = (tasks || []).reduce((sum, t) => sum + (t.credits || 0), 0);
      setStats({
        streak: p?.current_streak || 0,
        tasksCompleted: tc || 0,
        minutesEarned: mins,
      });
    })();
  }, [userId]);

  const currentUsername = profile?.username || username || (userEmail?.split("@")[0] || "user");
  const avatarUrl = profile?.avatar_url;

  const pickAvatar = async () => {
    if (!ImagePicker) {
      Alert.alert("Not available", "Run: npx expo install expo-image-picker");
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission denied", "Allow photo access in Settings.");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.35,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (res.canceled || !res.assets?.[0]?.uri) return;
    setSavingPhoto(true);
    try {
      const uri = await uploadAvatar(userId, res.assets[0].uri);
      const { data, error } = await rateLimited(`profile_update_${userId}`, { limit: 20, windowMs: 60_000 }, () => supabase
        .from("profiles")
        .update({ avatar_url: uri, updated_at: new Date().toISOString() })
        .eq("id", userId)
        .select("username, avatar_url, sub_active, sub_expires")
        .single());
      if (error) throw error;
      invalidateCache(`profile_${userId}`);
      setProfile(data);
      onProfileChange?.(data);
    } catch (e) {
      const raw = e?.message || "";
      Alert.alert(
        "Photo failed",
        /avatar_url|schema cache/i.test(raw)
          ? "Profile photos need the avatar_url database column. Run supabase/profile_challenge_updates.sql, then restart the app."
          : /bucket|storage|avatars|not found/i.test(raw)
            ? "Profile photo storage is not set up yet. Run supabase/profile_challenge_updates.sql in Supabase, then try again."
          : (raw || "Could not update profile photo.")
      );
    } finally {
      setSavingPhoto(false);
    }
  };

  const saveUsername = async () => {
    const clean = normalizeUsername(draftUsername);
    const err = validateUsername(clean);
    if (err) { Alert.alert("Username", err); return; }
    if (clean === currentUsername) return;
    setSavingName(true);
    try {
      const { data: taken, error: lookupErr } = await rateLimited(`username_check_${userId}`, { limit: 30, windowMs: 60_000 }, () =>
        cached(`username_available_${clean}`, 30_000, () => supabase
          .from("profiles")
          .select("id")
          .ilike("username", clean)
          .neq("id", userId)
          .maybeSingle())
      );
      if (lookupErr) throw lookupErr;
      if (taken) {
        Alert.alert("Username taken", "Pick another username.");
        return;
      }
      const { data, error } = await rateLimited(`profile_update_${userId}`, { limit: 20, windowMs: 60_000 }, () => supabase
        .from("profiles")
        .update({ username: clean, updated_at: new Date().toISOString() })
        .eq("id", userId)
        .select("username, sub_active, sub_expires")
        .single());
      if (error) throw error;
      invalidateCache(`profile_${userId}`);
      setProfile(data);
      setDraftUsername(data.username);
      onProfileChange?.(data);
    } catch (e) {
      Alert.alert("Username failed", /duplicate|unique/i.test(e.message || "") ? "That username is taken." : (e.message || "Could not update username."));
    } finally {
      setSavingName(false);
    }
  };

  const runAction = async (key, fn) => {
    if (busyActions[key]) return;
    try {
      const result = fn?.();
      if (result && typeof result.then === "function") {
        setBusyActions(list => ({ ...list, [key]: true }));
        await result;
      }
    } finally {
      setBusyActions(list => {
        const next = { ...list };
        delete next[key];
        return next;
      });
    }
  };

  const Row = ({ id, icon, title, sub, cta, onPress, accent = earn.green }) => {
    const key = id || title;
    const busy = !!busyActions[key];
    return (
    <TouchableOpacity
      disabled={busy}
      onPress={() => runAction(key, onPress)}
      activeOpacity={0.8}
      style={[s.row, { backgroundColor: paper.card, borderColor: ink.border, opacity: busy ? 0.65 : 1 }]}
    >
      {/* Icon sits in a quiet tinted chip so rows read at a glance */}
      <View style={[s.rowIconChip, { backgroundColor: ink.ghost }]}>{icon?.(accent)}</View>
      <View style={{ flex: 1 }}>
        <Text style={[s.rowTitle, { color: ink.deep }]}>{title}</Text>
        <Text style={[s.rowSub, { color: ink.mid }]}>{sub}</Text>
      </View>
      {busy
        ? <ActivityIndicator color={accent} />
        : <Text style={[s.rowCta, { color: accent }]}>{cta || "OPEN"}</Text>}
    </TouchableOpacity>
    );
  };

  const confirmDeleteAccount = () => {
    Alert.alert(
      "Delete account?",
      "This deletes your Drift account and signs you out. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            Alert.alert(
              "Are you sure?",
              "Your username, profile details, tasks, friendships, and feedback will be disconnected from your identity.",
              [
                { text: "Keep account", style: "cancel" },
                {
                  text: "Delete account",
                  style: "destructive",
                  onPress: async () => {
                    setDeletingAccount(true);
                    try {
                      await onDeleteAccount?.();
                    } finally {
                      setDeletingAccount(false);
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  return (
    <KeyboardAvoidingView
      style={[s.screen, { backgroundColor: paper.warm }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* Aurora pools — the same quiet light the rest of the app breathes */}
      <View pointerEvents="none" style={{
        position: "absolute", top: -120, right: -90,
        width: 300, height: 300, borderRadius: 150,
        backgroundColor: theme.fx.auroraMint,
      }} />
      <View pointerEvents="none" style={{
        position: "absolute", bottom: -130, left: -100,
        width: 280, height: 280, borderRadius: 140,
        backgroundColor: theme.fx.auroraClay,
      }} />

      <View style={[s.top, { borderColor: ink.hairline }, inAppPage && { paddingTop: 14 }]}>
        <TouchableOpacity onPress={onClose} style={[s.close, { backgroundColor: ink.ghost }]}>
          <CloseIcon size={16} color={ink.deep} />
        </TouchableOpacity>
        <Text style={[s.topTitle, { color: ink.faint }]}>PROFILE</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={s.hero}>
          <TouchableOpacity onPress={pickAvatar} disabled={savingPhoto} pointerEvents="box-only" style={[s.avatar, { backgroundColor: paper.warm, borderColor: ink.border }]}>
            {avatarUrl && !isInlineImage(avatarUrl) ? (
              <Image source={{ uri: avatarUrl }} style={s.avatarImg} />
            ) : (
              <Text style={[s.avatarText, { color: earn.green }]}>{initials(currentUsername)}</Text>
            )}
            <View style={[s.editBadge, { backgroundColor: earn.green, borderColor: paper.warm }]}>
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                <Path d="M4 20h4L18.5 9.5a2.8 2.8 0 0 0-4-4L4 16v4z" stroke="#fff" strokeWidth={2.2} strokeLinejoin="round" />
                <Path d="M13.5 6.5l4 4" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" />
              </Svg>
            </View>
            {savingPhoto && <ActivityIndicator color={earn.green} style={StyleSheet.absoluteFill} />}
          </TouchableOpacity>
          <Text style={[s.username, { color: ink.deep }]}>
            <Text style={{ color: ink.faint }}>@</Text>{currentUsername}
          </Text>
          <Text style={[s.email, { color: ink.mid }]}>{userEmail || "Not signed in"}</Text>
          {/* Plan status pill removed while payments are off — no plan tiers are
              surfaced to the user, so the profile reads like a normal free app. */}
        </View>

        <View style={[s.section, { backgroundColor: paper.card, borderColor: ink.border }]}>
          <Text style={[s.sectionLabel, { color: ink.faint }]}>ACCOUNT</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              value={draftUsername}
              onChangeText={(t) => setDraftUsername(normalizeUsername(t))}
              placeholder="username"
              placeholderTextColor={ink.faint}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={20}
              style={[s.nameInput, { backgroundColor: paper.sand, borderColor: "transparent", color: ink.deep }]}
            />
            <TouchableOpacity onPress={saveUsername} disabled={savingName} style={[s.saveBtn, { backgroundColor: earn.green }, theme.fx.glow]}>
              {savingName ? <ActivityIndicator color="#fff" /> : <CheckIcon size={18} color="#fff" />}
            </TouchableOpacity>
          </View>
        </View>

        <Text style={[s.groupKicker, { color: ink.faint }]}>SETTINGS</Text>
        <View style={{ gap: 10 }}>
          {/* Blocked apps / hours, recurring tasks and automatic tasks moved to
              The Lab tab — they configure behaviour, not the account, and
              nobody found them buried next to billing. */}
          {/* Only surfaced when access is actually missing — an "Approved" row is
              a dead end the user can't act on. Hidden for "approved" and for
              "unavailable" (Expo Go / non-native build, not fixable from here).
              Every other value, including "unknown", still shows the row: the
              native bridge returns "unknown" both on a thrown call and from its
              @unknown default, and hiding it there would leave no way to grant
              access at all. Better a redundant row than an unreachable one. */}
          {screenTimeStatus !== "approved" && screenTimeStatus !== "unavailable" && (
            <Row
              id="screenTime"
              title="Screen Time access"
              sub={screenTimeStatus === "denied" ? "Denied - tap to enable" : "Not enabled - tap to grant"}
              accent={earn.terra}
              icon={(c) => <PhoneIcon size={20} color={c} />}
              onPress={onRequestScreenTime}
            />
          )}
          {!subActive && (
            <Row
              id="upgrade"
              title="Upgrade to Pro"
              sub="AI checks and challenges"
              cta="UPGRADE"
              accent={earn.terra}
              icon={(c) => <SparkleIcon size={20} color={c} />}
              onPress={onUpgrade}
            />
          )}
          {!subActive && (
            <Row
              id="redeemCode"
              title="Redeem a code"
              sub="Have a Pro code? Unlock it here"
              icon={(c) => <SparkleIcon size={20} color={c} />}
              onPress={() => setRedeemOpen(true)}
            />
          )}
          <Row
            id="shareInvite"
            title="Share & Invite"
            sub="Share your stats, earn bonus time"
            cta="SHARE"
            accent={earn.green}
            icon={(c) => (
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                <Path d="M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" stroke={c} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            )}
            onPress={() => setShareOpen(true)}
          />
        </View>

        {/* Feedback + legal */}
        <View style={[s.legalGroup, { backgroundColor: ink.ghost }]}>
          <TouchableOpacity onPress={() => setFeedbackOpen(true)} style={[s.legalRow, { borderColor: ink.hairline }]}>
            <Text style={[s.legalText, { color: ink.deep }]}>Send feedback</Text>
            <Text style={[s.legalChevron, { color: ink.faint }]}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => Linking.openURL("https://driftproductivity.com/privacy/")}
            style={[s.legalRow, { borderColor: ink.hairline }]}
          >
            <Text style={[s.legalText, { color: ink.deep }]}>Privacy policy</Text>
            <Text style={[s.legalChevron, { color: ink.faint }]}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => Linking.openURL("https://driftproductivity.com/terms/")}
            style={[s.legalRow, { borderColor: "transparent" }]}
          >
            <Text style={[s.legalText, { color: ink.deep }]}>Terms of use</Text>
            <Text style={[s.legalChevron, { color: ink.faint }]}>›</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={() => Alert.alert("Sign out?", "You'll need to sign back in to access your data.", [
            { text: "Cancel", style: "cancel" },
            { text: "Sign out", style: "destructive", onPress: onSignOut },
          ])}
          style={[s.signOut, { backgroundColor: theme.danger.bg }]}
        >
          <Text style={[s.signOutText, { color: theme.danger.fg }]}>Sign out</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={confirmDeleteAccount}
          disabled={deletingAccount}
          style={[s.deleteAccount, { borderColor: theme.danger.border }, deletingAccount && { opacity: 0.65 }]}
        >
          {deletingAccount
            ? <ActivityIndicator color={theme.danger.fg} />
            : <Text style={[s.deleteAccountText, { color: theme.danger.fg }]}>Delete account</Text>}
        </TouchableOpacity>
      </ScrollView>

      <FeedbackModal
        visible={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        userId={userId}
        username={username}
        dark={dark}
      />
      <RedeemCodeModal
        visible={redeemOpen}
        onClose={() => setRedeemOpen(false)}
        onRedeemed={onProRedeemed}
        dark={dark}
      />
      {shareOpen && (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.85)", zIndex: 999 }}>
          <ShareCard
            username={currentUsername}
            streak={stats.streak}
            tasksCompleted={stats.tasksCompleted}
            minutesEarned={stats.minutesEarned}
            referralCode={referralCode}
            theme={{ bg: paper.card, text: ink.deep, sage: earn.green }}
            onClose={() => setShareOpen(false)}
          />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  top: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 18, paddingTop: Platform.OS === "ios" ? 58 : 32, paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  topTitle: { fontFamily: FOM, fontSize: 10, letterSpacing: 2.4 },
  content: { padding: 20, paddingBottom: 48 },
  hero: { alignItems: "center", marginTop: 12, marginBottom: 26 },
  avatar: { width: 104, height: 104, borderRadius: 52, borderWidth: 1, alignItems: "center", justifyContent: "center", overflow: "hidden", marginBottom: 14 },
  avatarImg: { width: "100%", height: "100%" },
  avatarText: { fontFamily: FO, fontSize: 30, letterSpacing: 0 },
  editBadge: {
    position: "absolute", right: 4, bottom: 4,
    width: 28, height: 28, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2,
  },
  username: { fontFamily: FO, fontSize: 30, letterSpacing: -0.4 },
  email: { fontFamily: FB, fontSize: 13, marginTop: 4 },
  statusPill: { marginTop: 12, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16 },
  section: { borderWidth: 1, borderRadius: 22, padding: 16, marginBottom: 22 },
  sectionLabel: { fontFamily: FOM, fontSize: 9, letterSpacing: 2.4, marginBottom: 10 },
  groupKicker: { fontFamily: FOM, fontSize: 9, letterSpacing: 2.4, marginBottom: 10, marginLeft: 4 },
  nameInput: { flex: 1, borderWidth: 1.2, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontFamily: FK, fontSize: 15 },
  saveBtn: { width: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 18, borderWidth: 1, padding: 13 },
  rowIconChip: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontFamily: FK, fontSize: 15 },
  rowSub: { fontFamily: FB, fontSize: 12, marginTop: 2 },
  rowCta: { fontFamily: FOM, fontSize: 9, letterSpacing: 1 },
  legalGroup: { marginTop: 26, borderRadius: 18, overflow: "hidden" },
  legalRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  legalText:  { fontFamily: FK, fontSize: 14 },
  legalChevron: { fontSize: 18 },
  signOut: { marginTop: 22, padding: 15, borderRadius: 16, alignItems: "center" },
  signOutText: { fontFamily: FK, fontSize: 15 },
  deleteAccount: { marginTop: 10, padding: 15, borderRadius: 16, borderWidth: 1, alignItems: "center" },
  deleteAccountText: { fontFamily: FK, fontSize: 15 },
});
