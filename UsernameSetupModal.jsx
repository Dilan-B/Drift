/**
 * UsernameSetupModal.jsx
 * Shown after a Google/Apple sign-in if the user has no real username yet
 * (DB trigger gave them a placeholder like "drifter5f3a9c8e").
 *
 * Same validation rules as the email-signup flow:
 *  - 3-20 chars, [a-z0-9_], lowercase, must be available.
 */
import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, Modal, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { supabase } from "./supabase";
import { getTheme } from "./theme";

const FO  = "Orbitron_700Bold";
const FOM = "Orbitron_400Regular";
const FK  = "Oswald_700Bold";

function normalize(raw) {
  return (raw || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
}
function validate(u) {
  if (!u) return "Pick a username.";
  if (u.length < 3) return "At least 3 characters.";
  if (u.length > 20) return "Max 20 characters.";
  if (!/^[a-z0-9_]+$/.test(u)) return "Letters, numbers, underscores only.";
  return null;
}

export default function UsernameSetupModal({ visible, userId, onDone, dark = false }) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;

  const [value,   setValue]   = useState("");
  const [error,   setError]   = useState("");
  const [busy,    setBusy]    = useState(false);

  const submit = async () => {
    setError("");
    const v = normalize(value);
    const err = validate(v);
    if (err) { setError(err); return; }

    setBusy(true);
    try {
      // Case-insensitive availability check
      const { data: taken } = await supabase
        .from("profiles").select("id").ilike("username", v).maybeSingle();
      if (taken && taken.id !== userId) {
        setError("That username is taken. Try another.");
        setBusy(false);
        return;
      }

      // Update profile
      const { error: updErr } = await supabase
        .from("profiles").update({ username: v }).eq("id", userId);
      if (updErr) {
        if (/duplicate|unique/i.test(updErr.message || "")) {
          setError("That username is taken. Try another.");
        } else {
          setError(updErr.message);
        }
        setBusy(false);
        return;
      }

      onDone?.(v);
    } catch (e) {
      setError(e?.message || "Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!userId) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => {}}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, backgroundColor: paper.warm }}
      >
        <View style={{ flex: 1, padding: 28, paddingTop: 60, justifyContent: "space-between" }}>
          <View>
            <Text style={{ fontFamily: FOM, fontSize: 9, color: ink.faint, letterSpacing: 2, marginBottom: 8 }}>
              ONE MORE THING
            </Text>
            <Text style={{ fontFamily: FK, fontSize: 28, color: ink.deep, marginBottom: 8 }}>
              Pick your username
            </Text>
            <Text style={{ fontSize: 14, color: ink.mid, marginBottom: 32, lineHeight: 20 }}>
              How friends find you. Can't be changed later.
            </Text>

            <Text style={{ fontFamily: FOM, fontSize: 9, color: ink.faint, letterSpacing: 2, marginBottom: 8 }}>
              USERNAME
            </Text>
            <TextInput
              value={value}
              onChangeText={(t) => setValue(normalize(t))}
              placeholder="3–20 chars, letters/numbers/_"
              placeholderTextColor={ink.faint}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              maxLength={20}
              style={{
                backgroundColor: paper.card,
                borderWidth: 1.5, borderColor: ink.border, borderRadius: 12,
                padding: 14, fontSize: 16, color: ink.deep,
              }}
            />
            {!!error && (
              <Text style={{ color: "#E05050", fontSize: 13, marginTop: 10 }}>{error}</Text>
            )}
          </View>

          <TouchableOpacity
            onPress={submit}
            disabled={busy || !value}
            style={{
              backgroundColor: value && !busy ? earn.green : "#C2DDD3",
              paddingVertical: 16, borderRadius: 14, alignItems: "center",
            }}
          >
            {busy
              ? <ActivityIndicator color="#fff" />
              : <Text style={{ fontFamily: FO, fontSize: 13, color: "#fff", letterSpacing: 2 }}>
                  CLAIM USERNAME
                </Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
