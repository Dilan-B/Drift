/**
 * ShareCard.jsx
 * Shareable stats card displayed as a styled modal.
 * User can screenshot it (Instagram Stories style) or tap Share
 * to send a text message with their stats.
 */
import React, { useCallback } from "react";
import {
  View, Text, StyleSheet, Share, Platform, TouchableOpacity,
} from "react-native";
import { track } from "./analytics";

const CARD_W = 320;

export default function ShareCard({
  username = "",
  streak = 0,
  tasksCompleted = 0,
  minutesEarned = 0,
  theme,
  onClose,
}) {
  const th = theme || {};
  const bg = th.bg || "#111c16";
  const fg = th.text || "#EEF3EC";
  const accent = th.sage || "#3E6B4E";

  const handleShare = useCallback(async () => {
    track("referral_shared", { method: "share_card" });
    const msg = [
      `🌿 My Drift stats:`,
      `${streak}-day streak · ${tasksCompleted} tasks completed · ${minutesEarned} min earned`,
      ``,
      `I earn my screen time instead of doom-scrolling.`,
      `Try it free: driftproductivity.com`,
    ].join("\n");
    try {
      await Share.share({ message: msg });
    } catch {}
  }, [streak, tasksCompleted, minutesEarned]);

  return (
    <View style={styles.wrapper}>
      <View style={[styles.card, { backgroundColor: bg }]}>
        <View style={styles.inner}>
          <Text style={[styles.brand, { color: accent }]}>DRIFT</Text>

          <View style={styles.statRow}>
            <View style={styles.stat}>
              <Text style={[styles.statNum, { color: fg }]}>{streak}</Text>
              <Text style={[styles.statLabel, { color: accent }]}>day streak</Text>
            </View>
            <View style={[styles.divider, { backgroundColor: accent + "33" }]} />
            <View style={styles.stat}>
              <Text style={[styles.statNum, { color: fg }]}>{tasksCompleted}</Text>
              <Text style={[styles.statLabel, { color: accent }]}>tasks done</Text>
            </View>
            <View style={[styles.divider, { backgroundColor: accent + "33" }]} />
            <View style={styles.stat}>
              <Text style={[styles.statNum, { color: fg }]}>{minutesEarned}</Text>
              <Text style={[styles.statLabel, { color: accent }]}>min earned</Text>
            </View>
          </View>

          {username ? (
            <Text style={[styles.user, { color: fg + "99" }]}>@{username}</Text>
          ) : null}

          <View style={[styles.footer, { borderTopColor: accent + "22" }]}>
            <Text style={[styles.tagline, { color: accent }]}>
              Earn your screen time
            </Text>
            <Text style={[styles.url, { color: fg + "66" }]}>
              driftproductivity.com
            </Text>
          </View>
        </View>
      </View>

      <Text style={[styles.hint, { color: fg + "55" }]}>
        Screenshot this card to share on Stories
      </Text>

      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: accent }]}
          onPress={handleShare}
          activeOpacity={0.8}
        >
          <Text style={styles.btnText}>Share Stats</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.btnSecondary]}
          onPress={onClose}
          activeOpacity={0.7}
        >
          <Text style={[styles.btnSecText, { color: fg + "88" }]}>Close</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  card: {
    width: CARD_W, aspectRatio: 9 / 16, borderRadius: 24, overflow: "hidden",
  },
  inner: {
    flex: 1, padding: 28, justifyContent: "center", alignItems: "center",
  },
  brand: {
    fontSize: 15, fontWeight: "700", letterSpacing: 4, marginBottom: 40,
  },
  statRow: {
    flexDirection: "row", alignItems: "center", marginBottom: 28,
  },
  stat: { alignItems: "center", flex: 1 },
  statNum: { fontSize: 36, fontWeight: "700", letterSpacing: -1 },
  statLabel: { fontSize: 12, fontWeight: "600", marginTop: 4, letterSpacing: 0.4 },
  divider: { width: 1, height: 40 },
  user: { fontSize: 14, fontWeight: "500", marginBottom: 28 },
  footer: {
    position: "absolute", bottom: 28, left: 28, right: 28,
    borderTopWidth: 1, paddingTop: 14, alignItems: "center",
  },
  tagline: { fontSize: 13, fontWeight: "600", letterSpacing: 0.3 },
  url: { fontSize: 11, marginTop: 4 },
  hint: { fontSize: 13, marginTop: 16, marginBottom: 8 },
  buttons: { marginTop: 8, alignItems: "center", width: "100%" },
  btn: {
    paddingVertical: 14, paddingHorizontal: 40, borderRadius: 14,
    alignItems: "center", justifyContent: "center", marginBottom: 10, width: CARD_W,
  },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  btnSecondary: { backgroundColor: "transparent" },
  btnSecText: { fontSize: 15, fontWeight: "500" },
});
