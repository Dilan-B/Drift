import React, { useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, Modal, Platform, StatusBar, StyleSheet,
  Text, TouchableOpacity, View,
} from "react-native";
import { WebView } from "react-native-webview";
import { CloseIcon } from "./Icons";
import { FF } from "./theme";

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
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }} style={s.close}>
            <CloseIcon size={17} color="#1A2B1F" />
          </TouchableOpacity>
          <View style={s.headerCopy}>
            <Text style={s.kicker}>CHECKOUT</Text>
            <Text style={s.title}>Drift Pro</Text>
          </View>
          <View style={s.securePill}>
            <View style={s.secureDot} />
            <Text style={s.secureText}>Stripe</Text>
          </View>
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
              <Text style={s.loadingText}>Opening checkout</Text>
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
    backgroundColor: "#F4F9F6",
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 8 : 54,
  },
  header: {
    minHeight: 62,
    paddingHorizontal: 18,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  kicker: {
    fontFamily: FF.kicker,
    fontSize: 9,
    color: "#A8BFB5",
    letterSpacing: 2.1,
    marginBottom: 2,
  },
  title: {
    fontFamily: FF.display,
    fontSize: 26,
    color: "#1A2B1F",
    letterSpacing: -0.2,
  },
  close: {
    width: 42, height: 42, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(26,43,31,0.09)",
  },
  securePill: {
    height: 34,
    paddingHorizontal: 11,
    borderRadius: 17,
    backgroundColor: "#E4F5EE",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  secureDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#2FAB72",
  },
  secureText: {
    fontFamily: FF.bodyMed,
    fontSize: 12,
    color: "#1A8050",
  },
  frame: {
    flex: 1,
    marginHorizontal: 12,
    marginBottom: Platform.OS === "ios" ? 12 : 10,
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(26,43,31,0.09)",
  },
  webview: { flex: 1, backgroundColor: "#FFFFFF" },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  loadingText: {
    marginTop: 10,
    color: "#6B8A78",
    fontFamily: FF.bodyMed,
    fontSize: 13,
  },
});
