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
import { getTheme } from "./theme";
import { cached, invalidateCache, rateLimited } from "./apiGuards";
import FeedbackModal from "./FeedbackModal";
import { getDiagnostics } from "./screenTime";
import {
  CloseIcon, ShieldKeyIcon, PhoneIcon, SparkleIcon, CheckIcon,
} from "./Icons";

let ImagePicker = null;
let ImageManipulator = null;
try { ImagePicker = require("expo-image-picker"); } catch {}
try { ImageManipulator = require("expo-image-manipulator"); } catch {}

const FO = "Orbitron_700Bold";
const FOM = "Orbitron_400Regular";
const FK = "Oswald_700Bold";
const FB = undefined;

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

// ── Beta tester section ──
// `beta` is the object returned by useBetaMode():
//   { unlocked, previewAsFree, tryUnlock(code), setPreviewAsFree(bool), lock() }
function BetaSection({ beta, theme }) {
  const { ink, paper, earn } = theme;
  const [codeInput, setCodeInput] = useState("");
  const [busy,      setBusy]      = useState(false);
  const [err,       setErr]       = useState("");

  const submit = async () => {
    setErr("");
    setBusy(true);
    try {
      const res = await beta.tryUnlock(codeInput);
      if (res.ok) {
        setCodeInput("");
        return;
      }
      if (res.reason === "rate_limit") setErr(res.message || "Too many attempts. Try later.");
      else if (res.reason === "network") setErr("Network error. Check your connection.");
      else setErr("Invalid code.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[s.section, { borderColor: ink.border, marginTop: 16 }]}>
      <Text style={[s.sectionLabel, { color: ink.faint }]}>BETA ACCESS</Text>

      {!beta.unlocked ? (
        <>
          <Text style={{ fontFamily: FB, fontSize: 12, color: ink.mid, marginBottom: 10, lineHeight: 17 }}>
            Enter beta code.
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              value={codeInput}
              onChangeText={setCodeInput}
              placeholder="ENTER CODE"
              placeholderTextColor={ink.faint}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={32}
              style={[s.nameInput, {
                backgroundColor: paper.warm, borderColor: ink.border, color: ink.deep,
                letterSpacing: 1, fontFamily: FOM,
              }]}
            />
            <TouchableOpacity
              onPress={submit}
              disabled={busy || !codeInput.trim()}
              style={{
                paddingHorizontal: 18,
                height: 46,
                borderRadius: 13,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: codeInput.trim() ? earn.green : ink.ghost,
              }}
            >
              {busy ? <ActivityIndicator color="#fff" />
                    : <Text
                        numberOfLines={1}
                        style={{ fontFamily: FO, fontSize: 11, color: "#fff", letterSpacing: 1 }}>
                        UNLOCK
                      </Text>}
            </TouchableOpacity>
          </View>
          {!!err && (
            <Text style={{ fontFamily: FB, fontSize: 12, color: "#E05050", marginTop: 8 }}>{err}</Text>
          )}
        </>
      ) : (
        <>
          <View style={{
            flexDirection: "row", alignItems: "center", justifyContent: "space-between",
            paddingVertical: 4,
          }}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={{ fontFamily: FK, fontSize: 14, color: ink.deep }}>
                Preview free experience
              </Text>
              <Text style={{ fontFamily: FB, fontSize: 11, color: ink.mid, marginTop: 2, lineHeight: 16 }}>
                Preview Free while keeping beta access.
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => beta.setPreviewAsFree(!beta.previewAsFree)}
              style={{
                width: 44, height: 26, borderRadius: 13,
                backgroundColor: beta.previewAsFree ? earn.green : ink.ghost,
                justifyContent: "center",
                paddingHorizontal: 3,
              }}
            >
              <View style={{
                width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff",
                alignSelf: beta.previewAsFree ? "flex-end" : "flex-start",
              }} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={() => {
              Alert.alert("Lock beta access?", "You'll need to enter the code again to use the toggle.", [
                { text: "Cancel", style: "cancel" },
                { text: "Lock", style: "destructive", onPress: () => beta.lock() },
              ]);
            }}
            style={{ marginTop: 14, alignSelf: "flex-start" }}
          >
            <Text style={{ fontFamily: FOM, fontSize: 10, color: ink.mid, letterSpacing: 1 }}>
              LOCK BETA ACCESS
            </Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

export default function ProfileScreen({
  userId, userEmail, username, subActive, trialDays, screenTimeStatus,
  dark = false, onClose, onProfileChange, onOpenBlockedApps, onOpenBlockedHours, onOpenRecurringTasks,
  onRequestScreenTime, onUpgrade, onSignOut, onDeleteAccount,
  inAppPage = false,
  // Beta-tester preview toggle (UX only — no real Pro grant)
  beta,
}) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;
  const [profile, setProfile] = useState(null);
  const [draftUsername, setDraftUsername] = useState(username || "");
  const [savingName, setSavingName] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [busyActions, setBusyActions] = useState({});

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
    <TouchableOpacity disabled={busy} onPress={() => runAction(key, onPress)} style={[s.row, { backgroundColor: paper.warm, borderColor: ink.border, opacity: busy ? 0.65 : 1 }]}>
      <View style={s.rowIcon}>{icon?.(accent)}</View>
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
      "This anonymizes your Drift profile and signs you out. This cannot be undone.",
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
      style={[s.screen, { backgroundColor: paper.card }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[s.top, { borderColor: ink.border }, inAppPage && { paddingTop: 14 }]}>
        <TouchableOpacity onPress={onClose} style={[s.close, { backgroundColor: paper.warm }]}>
          <CloseIcon size={16} color={ink.deep} />
        </TouchableOpacity>
        <Text style={[s.topTitle, { color: ink.deep }]}>Profile</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={s.hero}>
          <TouchableOpacity onPress={pickAvatar} disabled={savingPhoto} style={[s.avatar, { backgroundColor: paper.warm, borderColor: ink.border }]}>
            {avatarUrl && !isInlineImage(avatarUrl) ? (
              <Image source={{ uri: avatarUrl }} style={s.avatarImg} />
            ) : (
              <Text style={[s.avatarText, { color: earn.green }]}>{initials(currentUsername)}</Text>
            )}
            <View style={[s.editBadge, { backgroundColor: earn.green }]}>
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                <Path d="M4 20h4L18.5 9.5a2.8 2.8 0 0 0-4-4L4 16v4z" stroke="#fff" strokeWidth={2.2} strokeLinejoin="round" />
                <Path d="M13.5 6.5l4 4" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" />
              </Svg>
            </View>
            {savingPhoto && <ActivityIndicator color={earn.green} style={StyleSheet.absoluteFill} />}
          </TouchableOpacity>
          <Text style={[s.username, { color: ink.deep }]}>@{currentUsername}</Text>
          <Text style={[s.email, { color: ink.mid }]}>{userEmail || "Not signed in"}</Text>
          <View style={[s.statusPill, { backgroundColor: subActive ? earn.terraLo : paper.warm }]}>
            <Text style={{ color: subActive ? earn.greenD : ink.mid, fontWeight: "800", fontSize: 12 }}>
              {subActive ? "Pro active" : trialDays > 0 ? `${trialDays} trial days left` : "Free"}
            </Text>
          </View>
        </View>

        <View style={[s.section, { borderColor: ink.border }]}>
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
              style={[s.nameInput, { backgroundColor: paper.warm, borderColor: ink.border, color: ink.deep }]}
            />
            <TouchableOpacity onPress={saveUsername} disabled={savingName} style={[s.saveBtn, { backgroundColor: earn.green }]}>
              {savingName ? <ActivityIndicator color="#fff" /> : <CheckIcon size={18} color="#fff" />}
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ gap: 10 }}>
          <Row
            id="blockedApps"
            title="Blocked apps"
            sub="Apps blocked during focus"
            icon={(c) => <ShieldKeyIcon size={20} color={c} />}
            onPress={onOpenBlockedApps}
          />
          <Row
            id="blockedHours"
            title="Blocked hours"
            sub="Force balance to 0"
            cta={subActive ? "OPEN" : "PRO"}
            icon={(c) => <PhoneIcon size={20} color={c} />}
            onPress={onOpenBlockedHours}
          />
          <Row
            id="recurringTasks"
            title="Recurring tasks"
            sub="Auto-create daily tasks"
            cta={subActive ? "OPEN" : "PRO"}
            icon={(c) => <CheckIcon size={20} color={c} />}
            onPress={onOpenRecurringTasks}
          />
          <Row
            id="screenTime"
            title="Screen Time access"
            sub={screenTimeStatus === "approved" ? "Approved" : `Status: ${screenTimeStatus || "unknown"}`}
            icon={(c) => <PhoneIcon size={20} color={c} />}
            onPress={onRequestScreenTime}
          />
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
        </View>

        {/* ── Beta tester section ── */}
        {beta && (
          <BetaSection beta={beta} theme={theme} />
        )}

        {/* Feedback + legal */}
        <View style={s.legalGroup}>
          <TouchableOpacity onPress={() => setFeedbackOpen(true)} style={s.legalRow}>
            <Text style={[s.legalText, { color: ink.deep }]}>Send feedback</Text>
            <Text style={[s.legalChevron, { color: ink.faint }]}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={async () => {
            const d = await getDiagnostics();
            const fmt = (ts) => ts ? new Date(ts * 1000).toLocaleString("en-US", {
              year: "numeric",
              month: "numeric",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              second: "2-digit",
              hour12: true,
            }) : "never";
            Alert.alert("Screen Time diagnostics",
              `Auth: ${d.authStatus || "?"}\n` +
              `App Group OK: ${d.appGroupAvailable}\n` +
              `Selection saved: ${d.selectionStored} (${d.selectionBytes}B)\n` +
              `Picked: ${d.pickedAppCount ?? 0} apps, ${d.pickedCategoryCount ?? 0} cats\n` +
              `Active monitors: ${(d.activeMonitors || []).join(",") || "none"}\n` +
              `Threshold seconds: ${d.thresholdSeconds ?? 0}\n` +
              `Consumed total: ${d.consumedTotalSeconds ?? 0}s\n` +
              `Reported: ${d.reportedSeconds ?? 0}s\n` +
              `Interval start: ${fmt(d.intervalStartAt)}\n` +
              `Failsafe active: ${d.failsafeActive}\n` +
              `Failsafe deadline: ${fmt(d.failsafeDeadline)}\n` +
              `Last fired: ${fmt(d.lastFiredAt)}\n` +
              `Fire count: ${d.fireCount ?? 0}\n` +
              `Depleted flag: ${d.depletedFlag}`
            );
          }} style={s.legalRow}>
            <Text style={[s.legalText, { color: ink.deep }]}>Debug: Screen Time</Text>
            <Text style={[s.legalChevron, { color: ink.faint }]}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => Linking.openURL("https://drift.app/privacy")}
            style={s.legalRow}
          >
            <Text style={[s.legalText, { color: ink.deep }]}>Privacy policy</Text>
            <Text style={[s.legalChevron, { color: ink.faint }]}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => Linking.openURL("https://drift.app/terms")}
            style={s.legalRow}
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
          style={s.signOut}
        >
          <Text style={s.signOutText}>Sign out</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={confirmDeleteAccount}
          disabled={deletingAccount}
          style={[s.deleteAccount, deletingAccount && { opacity: 0.65 }]}
        >
          {deletingAccount
            ? <ActivityIndicator color="#E05050" />
            : <Text style={s.deleteAccountText}>Delete account</Text>}
        </TouchableOpacity>
      </ScrollView>

      <FeedbackModal
        visible={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        userId={userId}
        username={username}
        dark={dark}
      />
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  top: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 18, paddingTop: Platform.OS === "ios" ? 58 : 32, paddingBottom: 14,
    borderBottomWidth: 0.5,
  },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  topTitle: { fontFamily: FK, fontSize: 18 },
  content: { padding: 20, paddingBottom: 48 },
  hero: { alignItems: "center", marginTop: 8, marginBottom: 24 },
  avatar: { width: 104, height: 104, borderRadius: 52, borderWidth: 1, alignItems: "center", justifyContent: "center", overflow: "hidden", marginBottom: 12 },
  avatarImg: { width: "100%", height: "100%" },
  avatarText: { fontFamily: FO, fontSize: 28, letterSpacing: 1 },
  editBadge: {
    position: "absolute", right: 4, bottom: 4,
    width: 28, height: 28, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#fff",
  },
  username: { fontFamily: FK, fontSize: 28 },
  email: { fontFamily: FB, fontSize: 13, marginTop: 2 },
  statusPill: { marginTop: 12, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16 },
  section: { borderWidth: 1, borderRadius: 18, padding: 14, marginBottom: 14 },
  sectionLabel: { fontFamily: FK, fontSize: 10, letterSpacing: 1.4, marginBottom: 9 },
  nameInput: { flex: 1, borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, paddingVertical: 12, fontSize: 15 },
  saveBtn: { width: 48, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, borderWidth: 1, padding: 14 },
  rowIcon: { width: 24, alignItems: "center" },
  rowTitle: { fontFamily: FK, fontSize: 15 },
  rowSub: { fontSize: 12, marginTop: 2 },
  rowCta: { fontFamily: FOM, fontSize: 9, letterSpacing: 1 },
  legalGroup: { marginTop: 24, borderRadius: 15, backgroundColor: "rgba(0,0,0,0.03)", overflow: "hidden" },
  legalRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "rgba(0,0,0,0.07)" },
  legalText:  { fontSize: 14, fontWeight: "500" },
  legalChevron: { fontSize: 18 },
  signOut: { marginTop: 22, padding: 15, borderRadius: 15, backgroundColor: "rgba(224,80,80,0.11)", alignItems: "center" },
  signOutText: { fontFamily: FK, fontSize: 15, color: "#E05050" },
  deleteAccount: { marginTop: 10, padding: 15, borderRadius: 15, borderWidth: 1, borderColor: "rgba(224,80,80,0.22)", alignItems: "center" },
  deleteAccountText: { fontFamily: FK, fontSize: 15, color: "#E05050" },
});
