/**
 * RedeemCodeModal.jsx
 * Enter a custom Pro code (handed out by the team) to unlock Pro for free.
 * Validation + granting happen server-side (redeem-code edge function); this
 * just collects the code, shows the result, and asks the parent to refresh the
 * Pro state on success.
 */
import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, Modal, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { getTheme, FF } from "./theme";
import { redeemProCode } from "./supabase";

const REASON_MSG = {
  empty: "Enter a code.",
  invalid: "That code isn't valid.",
  inactive: "That code is no longer active.",
  expired: "That code has expired.",
  used_up: "That code has been fully redeemed.",
  failed: "Couldn't redeem right now. Try again.",
};

export default function RedeemCodeModal({ visible, onClose, onRedeemed, dark = false }) {
  const { ink, paper, earn, fx } = getTheme(dark);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const close = () => { setCode(""); setError(""); setDone(false); setBusy(false); onClose?.(); };

  const submit = async () => {
    const clean = code.trim().toUpperCase();
    if (!clean) { setError(REASON_MSG.empty); return; }
    setBusy(true); setError("");
    const res = await redeemProCode(clean);
    setBusy(false);
    if (res.success) {
      setDone(true);
      onRedeemed?.();
      setTimeout(close, 1300);
    } else {
      setError(REASON_MSG[res.reason] || REASON_MSG.failed);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, backgroundColor: paper.warm }}
      >
        <View style={{ flex: 1, padding: 28, paddingTop: 56 }}>
          <TouchableOpacity onPress={close} style={{ alignSelf: "flex-end", padding: 4 }}>
            <Text style={{ fontSize: 26, color: ink.mid, lineHeight: 26 }}>×</Text>
          </TouchableOpacity>

          {done ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontFamily: FF.display, fontSize: 30, color: ink.deep, marginBottom: 8 }}>
                You're Pro 🎉
              </Text>
              <Text style={{ fontFamily: FF.body, fontSize: 14, color: ink.mid, textAlign: "center" }}>
                Your code unlocked Drift Pro.
              </Text>
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: FF.kicker, fontSize: 10, color: earn.sage, letterSpacing: 2.4, marginBottom: 8 }}>
                HAVE A CODE?
              </Text>
              <Text style={{ fontFamily: FF.display, fontSize: 28, color: ink.deep, marginBottom: 8 }}>
                Redeem free Pro
              </Text>
              <Text style={{ fontFamily: FF.body, fontSize: 14, color: ink.mid, marginBottom: 28, lineHeight: 20 }}>
                Enter the code you were given to unlock Drift Pro.
              </Text>

              <TextInput
                value={code}
                onChangeText={(t) => setCode(t.replace(/\s/g, "").toUpperCase().slice(0, 64))}
                placeholder="ENTER CODE"
                placeholderTextColor={ink.faint}
                autoCapitalize="characters"
                autoCorrect={false}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={submit}
                style={{
                  backgroundColor: paper.card,
                  borderWidth: 1.5, borderColor: error ? "#B5564B" : ink.border,
                  borderRadius: 12, paddingVertical: 16, paddingHorizontal: 16,
                  fontSize: 18, letterSpacing: 2, color: ink.deep, textAlign: "center",
                }}
              />
              {!!error && (
                <Text style={{ color: "#B5564B", fontSize: 13, marginTop: 10, textAlign: "center" }}>{error}</Text>
              )}

              <TouchableOpacity
                onPress={submit}
                disabled={busy || !code.trim()}
                style={{
                  marginTop: 22,
                  backgroundColor: code.trim() && !busy ? earn.deep : "#C2DDD3",
                  paddingVertical: 16, borderRadius: 14, alignItems: "center",
                  ...(code.trim() && !busy ? fx.glow : null),
                }}
              >
                {busy
                  ? <ActivityIndicator color="#FAF6EE" />
                  : <Text style={{ fontFamily: FF.bodyMed, fontSize: 15, color: dark ? "#16261C" : "#FAF6EE" }}>Redeem</Text>}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
