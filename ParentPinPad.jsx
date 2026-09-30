/**
 * ParentPinPad.jsx
 * Child device: "Manage app access" → this pin pad → Apple's native app picker.
 *
 * The parent is standing next to the kid, so this is one step, not a settings
 * page: enter the family PIN, and on a correct PIN the picker opens straight
 * away. Picking apps puts this child in CUSTOM mode (the verify call flips it
 * server-side with the service role — the child can't write its own policy).
 *
 * Parent PINs are 4–8 digits, so there's no auto-submit on the 4th digit; the
 * ✓ key becomes active from 4 digits on.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, Platform,
  StatusBar, ActivityIndicator, Animated, Alert,
} from "react-native";
import { getTheme, FF } from "./theme";
import { CloseIcon, CheckIcon } from "./Icons";
import { selectionTick, notify } from "./haptics";
import { presentAppPicker, isAvailable as screenTimeAvailable } from "./screenTime";
import { verifyFamilyPin } from "./family";

const MIN = 4;
const MAX = 8;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "del", "0", "ok"];

export default function ParentPinPad({ visible, onClose, dark, familyId }) {
  const t = getTheme(dark);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => { if (visible) { setPin(""); setErr(""); } }, [visible]);

  const press = (k) => {
    if (busy) return;
    selectionTick();
    setErr("");
    if (k === "del") setPin((p) => p.slice(0, -1));
    else if (k === "ok") submit();
    else setPin((p) => (p.length < MAX ? p + k : p));
  };

  const wrong = (message) => {
    notify(false);
    setErr(message);
    setPin("");
    Animated.sequence([10, -10, 7, -7, 0].map((x) =>
      Animated.timing(shake, { toValue: x, duration: 55, useNativeDriver: true }),
    )).start();
  };

  async function submit() {
    if (pin.length < MIN || !familyId) return;
    setBusy(true);
    const res = await verifyFamilyPin(familyId, pin, "custom");
    setBusy(false);
    if (!res.ok) {
      wrong(res.reason === "no_pin" ? "A parent needs to set a PIN in their app first."
        : res.reason === "network" ? "Couldn't check the PIN. Try again."
        : "That PIN isn't right.");
      return;
    }
    notify(true);
    onClose?.();
    if (!screenTimeAvailable()) {
      Alert.alert("Not available here", "Picking apps needs the App Store or TestFlight version of Drift.");
      return;
    }
    // Let the modal finish dismissing; iOS won't present the picker over a
    // sheet that is still animating away.
    setTimeout(() => { presentAppPicker(); }, 450);
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.root, { backgroundColor: t.paper.warm }]}>
        <StatusBar barStyle={dark ? "light-content" : "dark-content"} />
        <View style={s.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <CloseIcon size={22} color={t.ink.mid} />
          </TouchableOpacity>
        </View>

        <View style={s.top}>
          <Text style={[s.title, { color: t.ink.deep }]}>Parent PIN</Text>
          <Text style={[s.sub, { color: t.ink.mid }]}>Enter it to choose which apps are blocked.</Text>

          <Animated.View style={[s.dots, { transform: [{ translateX: shake }] }]}>
            {Array.from({ length: Math.max(MIN, pin.length) }, (_, i) => (
              <View
                key={i}
                style={[s.dot, {
                  borderColor: t.ink.mid,
                  backgroundColor: i < pin.length ? t.ink.deep : "transparent",
                }]}
              />
            ))}
          </Animated.View>
          <View style={{ height: 22, justifyContent: "center" }}>
            {busy ? <ActivityIndicator color={t.earn.sage} />
              : err ? <Text style={s.err}>{err}</Text> : null}
          </View>
        </View>

        <View style={s.pad}>
          {KEYS.map((k) => {
            const isOk = k === "ok";
            const okReady = isOk && pin.length >= MIN && !busy;
            return (
              <TouchableOpacity
                key={k}
                onPress={() => press(k)}
                disabled={(isOk && !okReady) || (k === "del" && !pin)}
                activeOpacity={0.6}
                style={[s.key, {
                  backgroundColor: isOk ? (okReady ? t.earn.deep : "transparent")
                    : k === "del" ? "transparent" : t.paper.card,
                  borderColor: k === "del" || isOk ? "transparent" : t.ink.border,
                }]}
                accessibilityLabel={k === "del" ? "Delete" : isOk ? "Confirm" : k}
              >
                {k === "del" ? (
                  <Text style={[s.keyAlt, { color: pin ? t.ink.mid : t.ink.faint }]}>⌫</Text>
                ) : isOk ? (
                  <CheckIcon size={24} color={okReady ? (dark ? t.ink.void : "#FAF6EE") : t.ink.faint} />
                ) : (
                  <Text style={[s.keyText, { color: t.ink.deep }]}>{k}</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingTop: Platform.OS === "ios" ? 18 : 36 },
  header: { paddingHorizontal: 20, alignItems: "flex-end" },
  top: { alignItems: "center", paddingHorizontal: 28, marginTop: 24 },
  title: { fontFamily: FF.display, fontSize: 30, letterSpacing: -0.3 },
  sub: { fontFamily: FF.body, fontSize: 14, marginTop: 6, textAlign: "center" },
  dots: { flexDirection: "row", gap: 16, marginTop: 34, marginBottom: 12 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5 },
  err: { color: "#B5564B", fontFamily: FF.bodyMed, fontSize: 13 },
  pad: {
    flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between",
    rowGap: 16, paddingHorizontal: 44, marginTop: "auto", marginBottom: 56,
  },
  key: {
    width: 76, height: 76, borderRadius: 38, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  keyText: { fontFamily: FF.display, fontSize: 30 },
  keyAlt: { fontSize: 26 },
});
