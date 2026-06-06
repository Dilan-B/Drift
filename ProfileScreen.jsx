/**
 * ProfileScreen.jsx
 * Full-screen profile/settings page.
 */
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Image, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { supabase } from "./supabase";
import { getTheme } from "./theme";
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
}

export default function ProfileScreen({
  userId, userEmail, username, subActive, trialDays, screenTimeStatus,
  dark = false, onClose, onProfileChange, onOpenBlockedApps,
  onRequestScreenTime, onUpgrade, onSignOut,
}) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;
  const [profile, setProfile] = useState(null);
  const [draftUsername, setDraftUsername] = useState(username || "");
  const [savingName, setSavingName] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      let { data, error } = await supabase
        .from("profiles")
        .select("username, avatar_url, sub_active, sub_expires")
        .eq("id", userId)
        .maybeSingle();
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
      const { data, error } = await supabase
        .from("profiles")
        .update({ avatar_url: uri, updated_at: new Date().toISOString() })
        .eq("id", userId)
        .select("username, avatar_url, sub_active, sub_expires")
        .single();
      if (error) throw error;
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
      const { data: taken, error: lookupErr } = await supabase
        .from("profiles")
        .select("id")
        .ilike("username", clean)
        .neq("id", userId)
        .maybeSingle();
      if (lookupErr) throw lookupErr;
      if (taken) {
        Alert.alert("Username taken", "Pick another username.");
        return;
      }
      const { data, error } = await supabase
        .from("profiles")
        .update({ username: clean, updated_at: new Date().toISOString() })
        .eq("id", userId)
        .select("username, sub_active, sub_expires")
        .single();
      if (error) throw error;
      setProfile(data);
      setDraftUsername(data.username);
      onProfileChange?.(data);
    } catch (e) {
      Alert.alert("Username failed", /duplicate|unique/i.test(e.message || "") ? "That username is taken." : (e.message || "Could not update username."));
    } finally {
      setSavingName(false);
    }
  };

  const Row = ({ icon, title, sub, cta, onPress, accent = earn.green }) => (
    <TouchableOpacity onPress={onPress} style={[s.row, { backgroundColor: paper.warm, borderColor: ink.border }]}>
      <View style={s.rowIcon}>{icon?.(accent)}</View>
      <View style={{ flex: 1 }}>
        <Text style={[s.rowTitle, { color: ink.deep }]}>{title}</Text>
        <Text style={[s.rowSub, { color: ink.mid }]}>{sub}</Text>
      </View>
      <Text style={[s.rowCta, { color: accent }]}>{cta || "OPEN"}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={[s.screen, { backgroundColor: paper.card }]}>
      <View style={[s.top, { borderColor: ink.border }]}>
        <TouchableOpacity onPress={onClose} style={[s.close, { backgroundColor: paper.warm }]}>
          <CloseIcon size={16} color={ink.deep} />
        </TouchableOpacity>
        <Text style={[s.topTitle, { color: ink.deep }]}>Profile</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
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
            title="Blocked apps"
            sub="Apps Shielded during Drift In sessions"
            icon={(c) => <ShieldKeyIcon size={20} color={c} />}
            onPress={onOpenBlockedApps}
          />
          <Row
            title="Screen Time access"
            sub={screenTimeStatus === "approved" ? "Approved and ready" : `Status: ${screenTimeStatus || "unknown"}`}
            icon={(c) => <PhoneIcon size={20} color={c} />}
            onPress={onRequestScreenTime}
          />
          {!subActive && (
            <Row
              title="Upgrade to Pro"
              sub="AI checks, custom verified challenges, and more"
              cta="UPGRADE"
              accent={earn.terra}
              icon={(c) => <SparkleIcon size={20} color={c} />}
              onPress={onUpgrade}
            />
          )}
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
      </ScrollView>
    </View>
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
  signOut: { marginTop: 22, padding: 15, borderRadius: 15, backgroundColor: "rgba(224,80,80,0.11)", alignItems: "center" },
  signOutText: { fontFamily: FK, fontSize: 15, color: "#E05050" },
});
