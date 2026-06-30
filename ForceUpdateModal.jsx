/**
 * ForceUpdateModal.jsx
 * Blocking "update required" screen shown when the installed app version is
 * older than the minimum set remotely (app_config.min_ios_version). There is no
 * dismiss — the only action is to open the App Store.
 */
import React from "react";
import { View, Text, TouchableOpacity, Modal, Linking } from "react-native";
import { getTheme, FF } from "./theme";
import Sprout from "./SproutArt";

export default function ForceUpdateModal({ visible, storeUrl, dark = false }) {
  const { ink, paper, earn } = getTheme(dark);
  const open = () => {
    Linking.openURL(storeUrl || "https://apps.apple.com").catch(() => {});
  };

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={() => {}}>
      <View style={{ flex: 1, backgroundColor: paper.warm, alignItems: "center", justifyContent: "center", padding: 32 }}>
        <View style={{ marginBottom: 24 }}>
          <Sprout size={120} tone={dark ? "night" : "fresh"} />
        </View>
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
          style={{ backgroundColor: earn.deep, paddingVertical: 16, paddingHorizontal: 48, borderRadius: 16 }}
        >
          <Text style={{ fontFamily: FF.bodyMed, fontSize: 15, color: dark ? "#16261C" : "#FAF6EE" }}>
            Update now
          </Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}
