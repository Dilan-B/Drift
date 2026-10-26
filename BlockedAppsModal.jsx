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
  getScreenTimeAuthStatus, pickBlockedAppsNative, getBlockedSelectionCount,
} from "./blockedApps";
import { FF, getTheme } from "./theme";
import { FREE_BLOCK_LIMIT } from "./freeTier";

import { tr } from "./i18n";
// Remapped onto the organic-editorial system — see theme.js FF.
const FO  = FF.bodyBold;
const FOM = FF.kicker;
const FK  = FF.bodyMed;
const FB  = FF.body;

// Everyone picks their own apps. Free users are capped at FREE_BLOCK_LIMIT
// picks — the native picker enforces it (Done is disabled over the cap), this
// sheet only says so and offers Pro when someone ran into it.
export default function BlockedAppsModal({ visible, onClose, dark = false, firstTime = false, isPro = false, onUpgrade }) {
  const theme = getTheme(dark);
  const { ink, paper, earn } = theme;

  // How many apps/categories/domains are currently picked. Apple won't tell us
  // what they are, only how many — which is all the Done gate needs.
  const [selectionCount, setSelectionCount] = React.useState(0);

  // Can this build actually block anything? On Android, in Expo Go, or in any
  // build without FamilyControls, the picker can't open and the selection
  // count is permanently 0 — so REQUIRING a selection would trap the user in
  // onboarding with no way forward. Gate only where the gate is satisfiable.
  const canBlock = isNativeBlockingAvailable();
  const gateOnSelection = firstTime && canBlock;
  const canFinish = !gateOnSelection || selectionCount > 0;

  const refreshSelection = React.useCallback(async () => {
    setSelectionCount(await getBlockedSelectionCount());
  }, []);

  // Re-read on open, and again whenever we come back from Apple's picker —
  // the picker is a separate system sheet, so nothing re-renders on its own.
  React.useEffect(() => { if (visible) refreshSelection(); }, [visible, refreshSelection]);

  const ensureAccess = async () => {
    if (!isNativeBlockingAvailable()) {
      Alert.alert(tr("Not available"),
        Platform.OS === "ios" ? tr("Apple Screen Time blocking requires a custom build of Drift. Update Drift and try again.") : tr("App blocking via Apple Screen Time is iOS-only."));
      return false;
    }
    const status = await getScreenTimeAuthStatus();
    if (status !== "approved") {
      const next = await requestScreenTimeAuth();
      if (next !== "approved") {
        Alert.alert(tr("Screen Time access denied"),
          tr("Enable Drift in Settings > Screen Time so Drift can block apps."));
        return false;
      }
    }
    return true;
  };

  const openPicker = async () => {
    if (!(await ensureAccess())) return;
    const res = await pickBlockedAppsNative();
    await refreshSelection();
    // Not during first-run: that sheet is the onboarding gate, and stacking
    // the paywall on it mid-setup is exactly the onboarding upsell the free
    // tier exists to remove. The cap line below still says what happened.
    if (res?.hitLimit && !isPro && !firstTime && onUpgrade) {
      Alert.alert(
        tr("Free plan blocks up to {{FREE_BLOCK_LIMIT}}", { FREE_BLOCK_LIMIT }),
        tr("Drift Pro blocks as many apps, categories and websites as you like."),
        [{ text: tr("Not now"), style: "cancel" }, { text: tr("See Pro"), onPress: onUpgrade }],
      );
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      // During first-time onboarding a swipe-down must not escape the gate.
      // Swallowing the request leaves `visible` true, so iOS re-presents.
      onRequestClose={canFinish ? onClose : undefined}
    >
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
            {firstTime ? tr("Pick apps to block") : tr("Blocked apps")}
          </Text>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {/* Explainer */}
          <View style={{
            backgroundColor: earn.blueLo, padding: 14, borderRadius: 12, marginBottom: 18,
            borderWidth: 1, borderColor: "rgba(90,180,212,0.2)",
          }}>
            <Text style={{ fontFamily: FOM, fontSize: 9, color: "#2A7FA0", letterSpacing: 1.5, marginBottom: 6 }}>
              {tr("HOW THIS WORKS")}
            </Text>
            <Text style={{ fontFamily: FB, fontSize: 12, color: "#2A7FA0", lineHeight: 18 }}>
              {tr("Pick apps to block when your balance hits zero. iOS enforces it even when Drift is closed, and may kick in up to ~15 min late.")}
            </Text>
          </View>

          {/* Apple's picker, for everyone. Choosing what to block is the core
              promise of the app, not an upsell — the old free tier got a
              blunt block-every-category switch and a "Upgrade to Pro to choose
              specific apps" nag instead. */}
          <TouchableOpacity
            onPress={openPicker}
            style={{
              paddingVertical: 18, paddingHorizontal: 16, borderRadius: 14, marginBottom: 12,
              borderWidth: 1.5, borderColor: earn.green, backgroundColor: earn.greenLo,
              alignItems: "center",
            }}
          >
            <Text style={{ fontFamily: FK, fontSize: 16, color: earn.green }}>
              {selectionCount > 0 ? tr("Change blocked apps") : tr("Pick apps with Apple Screen Time")}
            </Text>
            <Text style={{ fontFamily: FB, fontSize: 12, color: ink.mid, marginTop: 4, textAlign: "center" }}>
              {isPro ? tr("Apps, categories, or web domains.") : tr("Up to {{FREE_BLOCK_LIMIT}} apps, categories, or web domains on the free plan.", { FREE_BLOCK_LIMIT })}
            </Text>
          </TouchableOpacity>

          {selectionCount > 0 && (
            <View style={{
              flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
              marginBottom: 12,
            }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: earn.green }} />
              <Text style={{ fontFamily: FB, fontSize: 12, color: ink.mid }}>
                {isPro ? `${selectionCount} ${selectionCount === 1 ? "selection" : "selections"} saved` : tr("{{selectionCount}} of {{FREE_BLOCK_LIMIT}} saved", { selectionCount, FREE_BLOCK_LIMIT })}
              </Text>
            </View>
          )}

          <Text style={{ fontFamily: FB, fontSize: 11, color: ink.faint, textAlign: "center", marginBottom: 24, lineHeight: 16 }}>
            {tr("Tap again anytime to change what's blocked. Stored on your device only.")}
          </Text>

          {/* Done — first-time onboarding only. Gated on an actual selection:
              finishing onboarding with nothing blocked leaves the shield inert
              and the app pointless, so there's no skip here. */}
          {firstTime && (
            <>
              <TouchableOpacity
                onPress={canFinish ? onClose : null}
                activeOpacity={canFinish ? 0.8 : 1}
                style={{
                  paddingVertical: 14, borderRadius: 14, alignItems: "center",
                  backgroundColor: canFinish ? earn.green : ink.ghost,
                  ...(canFinish ? theme.fx.glow : null),
                }}
              >
                <Text style={{
                  fontFamily: FO, fontSize: 12, letterSpacing: 2,
                  color: canFinish ? (dark ? "#16261C" : "#fff") : ink.faint,
                }}>
                  {canBlock ? tr("DONE") : tr("CONTINUE")}
                </Text>
              </TouchableOpacity>
              {!canFinish && (
                <Text style={{
                  fontFamily: FB, fontSize: 12, color: ink.mid,
                  textAlign: "center", marginTop: 10, lineHeight: 18,
                }}>
                  {tr("Pick at least one app or category to continue.")}
                </Text>
              )}
              {!canBlock && (
                <Text style={{
                  fontFamily: FB, fontSize: 12, color: ink.faint,
                  textAlign: "center", marginTop: 10, lineHeight: 18,
                }}>
                  {tr("App blocking needs a full build of Drift — you can set this up later.")}
                </Text>
              )}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
