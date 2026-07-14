/**
 * ParentShell.jsx
 * Management home for a PARENT account — calm, simple, family-first (not the
 * student productivity app). Parents share their family code, assign tasks to
 * their kids, approve completed tasks (which grants screen time), and manage
 * which apps stay allowed on each kid's phone.
 */
import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Share, Platform, StatusBar, ActivityIndicator, Modal, TextInput,
} from "react-native";
import { getTheme, FF } from "./theme";
import Sprout from "./SproutArt";
import { supabase } from "./supabase";
import { notifyChildSubmittedTask } from "./notifications";
import {
  fetchMyFamily, fetchFamilyChildren, fetchPendingApprovals, fetchChildrenBalances,
  assignChildTask, approveChildTask, rejectChildTask, setChildAppPolicy,
} from "./family";

// Curated apps a parent can choose to keep available even when time runs out.
// (Full arbitrary per-app selection needs the on-device picker; this covers the
// common "let them still text / call / navigate" cases.)
const ALLOWABLE_APPS = [
  { id: "messages", label: "Messages" },
  { id: "phone",    label: "Phone" },
  { id: "maps",     label: "Maps" },
  { id: "music",    label: "Music" },
  { id: "camera",   label: "Camera" },
  { id: "school",   label: "School apps" },
];

export default function ParentShell({ userId, dark = false, onSignOut }) {
  const t = getTheme(dark);
  const [family, setFamily] = useState(null);
  const [children, setChildren] = useState([]);
  const [balances, setBalances] = useState({});
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const [assignFor, setAssignFor] = useState(null); // child object
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState("20");
  const [assigning, setAssigning] = useState(false);
  const [assignErr, setAssignErr] = useState("");

  const [appsFor, setAppsFor] = useState(null); // child object

  const childIds = children.map((c) => c.user_id);
  const seenApprovalsRef = useRef(null); // ids seen on the previous reload

  const reloadApprovals = useCallback(async (ids) => {
    const list = await fetchPendingApprovals(ids);
    setApprovals(list);
    // Notify only for genuinely new submissions (skip the very first load).
    const prev = seenApprovalsRef.current;
    if (prev) {
      list.filter((a) => !prev.has(a.id)).forEach((a) => notifyChildSubmittedTask(a.title));
    }
    seenApprovalsRef.current = new Set(list.map((a) => a.id));
  }, []);
  const reloadBalances = useCallback(async (ids) => {
    setBalances(await fetchChildrenBalances(ids));
  }, []);

  const load = useCallback(async () => {
    if (!userId) return;
    const fam = await fetchMyFamily(userId);
    setFamily(fam);
    if (fam?.id) {
      const kids = await fetchFamilyChildren(fam.id);
      setChildren(kids);
      const ids = kids.map((c) => c.user_id);
      await Promise.all([reloadApprovals(ids), reloadBalances(ids)]);
    }
    setLoading(false);
  }, [userId, reloadApprovals, reloadBalances]);

  useEffect(() => { load(); }, [load]);

  // Live: any child task change → refresh the approval queue; any readable
  // profile change → refresh balances. RLS delivers only this parent's children.
  useEffect(() => {
    if (!userId || childIds.length === 0) return;
    const ch = supabase
      .channel(`parent:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" },
        () => { reloadApprovals(childIds); })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" },
        () => { reloadBalances(childIds); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, childIds.join(","), reloadApprovals, reloadBalances]);

  async function shareCode() {
    if (!family?.code) return;
    try {
      await Share.share({
        message: `Join our family on Drift — open the app, pick "I'm a kid", and enter this code: ${family.code}`,
      });
    } catch {}
  }

  const childName = (id) => children.find((c) => c.user_id === id)?.display_name || "Your kid";

  async function doApprove(taskId) {
    setBusyId(taskId);
    setApprovals((prev) => prev.filter((a) => a.id !== taskId)); // optimistic
    const res = await approveChildTask(taskId);
    if (!res.ok) await reloadApprovals(childIds);
    else await reloadBalances(childIds);
    setBusyId(null);
  }
  async function doReject(taskId) {
    setBusyId(taskId);
    setApprovals((prev) => prev.filter((a) => a.id !== taskId));
    const res = await rejectChildTask(taskId);
    if (!res.ok) await reloadApprovals(childIds);
    setBusyId(null);
  }

  async function submitAssign() {
    setAssignErr("");
    const m = Math.round(Number(minutes));
    if (!title.trim()) { setAssignErr("Give the task a name."); return; }
    if (!Number.isFinite(m) || m < 1 || m > 600) { setAssignErr("Enter minutes between 1 and 600."); return; }
    setAssigning(true);
    const res = await assignChildTask(assignFor.user_id, title.trim(), m);
    setAssigning(false);
    if (!res.ok) { setAssignErr("Couldn't assign the task. Try again."); return; }
    setAssignFor(null); setTitle(""); setMinutes("20");
  }

  async function toggleAllow(child, appId) {
    const current = child.app_policy?.allow || [];
    const next = current.includes(appId) ? current.filter((a) => a !== appId) : [...current, appId];
    // optimistic
    setChildren((prev) => prev.map((c) => c.user_id === child.user_id
      ? { ...c, app_policy: { ...(c.app_policy || {}), mode: "categories", allow: next } } : c));
    setAppsFor((prev) => prev ? { ...prev, app_policy: { ...(prev.app_policy || {}), allow: next } } : prev);
    await setChildAppPolicy(child.user_id, next);
  }

  const mins = (id) => Math.max(0, Math.ceil((balances[id] || 0) / 60));

  return (
    <View style={[s.root, { backgroundColor: t.paper.warm, paddingTop: Platform.OS === "ios" ? 64 : 40 }]}>
      <StatusBar barStyle={dark ? "light-content" : "dark-content"} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
        <View pointerEvents="none" style={{ position: "absolute", right: -50, top: -10, opacity: 0.1 }}>
          <Sprout size={180} tone="fresh" />
        </View>

        <Text style={[s.kicker, { color: t.earn.sage }]}>YOUR FAMILY</Text>
        <Text style={[s.title, { color: t.ink.deep }]}>Welcome home</Text>

        {/* Family code */}
        <View style={[s.card, { backgroundColor: t.paper.card, borderColor: t.ink.border }]}>
          <Text style={[s.cardLabel, { color: t.ink.faint }]}>FAMILY CODE</Text>
          {loading ? <ActivityIndicator color={t.earn.sage} style={{ marginVertical: 14 }} />
            : <Text style={[s.code, { color: t.ink.deep }]}>{family?.code || "—"}</Text>}
          <TouchableOpacity style={[s.shareBtn, { backgroundColor: t.earn.deep }]} onPress={shareCode} disabled={!family?.code}>
            <Text style={[s.shareBtnText]}>Share code</Text>
          </TouchableOpacity>
        </View>

        {/* Approvals */}
        {approvals.length > 0 && (
          <>
            <Text style={[s.sectionLabel, { color: t.ink.faint }]}>WAITING FOR YOUR OK</Text>
            {approvals.map((a) => (
              <View key={a.id} style={[s.approvalCard, { backgroundColor: t.paper.card, borderColor: t.earn.sage }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.childName, { color: t.ink.deep }]}>{childName(a.user_id)}</Text>
                  <Text style={[s.approvalTask, { color: t.ink.mid }]}>{a.title} · +{a.minutes} min</Text>
                </View>
                <TouchableOpacity style={[s.rejectBtn, { borderColor: t.ink.border }]} onPress={() => doReject(a.id)} disabled={busyId === a.id}>
                  <Text style={[s.rejectText, { color: t.ink.mid }]}>Not yet</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.approveBtn, { backgroundColor: t.earn.deep }]} onPress={() => doApprove(a.id)} disabled={busyId === a.id}>
                  {busyId === a.id ? <ActivityIndicator color="#FAF6EE" /> : <Text style={s.approveText}>Approve</Text>}
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}

        {/* Kids */}
        <Text style={[s.sectionLabel, { color: t.ink.faint }]}>YOUR KIDS</Text>
        {loading ? null : children.length === 0 ? (
          <View style={[s.emptyCard, { borderColor: t.paper.dash }]}>
            <Text style={[s.emptyText, { color: t.ink.mid }]}>
              No kids yet. Share your code above and they'll show up here once they join.
            </Text>
          </View>
        ) : (
          children.map((cc) => (
            <View key={cc.user_id} style={[s.childRow, { backgroundColor: t.paper.card, borderColor: t.ink.border }]}>
              <View style={[s.avatar, { backgroundColor: t.earn.sageLo }]}>
                <Text style={[s.avatarText, { color: t.earn.sage }]}>{(cc.display_name || "?").slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.childName, { color: t.ink.deep }]}>{cc.display_name || "Kid"}</Text>
                <Text style={[s.childSub, { color: t.ink.mid }]}>{mins(cc.user_id)} min left today</Text>
              </View>
              <TouchableOpacity style={[s.smallBtn, { backgroundColor: t.earn.sageLo }]} onPress={() => setAppsFor(cc)}>
                <Text style={[s.smallBtnText, { color: t.earn.greenD }]}>Apps</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.smallBtn, { backgroundColor: t.earn.deep, marginLeft: 8 }]} onPress={() => { setAssignFor(cc); setAssignErr(""); }}>
                <Text style={[s.smallBtnText, { color: "#FAF6EE" }]}>+ Task</Text>
              </TouchableOpacity>
            </View>
          ))
        )}

        <TouchableOpacity style={s.signOut} onPress={onSignOut}>
          <Text style={[s.signOutText, { color: t.ink.mid }]}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Assign task modal */}
      <Modal visible={!!assignFor} transparent animationType="fade" onRequestClose={() => setAssignFor(null)}>
        <View style={s.modalWrap}>
          <View style={[s.modalCard, { backgroundColor: t.paper.card }]}>
            <Text style={[s.modalTitle, { color: t.ink.deep }]}>New task for {assignFor?.display_name}</Text>
            <Text style={[s.inputLabel, { color: t.ink.faint }]}>TASK</Text>
            <TextInput
              style={[s.input, { borderColor: t.ink.border, color: t.ink.deep, backgroundColor: t.paper.warm }]}
              placeholder="Clean your room" placeholderTextColor={t.ink.faint}
              value={title} onChangeText={setTitle} maxLength={100} returnKeyType="next"
            />
            <Text style={[s.inputLabel, { color: t.ink.faint }]}>SCREEN TIME REWARD (MINUTES)</Text>
            <TextInput
              style={[s.input, { borderColor: t.ink.border, color: t.ink.deep, backgroundColor: t.paper.warm }]}
              placeholder="20" placeholderTextColor={t.ink.faint}
              value={minutes} onChangeText={(v) => setMinutes(v.replace(/[^0-9]/g, "").slice(0, 3))}
              keyboardType="number-pad" maxLength={3}
            />
            {assignErr ? <Text style={s.err}>{assignErr}</Text> : null}
            <View style={{ flexDirection: "row", marginTop: 16, gap: 10 }}>
              <TouchableOpacity style={[s.modalBtn, { backgroundColor: t.paper.warm, flex: 1 }]} onPress={() => setAssignFor(null)}>
                <Text style={[s.modalBtnText, { color: t.ink.mid }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modalBtn, { backgroundColor: t.earn.deep, flex: 1 }]} onPress={submitAssign} disabled={assigning}>
                {assigning ? <ActivityIndicator color="#FAF6EE" /> : <Text style={[s.modalBtnText, { color: "#FAF6EE" }]}>Assign</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* App policy modal */}
      <Modal visible={!!appsFor} transparent animationType="fade" onRequestClose={() => setAppsFor(null)}>
        <View style={s.modalWrap}>
          <View style={[s.modalCard, { backgroundColor: t.paper.card }]}>
            <Text style={[s.modalTitle, { color: t.ink.deep }]}>Always allow for {appsFor?.display_name}</Text>
            <Text style={[s.modalSub, { color: t.ink.mid }]}>
              These stay open even when {appsFor?.display_name} runs out of screen time.
            </Text>
            {ALLOWABLE_APPS.map((app) => {
              const on = (appsFor?.app_policy?.allow || []).includes(app.id);
              return (
                <TouchableOpacity key={app.id} style={[s.allowRow, { borderColor: t.ink.hairline }]} onPress={() => toggleAllow(appsFor, app.id)}>
                  <Text style={[s.allowLabel, { color: t.ink.deep }]}>{app.label}</Text>
                  <View style={[s.toggle, { backgroundColor: on ? t.earn.deep : t.ink.ghost }]}>
                    <Text style={{ color: on ? "#FAF6EE" : t.ink.faint, fontFamily: FF.bodyMed, fontSize: 12 }}>
                      {on ? "Allowed" : "Blocked"}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={[s.modalBtn, { backgroundColor: t.earn.deep, marginTop: 16 }]} onPress={() => setAppsFor(null)}>
              <Text style={[s.modalBtnText, { color: "#FAF6EE" }]}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  kicker: { fontFamily: FF.kicker, fontSize: 12, letterSpacing: 2.5, marginBottom: 8 },
  title: { fontFamily: FF.display, fontSize: 34, letterSpacing: -0.3, marginBottom: 20 },
  card: { borderRadius: 20, borderWidth: 1, padding: 22, alignItems: "center", marginBottom: 26 },
  cardLabel: { fontFamily: FF.kicker, fontSize: 11, letterSpacing: 2, marginBottom: 12 },
  code: { fontFamily: FF.mark, fontSize: 40, letterSpacing: 8, marginBottom: 18 },
  shareBtn: { borderRadius: 14, paddingVertical: 14, paddingHorizontal: 40 },
  shareBtnText: { fontFamily: FF.bodyMed, fontSize: 15, color: "#FAF6EE" },
  sectionLabel: { fontFamily: FF.kicker, fontSize: 11, letterSpacing: 2, marginBottom: 12, marginTop: 6 },
  approvalCard: { flexDirection: "row", alignItems: "center", borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10 },
  approvalTask: { fontFamily: FF.body, fontSize: 13, marginTop: 2 },
  rejectBtn: { borderRadius: 12, borderWidth: 1, paddingVertical: 9, paddingHorizontal: 12, marginRight: 8 },
  rejectText: { fontFamily: FF.bodyMed, fontSize: 13 },
  approveBtn: { borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16, minWidth: 84, alignItems: "center" },
  approveText: { fontFamily: FF.bodyMed, fontSize: 14, color: "#FAF6EE" },
  emptyCard: { borderRadius: 16, borderWidth: 1.5, borderStyle: "dashed", padding: 20 },
  emptyText: { fontFamily: FF.body, fontSize: 14, lineHeight: 21, textAlign: "center" },
  childRow: { flexDirection: "row", alignItems: "center", borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", marginRight: 14 },
  avatarText: { fontFamily: FF.bodyBold, fontSize: 18 },
  childName: { fontFamily: FF.bodyMed, fontSize: 16 },
  childSub: { fontFamily: FF.body, fontSize: 13, marginTop: 2 },
  smallBtn: { borderRadius: 12, paddingVertical: 9, paddingHorizontal: 14 },
  smallBtnText: { fontFamily: FF.bodyMed, fontSize: 13 },
  signOut: { marginTop: 30, alignItems: "center", paddingVertical: 12 },
  signOutText: { fontFamily: FF.bodyMed, fontSize: 14 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", paddingHorizontal: 26 },
  modalCard: { borderRadius: 22, padding: 22 },
  modalTitle: { fontFamily: FF.display, fontSize: 22, marginBottom: 6 },
  modalSub: { fontFamily: FF.body, fontSize: 14, lineHeight: 20, marginBottom: 14 },
  inputLabel: { fontFamily: FF.kicker, fontSize: 11, letterSpacing: 1.5, marginTop: 12, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: FF.body, fontSize: 16 },
  err: { color: "#E05050", fontFamily: FF.bodyMed, fontSize: 13, marginTop: 8 },
  modalBtn: { borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  modalBtnText: { fontFamily: FF.bodyMed, fontSize: 15 },
  allowRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: 1 },
  allowLabel: { fontFamily: FF.bodyMed, fontSize: 15 },
  toggle: { borderRadius: 10, paddingVertical: 6, paddingHorizontal: 12 },
});
