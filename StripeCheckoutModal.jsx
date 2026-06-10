import React, { useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, Modal, Platform, StatusBar, StyleSheet,
  Text, TouchableOpacity, View,
} from "react-native";
import { WebView } from "react-native-webview";
import { CloseIcon } from "./Icons";

const allowedCheckoutHosts = new Set([
  "checkout.stripe.com",
  "hooks.stripe.com",
  "js.stripe.com",
  "m.stripe.network",
  "q.stripe.com",
]);

function isAllowedUrl(rawUrl) {
  const normalized = String(rawUrl || "").trim().toLowerCase();
  if (normalized.startsWith("drift://checkout/")) return true;
  if (!normalized.startsWith("https://")) return false;
  const host = normalized.replace(/^https:\/\//, "").split(/[/?#]/)[0];
  if (host.endsWith(".stripe.com")) return true;
  if (host.endsWith(".stripe.network")) return true;
  return allowedCheckoutHosts.has(host);
}

function getSessionId(rawUrl) {
  const match = String(rawUrl || "").match(/[?&]session_id=([^&#]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

export default function StripeCheckoutModal({
  visible,
  checkoutUrl,
  onClose,
  onSuccess,
  onCancel,
}) {
  const [loading, setLoading] = useState(true);
  const source = useMemo(() => checkoutUrl ? { uri: checkoutUrl } : null, [checkoutUrl]);

  const handleRequest = (request) => {
    const url = request?.url || "";
    if (url.startsWith("drift://checkout/success") || url.startsWith("https://drift.app/success") || url.startsWith("https://www.drift.app/success")) {
      onSuccess?.(getSessionId(url));
      return false;
    }
    if (url.startsWith("drift://checkout/cancel") || url.startsWith("https://drift.app/cancel") || url.startsWith("https://www.drift.app/cancel")) {
      onCancel?.();
      return false;
    }
    const allowed = isAllowedUrl(url);
    if (!allowed) {
      Alert.alert("Blocked navigation", "Checkout can only open secure Stripe pages.");
    }
    return allowed;
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={s.root}>
        <View style={s.header}>
          <View>
            <Text style={s.kicker}>SECURE CHECKOUT</Text>
            <Text style={s.title}>Drift Pro</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }} style={s.close}>
            <CloseIcon size={18} color="#E8F5EC" />
          </TouchableOpacity>
        </View>

        <View style={s.frame}>
          {source && (
            <WebView
              source={source}
              onShouldStartLoadWithRequest={handleRequest}
              onLoadStart={() => setLoading(true)}
              onLoadEnd={() => setLoading(false)}
              javaScriptEnabled
              domStorageEnabled
              thirdPartyCookiesEnabled={false}
              sharedCookiesEnabled={false}
              incognito
              setSupportMultipleWindows={false}
              javaScriptCanOpenWindowsAutomatically={false}
              mixedContentMode="never"
              pullToRefreshEnabled={false}
              allowsBackForwardNavigationGestures={false}
              originWhitelist={["https://*", "drift://*"]}
              style={s.webview}
            />
          )}
          {loading && (
            <View pointerEvents="none" style={s.loading}>
              <ActivityIndicator color="#2FAB72" />
              <Text style={s.loadingText}>Opening secure Stripe checkout</Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0B1A11",
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) : 44,
  },
  header: {
    height: 64, paddingHorizontal: 18, flexDirection: "row",
    alignItems: "center", justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.12)",
  },
  kicker: { fontSize: 9, color: "#4A8060", letterSpacing: 2, fontWeight: "700" },
  title: { fontSize: 18, color: "#E8F5EC", fontWeight: "700", marginTop: 2 },
  close: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  frame: { flex: 1, backgroundColor: "#FFFFFF" },
  webview: { flex: 1, backgroundColor: "#FFFFFF" },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  loadingText: { marginTop: 10, color: "#4A8060", fontSize: 12 },
});
