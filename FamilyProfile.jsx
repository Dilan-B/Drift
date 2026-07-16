/**
 * FamilyProfile.jsx
 * Shared profile sheet for PARENT and CHILD accounts. Holds the things that used
 * to be scattered / missing: a light–dark appearance toggle, sign out, and
 * delete account. Opened from a header button in each shell.
 */
import React from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, Alert, ScrollView, Platform, StatusBar,
} from "react-native";
import { getTheme, FF } from "./theme";

export default function FamilyProfileModal({
  visible, onClose, dark, onToggleTheme, name, subtitle, onSignOut, onDeleteAccount,
}) {
  const t = getTheme(dark);
  // Text sitting on an earn.deep button: light on the dark-green (light theme),
  // dark on the light-green (dark theme) — so it's always legible.
  const onDeep = dark ? t.ink.void : "#FAF6EE";

  function confirmDelete() {
    Alert.alert(
      "Delete account?",
      "This permanently removes your Drift account. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => { onClose?.(); onDeleteAccount?.(); } },
      ],
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={[st.root, { backgroundColor: t.paper.warm, paddingTop: Platform.OS === "ios" ? 60 : 36 }]}>
        <StatusBar barStyle={dark ? "light-content" : "dark-content"} />
        <View style={st.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={[st.close, { color: t.earn.sage }]}>Done</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          <View style={{ alignItems: "center", marginBottom: 18 }}>
            <View style={[st.avatar, { backgroundColor: t.earn.sageLo }]}>
              <Text style={[st.avatarText, { color: t.earn.sage }]}>{(name || "?").slice(0, 1).toUpperCase()}</Text>
            </View>
            <Text style={[st.name, { color: t.ink.deep }]}>{name || "Your account"}</Text>
            {subtitle ? <Text style={[st.sub, { color: t.ink.mid }]}>{subtitle}</Text> : null}
          </View>

          <Text style={[st.section, { color: t.ink.faint }]}>APPEARANCE</Text>
          <View style={[st.segment, { borderColor: t.ink.border, backgroundColor: t.paper.card }]}>
            {["Light", "Dark"].map((label, i) => {
              const active = (i === 1) === !!dark;
              return (
                <TouchableOpacity
                  key={label}
                  style={[st.segBtn, active && { backgroundColor: t.earn.deep }]}
                  onPress={() => { if (!active) onToggleTheme?.(); }}
                >
                  <Text style={[st.segText, { color: active ? onDeep : t.ink.mid }]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[st.section, { color: t.ink.faint }]}>ACCOUNT</Text>
          <TouchableOpacity style={[st.row, { borderColor: t.ink.border, backgroundColor: t.paper.card }]} onPress={() => { onClose?.(); onSignOut?.(); }}>
            <Text style={[st.rowText, { color: t.ink.deep }]}>Sign out</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[st.row, { borderColor: t.ink.border, backgroundColor: t.paper.card }]} onPress={confirmDelete}>
            <Text style={[st.rowText, { color: "#B5564B" }]}>Delete account</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, alignItems: "flex-end", marginBottom: 8 },
  close: { fontFamily: FF.bodyMed, fontSize: 16 },
  avatar: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  avatarText: { fontFamily: FF.bodyBold, fontSize: 30 },
  name: { fontFamily: FF.display, fontSize: 26, letterSpacing: -0.3 },
  sub: { fontFamily: FF.body, fontSize: 14, marginTop: 4 },
  section: { fontFamily: FF.kicker, fontSize: 11, letterSpacing: 2, marginTop: 24, marginBottom: 10 },
  segment: { flexDirection: "row", borderWidth: 1, borderRadius: 14, padding: 4 },
  segBtn: { flex: 1, paddingVertical: 12, borderRadius: 11, alignItems: "center" },
  segText: { fontFamily: FF.bodyMed, fontSize: 15 },
  row: { borderWidth: 1, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 18, marginBottom: 10 },
  rowText: { fontFamily: FF.bodyMed, fontSize: 16 },
});
