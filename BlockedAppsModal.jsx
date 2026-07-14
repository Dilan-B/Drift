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

export default function BlockedAppsModal({ visible, onClose, dark = false, firstTime = false, isPro = false, onUpgrade }) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;

  const ensureAccess = async () => {
    if (!isNativeBlockingAvailable()) {
      Alert.alert("Not available",
        Platform.OS === "ios"
          ? "Apple Screen Time blocking requires a custom build of Drift. Update Drift and try again."
          : "App blocking via Apple Screen Time is iOS-only.");
      return false;
    }
    const status = await getScreenTimeAuthStatus();
    if (status !== "approved") {
      const next = await requestScreenTimeAuth();
      if (next !== "approved") {
        Alert.alert("Screen Time access denied",
          "Enable Drift in Settings > Screen Time so Drift can block apps.");
        return false;
      }
    }
    return true;
  };

  const openPicker = async () => {
    if (!(await ensureAccess())) return;
    await pickBlockedAppsNative();
  };

  // Free tier blocks social & entertainment by CATEGORY automatically — there's
  // no per-app selection, so we just make sure Screen Time access is granted.
  const enableFreeBlocking = async () => {
    if (!(await ensureAccess())) return;
    Alert.alert("You're set", "Drift will block social & entertainment apps when your earned time hits zero.");
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
              Pick apps to block when your balance hits zero. iOS enforces it even when Drift is
              closed, and may kick in up to ~15 min late.
            </Text>
          </View>

          {isPro ? (
            <>
              {/* Native picker (iOS Screen Time) — Pro only */}
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
                  Apps, categories, or web domains.
                </Text>
              </TouchableOpacity>

              <Text style={{ fontFamily: FB, fontSize: 11, color: ink.faint, textAlign: "center", marginBottom: 24, lineHeight: 16 }}>
                Tap again anytime to change what's blocked. Stored on your device only.
              </Text>
            </>
          ) : (
            <>
              {/* Free plan — no app picker (it would do nothing): blocking is by
                  category automatically. Just grant access + offer upgrade. */}
              <View style={{
                backgroundColor: paper.card, padding: 16, borderRadius: 14, marginBottom: 14,
                borderWidth: 1, borderColor: ink.border,
              }}>
                <Text style={{ fontFamily: FOM, fontSize: 9, color: ink.faint, letterSpacing: 1.5, marginBottom: 6 }}>
                  FREE PLAN
                </Text>
                <Text style={{ fontFamily: FB, fontSize: 13, color: ink.deep, lineHeight: 19 }}>
                  Social & entertainment apps are blocked automatically when your time runs out. Pick specific apps with Pro.
                </Text>
              </View>

              <TouchableOpacity
                onPress={enableFreeBlocking}
                style={{
                  paddingVertical: 18, paddingHorizontal: 16, borderRadius: 14, marginBottom: 12,
                  borderWidth: 1.5, borderColor: earn.green, backgroundColor: earn.greenLo,
                  alignItems: "center",
                }}
              >
                <Text style={{ fontFamily: FK, fontSize: 16, color: earn.green }}>
                  Enable Screen Time access
                </Text>
                <Text style={{ fontFamily: FB, fontSize: 12, color: ink.mid, marginTop: 4, textAlign: "center" }}>
                  Needed to block apps.
                </Text>
              </TouchableOpacity>

              {!!onUpgrade && (
                <TouchableOpacity
                  onPress={() => { onClose?.(); onUpgrade?.(); }}
                  style={{ paddingVertical: 14, alignItems: "center", marginBottom: 12 }}
                >
                  <Text style={{ fontFamily: FB, fontSize: 13, color: earn.green }}>
                    Upgrade to Pro to choose specific apps
                  </Text>
                </TouchableOpacity>
              )}
            </>
          )}

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
