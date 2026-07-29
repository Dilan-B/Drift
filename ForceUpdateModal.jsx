/**
 * ForceUpdateModal.jsx
 * Blocking "update required" screen shown when the installed app version is
 * older than the minimum set remotely (app_config.min_ios_version). The only
 * normal action is to open the App Store.
 *
 * DEV ESCAPE HATCH
 * A version mismatch between app.json and the native build once locked the
 * whole team out of TestFlight with no way back in (the gate returns before
 * every other screen, so there is nothing else to tap). The override below is
 * the recovery path for that.
 *
 * It is deliberately NOT a visible button in release builds — an obvious
 * "skip" would make the mandatory-update gate meaningless, which matters if we
 * ever need to force a security fix. Instead it takes TAPS_TO_UNLOCK taps on
 * the sprout: trivial once you know, undiscoverable by accident. In __DEV__ it
 * just shows, since there is nothing to protect there.
 */
import React, { useRef, useState } from "react";
import { View, Text, TouchableOpacity, Modal, Linking } from "react-native";
import { getTheme, FF } from "./theme";
import Sprout from "./SproutArt";

const TAPS_TO_UNLOCK = 7;
const TAP_TIMEOUT_MS = 2500; // taps must be deliberate, not spread over minutes

export default function ForceUpdateModal({ visible, storeUrl, dark = false, onOverride }) {
  const { ink, paper, earn, fx } = getTheme(dark);
  const [revealed, setRevealed] = useState(!!__DEV__);
  const taps = useRef(0);
  const lastTap = useRef(0);

  const open = () => {
    Linking.openURL(storeUrl || "https://apps.apple.com").catch(() => {});
  };

  const onSproutTap = () => {
    if (revealed || !onOverride) return;
    const now = Date.now();
    taps.current = now - lastTap.current > TAP_TIMEOUT_MS ? 1 : taps.current + 1;
    lastTap.current = now;
    if (taps.current >= TAPS_TO_UNLOCK) setRevealed(true);
  };

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={() => {}}>
      <View style={{ flex: 1, backgroundColor: paper.warm, alignItems: "center", justifyContent: "center", padding: 32 }}>
        {/* Tap target for the dev override — see the note at the top. */}
        <TouchableOpacity activeOpacity={1} onPress={onSproutTap} style={{ marginBottom: 24 }}>
          <Sprout size={120} tone={dark ? "night" : "fresh"} />
        </TouchableOpacity>
        <Text style={{ fontFamily: FF.kicker, fontSize: 11, color: earn.sage, letterSpacing: 2.6, marginBottom: 12 }}>
          UPDATE REQUIRED
        </Text>
        <Text style={{ fontFamily: FF.display, fontSize: 32, color: ink.deep, textAlign: "center", marginBottom: 14 }}>
          Time to update Drift
        </Text>
        <Text style={{ fontFamily: FF.body, fontSize: 15, color: ink.mid, textAlign: "center", lineHeight: 22, maxWidth: 320, marginBottom: 36 }}>
          This version of Drift is out of date. Update to the latest version to keep earning your screen time.
        </Text>
        <TouchableOpacity
          onPress={open}
          activeOpacity={0.85}
          style={{ backgroundColor: earn.deep, paddingVertical: 16, paddingHorizontal: 48, borderRadius: 16, ...fx.glow }}
        >
          <Text style={{ fontFamily: FF.bodyMed, fontSize: 15, color: dark ? "#16261C" : "#FAF6EE" }}>
            Update now
          </Text>
        </TouchableOpacity>

        {revealed && !!onOverride && (
          <TouchableOpacity
            onPress={onOverride}
            activeOpacity={0.7}
            style={{ marginTop: 28, paddingVertical: 10, paddingHorizontal: 18 }}
          >
            <Text style={{ fontFamily: FF.body, fontSize: 12.5, color: ink.faint, textDecorationLine: "underline" }}>
              Continue without updating (dev)
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </Modal>
  );
}
