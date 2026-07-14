/**
 * ChildAppsModal.jsx
 * Child-side app access. Two paths (as requested):
 *   1. Ask a parent to allow a specific app → creates an app_request the parent
 *      approves; on approval the app is added to the allow-list.
 *   2. "Manage blocked apps" — gated by the parent PIN. On the right PIN it
 *      flips this device to CUSTOM mode and opens Apple's native app picker so a
 *      parent (present on the child's phone) can choose exactly which apps to
 *      block. Back-to-auto is likewise PIN-gated.
 */
import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView,
  Platform, StatusBar, TextInput, ActivityIndicator,
} from "react-native";
import { getTheme, FF } from "./theme";
import { supabase } from "./supabase";
import { presentAppPicker, isAvailable as screenTimeAvailable } from "./screenTime";
import { createAppRequest, fetchMyAppRequests, verifyFamilyPin } from "./family";

export default function ChildAppsModal({ visible, onClose, dark, familyId, childId, mode }) {
  const t = getTheme(dark);
  const onDeep = dark ? t.ink.void : "#FAF6EE";
  const [label, setLabel] = useState("");
  const [requests, setRequests] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [pinFor, setPinFor] = useState(null); // "custom" | "categories" | null
  const [pin, setPin] = useState("");

  const load = useCallback(async () => {
    if (childId) setRequests(await fetchMyAppRequests(childId));
  }, [childId]);

  useEffect(() => { if (visible) load(); }, [visible, load]);

  // Live: parent decisions on my requests.
  useEffect(() => {
    if (!visible || !childId) return;
    const ch = supabase
      .channel(`child_app_requests:${childId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "app_requests", filter: `child_id=eq.${childId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [visible, childId, load]);

  async function submitRequest() {
    setErr(""); setMsg("");
    if (!label.trim()) { setErr("Type the app you want to use."); return; }
    setBusy(true);
    const res = await createAppRequest(familyId, childId, label.trim());
    setBusy(false);
    if (!res.ok) { setErr("Couldn't send the request. Try again."); return; }
    setLabel(""); setMsg("Sent! Ask your parent to approve it.");
    load();
  }

  async function submitPin() {
    setErr(""); setMsg("");
    if (pin.length < 4) { setErr("Enter the 4-digit parent PIN."); return; }
    setBusy(true);
    const res = await verifyFamilyPin(familyId, pin, pinFor);
    setBusy(false);
    if (!res.ok) {
      setErr(res.reason === "no_pin" ? "A parent needs to set a PIN first (in their app)." : "That PIN isn't right.");
      return;
    }
    const wantCustom = pinFor === "custom";
    setPinFor(null); setPin("");
    if (wantCustom && screenTimeAvailable()) {
      await presentAppPicker();
      setMsg("Apps updated. Only the apps a parent picked will be blocked.");
    } else if (wantCustom) {
      setMsg("Custom blocking is on. Open a dev/TestFlight build to pick specific apps.");
    } else {
      setMsg("Back to auto-blocking (categories).");
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={[s.root, { backgroundColor: t.paper.warm, paddingTop: Platform.OS === "ios" ? 60 : 36 }]}>
        <StatusBar barStyle={dark ? "light-content" : "dark-content"} />
        <View style={s.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={[s.close, { color: t.earn.sage }]}>Done</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          <Text style={[s.title, { color: t.ink.deep }]}>App access</Text>
          <Text style={[s.sub, { color: t.ink.mid }]}>
            {mode === "custom"
              ? "A parent picked which apps get blocked on this phone."
              : "When your time runs out, social & entertainment apps get blocked."}
          </Text>

          <Text style={[s.section, { color: t.ink.faint }]}>ASK TO ALLOW AN APP</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              style={[s.input, { borderColor: t.ink.border, color: t.ink.deep, backgroundColor: t.paper.card, flex: 1 }]}
              placeholder="e.g. Duolingo" placeholderTextColor={t.ink.faint}
              value={label} onChangeText={setLabel} maxLength={80} returnKeyType="send" onSubmitEditing={submitRequest}
            />
            <TouchableOpacity style={[s.sendBtn, { backgroundColor: t.earn.deep }]} onPress={submitRequest} disabled={busy}>
              {busy ? <ActivityIndicator color={onDeep} /> : <Text style={[s.sendText, { color: onDeep }]}>Ask</Text>}
            </TouchableOpacity>
          </View>
          {err ? <Text style={s.err}>{err}</Text> : null}
          {msg ? <Text style={[s.msg, { color: t.earn.sage }]}>{msg}</Text> : null}

          {requests.length > 0 && (
            <>
              <Text style={[s.section, { color: t.ink.faint }]}>YOUR REQUESTS</Text>
              {requests.map((r) => (
                <View key={r.id} style={[s.reqRow, { backgroundColor: t.paper.card, borderColor: t.ink.border }]}>
                  <Text style={[s.reqLabel, { color: t.ink.deep }]}>{r.app_label}</Text>
                  <Text style={[s.reqStatus, {
                    color: r.status === "approved" ? t.earn.sage : r.status === "denied" ? "#E05050" : t.ink.mid,
                  }]}>
                    {r.status === "approved" ? "Allowed" : r.status === "denied" ? "Not allowed" : "Waiting"}
                  </Text>
                </View>
              ))}
            </>
          )}

          <Text style={[s.section, { color: t.ink.faint }]}>PARENTS</Text>
          {pinFor ? (
            <View style={[s.pinCard, { backgroundColor: t.paper.card, borderColor: t.ink.border }]}>
              <Text style={[s.pinLabel, { color: t.ink.mid }]}>Enter the parent PIN</Text>
              <TextInput
                style={[s.input, { borderColor: t.ink.border, color: t.ink.deep, backgroundColor: t.paper.warm, textAlign: "center", letterSpacing: 8, fontSize: 22 }]}
                placeholder="••••" placeholderTextColor={t.ink.faint}
                value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, "").slice(0, 8))}
                keyboardType="number-pad" secureTextEntry maxLength={8} returnKeyType="done" onSubmitEditing={submitPin}
              />
              <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                <TouchableOpacity style={[s.pinBtn, { backgroundColor: t.paper.warm, flex: 1 }]} onPress={() => { setPinFor(null); setPin(""); setErr(""); }}>
                  <Text style={[s.pinBtnText, { color: t.ink.mid }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.pinBtn, { backgroundColor: t.earn.deep, flex: 1 }]} onPress={submitPin} disabled={busy}>
                  {busy ? <ActivityIndicator color={onDeep} /> : <Text style={[s.pinBtnText, { color: onDeep }]}>Confirm</Text>}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <>
              <TouchableOpacity style={[s.parentRow, { backgroundColor: t.paper.card, borderColor: t.ink.border }]} onPress={() => { setPinFor("custom"); setErr(""); setMsg(""); }}>
                <Text style={[s.parentText, { color: t.ink.deep }]}>Pick specific apps to block</Text>
                <Text style={[s.parentHint, { color: t.ink.faint }]}>Needs parent PIN</Text>
              </TouchableOpacity>
              {mode === "custom" && (
                <TouchableOpacity style={[s.parentRow, { backgroundColor: t.paper.card, borderColor: t.ink.border }]} onPress={() => { setPinFor("categories"); setErr(""); setMsg(""); }}>
                  <Text style={[s.parentText, { color: t.ink.deep }]}>Back to auto-blocking</Text>
                  <Text style={[s.parentHint, { color: t.ink.faint }]}>Needs parent PIN</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, alignItems: "flex-end", marginBottom: 6 },
  close: { fontFamily: FF.bodyMed, fontSize: 16 },
  title: { fontFamily: FF.display, fontSize: 28, letterSpacing: -0.3, marginBottom: 6 },
  sub: { fontFamily: FF.body, fontSize: 14, lineHeight: 21, marginBottom: 8 },
  section: { fontFamily: FF.kicker, fontSize: 11, letterSpacing: 2, marginTop: 22, marginBottom: 10 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: FF.body, fontSize: 16 },
  sendBtn: { borderRadius: 12, paddingHorizontal: 18, alignItems: "center", justifyContent: "center", minWidth: 64 },
  sendText: { fontFamily: FF.bodyMed, fontSize: 15 },
  err: { color: "#E05050", fontFamily: FF.bodyMed, fontSize: 13, marginTop: 8 },
  msg: { fontFamily: FF.bodyMed, fontSize: 13, marginTop: 8 },
  reqRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 15, marginBottom: 8 },
  reqLabel: { fontFamily: FF.bodyMed, fontSize: 15 },
  reqStatus: { fontFamily: FF.bodyMed, fontSize: 13 },
  parentRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderRadius: 14, paddingVertical: 15, paddingHorizontal: 16, marginBottom: 10 },
  parentText: { fontFamily: FF.bodyMed, fontSize: 15 },
  parentHint: { fontFamily: FF.body, fontSize: 12 },
  pinCard: { borderWidth: 1, borderRadius: 16, padding: 16 },
  pinLabel: { fontFamily: FF.bodyMed, fontSize: 14, marginBottom: 10, textAlign: "center" },
  pinBtn: { borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  pinBtnText: { fontFamily: FF.bodyMed, fontSize: 15 },
});
