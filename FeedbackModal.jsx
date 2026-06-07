/**
 * FeedbackModal.jsx
 * In-app feedback form for beta testers. Saves to supabase.feedback table
 * (with RLS), and falls back to a mailto link if the user prefers email.
 *
 * Run supabase/feedback_setup.sql once to create the table.
 */
import React, { useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Modal,
  Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { supabase } from "./supabase";
import { getTheme } from "./theme";

const FK = "Oswald_700Bold";
const FO = "Orbitron_700Bold";

export default function FeedbackModal({ visible, onClose, userId, username, dark = false }) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const clean = body.trim();
    if (clean.length < 5) { Alert.alert("Too short", "Tell us a bit more."); return; }
    if (clean.length > 5000) { Alert.alert("Too long", "Keep it under 5000 characters."); return; }

    setBusy(true);
    try {
      const { error } = await supabase.from("feedback").insert({
        user_id:     userId || null,
        body:        clean,
        app_version: "1.0",
        platform:    Platform.OS,
        os_version:  String(Platform.Version),
      });
      if (error) throw error;
      setBody("");
      onClose?.();
      Alert.alert("Thanks", "We read every message. We'll get back to you soon.");
    } catch (e) {
      Alert.alert("Couldn't send", e?.message || "Try again later.");
    } finally {
      setBusy(false);
    }
  };

  const openMail = () => {
    const subject = encodeURIComponent("Drift beta feedback");
    const meta = encodeURIComponent(
      `\n\n— App version: 1.0\n— Device: ${Platform.OS} ${Platform.Version}\n— Username: @${username || "(none)"}`
    );
    Linking.openURL(`mailto:support@drift.app?subject=${subject}&body=${meta}`).catch(() => {
      Alert.alert("Mail not set up", "Email us at support@drift.app");
    });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: paper.warm }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={s.header}>
          <TouchableOpacity onPress={onClose}>
            <Text style={[s.headerCancel, { color: ink.mid }]}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[s.headerTitle, { color: ink.deep, fontFamily: FK }]}>Send feedback</Text>
          <TouchableOpacity onPress={submit} disabled={busy}>
            {busy
              ? <ActivityIndicator color={earn.green} />
              : <Text style={[s.headerSend, { color: earn.green }]}>Send</Text>}
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 60 }}>
          <Text style={{ fontFamily: FO, fontSize: 9, color: ink.faint, letterSpacing: 2, marginBottom: 6 }}>
            BETA FEEDBACK
          </Text>
          <Text style={{ color: ink.mid, fontSize: 13, lineHeight: 18, marginBottom: 14 }}>
            Bug? Feature request? Confusing UI? Tell us anything. We read every message.
          </Text>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="What's on your mind?"
            placeholderTextColor={ink.faint}
            multiline
            maxLength={5000}
            style={{
              backgroundColor: paper.card, borderRadius: 14, padding: 14, minHeight: 220,
              textAlignVertical: "top", color: ink.deep, fontSize: 15,
              borderWidth: StyleSheet.hairlineWidth, borderColor: ink.border,
            }}
          />
          <Text style={{ color: ink.faint, fontSize: 11, marginTop: 8, textAlign: "right" }}>
            {body.length} / 5000
          </Text>

          <TouchableOpacity onPress={openMail} style={{ marginTop: 24, padding: 14, alignItems: "center" }}>
            <Text style={{ color: ink.mid, fontSize: 13 }}>
              Prefer email? Tap to open Mail to <Text style={{ color: earn.green }}>support@drift.app</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "rgba(0,0,0,0.07)",
  },
  headerCancel: { fontSize: 15 },
  headerTitle:  { fontSize: 15 },
  headerSend:   { fontSize: 15, fontWeight: "700" },
});
