/**
 * BlockedAppsModal.jsx
 * Modal for picking apps to block during focus / locked tasks.
 * Used during onboarding ("first time") and from the account sheet (anytime).
 *
 * iOS only — selection happens entirely through Apple's secure
 * FamilyActivityPicker. Drift never sees which apps the user picked; iOS
 * stores the opaque tokens for us. No more in-app chip list.
 */
import React from "react";
import {
  View, Text, TouchableOpacity, Modal,
  ScrollView, Alert, Platform,
} from "react-native";
import {
  isNativeBlockingAvailable, requestScreenTimeAuth,
  getScreenTimeAuthStatus, pickBlockedAppsNative,
} from "./blockedApps";
import { getTheme } from "./theme";

const FO  = "Orbitron_700Bold";
const FOM = "Orbitron_400Regular";
const FK  = "Oswald_700Bold";
const FB  = undefined;

export default function BlockedAppsModal({ visible, onClose, dark = false, firstTime = false }) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;

  const openPicker = async () => {
    if (!isNativeBlockingAvailable()) {
      Alert.alert("Not available",
        Platform.OS === "ios"
          ? "Apple Screen Time blocking requires a custom build of Drift. Update Drift and try again."
          : "App blocking via Apple Screen Time is iOS-only.");
      return;
    }
    const status = await getScreenTimeAuthStatus();
    if (status !== "approved") {
      const next = await requestScreenTimeAuth();
      if (next !== "approved") {
        Alert.alert("Screen Time access denied",
          "Enable Drift in Settings > Screen Time to pick apps to block.");
        return;
      }
    }
    await pickBlockedAppsNative();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: paper.warm }}>
        {/* Header */}
        <View style={{
          paddingTop: Platform.OS === "ios" ? 54 : 32,
          paddingBottom: 14, paddingHorizontal: 20,
          backgroundColor: paper.card,
          borderBottomWidth: 0.5, borderBottomColor: ink.border,
          flexDirection: "row", alignItems: "center",
        }}>
          {!firstTime && (
            <TouchableOpacity onPress={onClose} style={{ marginRight: 12 }}>
              <Text style={{ fontSize: 22, color: ink.mid, lineHeight: 26 }}>×</Text>
            </TouchableOpacity>
          )}
          <Text style={{ fontFamily: FK, fontSize: 17, color: ink.deep, flex: 1 }}>
            {firstTime ? "Pick apps to block" : "Blocked apps"}
          </Text>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {/* Explainer */}
          <View style={{
            backgroundColor: earn.blueLo, padding: 14, borderRadius: 12, marginBottom: 18,
            borderWidth: 1, borderColor: "rgba(90,180,212,0.2)",
          }}>
            <Text style={{ fontFamily: FOM, fontSize: 9, color: "#2A7FA0", letterSpacing: 1.5, marginBottom: 6 }}>
              HOW THIS WORKS
            </Text>
            <Text style={{ fontFamily: FB, fontSize: 12, color: "#2A7FA0", lineHeight: 18 }}>
              Pick the apps you want Drift to block when your screen-time balance hits zero.
              Selection happens in Apple's secure picker — Drift itself never sees your app list.
              iOS enforces the block even if Drift is closed.
            </Text>
          </View>

          {/* Native picker (iOS Screen Time) — the ONLY way to choose */}
          <TouchableOpacity
            onPress={openPicker}
            style={{
              paddingVertical: 18, paddingHorizontal: 16, borderRadius: 14, marginBottom: 12,
              borderWidth: 1.5, borderColor: earn.green, backgroundColor: earn.greenLo,
              alignItems: "center",
            }}
          >
            <Text style={{ fontFamily: FK, fontSize: 16, color: earn.green }}>
              Pick apps with Apple Screen Time
            </Text>
            <Text style={{ fontFamily: FB, fontSize: 12, color: ink.mid, marginTop: 4, textAlign: "center" }}>
              Opens Apple's secure picker. You can pick individual apps,
              whole categories (Social, Games), or web domains.
            </Text>
          </TouchableOpacity>

          <Text style={{ fontFamily: FB, fontSize: 11, color: ink.faint, textAlign: "center", marginBottom: 24, lineHeight: 16 }}>
            Tap the button above any time to change what's blocked.{"\n"}
            Your selection is stored on your device only.
          </Text>

          {/* Done / Skip — first-time onboarding only */}
          {firstTime && (
            <>
              <TouchableOpacity
                onPress={onClose}
                activeOpacity={0.8}
                style={{
                  paddingVertical: 14, borderRadius: 14,
                  backgroundColor: earn.green, alignItems: "center",
                }}
              >
                <Text style={{ fontFamily: FO, fontSize: 12, color: "#fff", letterSpacing: 2 }}>
                  DONE
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onClose}
                style={{ paddingVertical: 14, alignItems: "center", marginTop: 6 }}
              >
                <Text style={{ fontFamily: FB, fontSize: 13, color: ink.mid }}>Skip for now</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
