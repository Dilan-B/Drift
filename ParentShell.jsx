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
  Share, Platform, StatusBar, ActivityIndicator, Modal, TextInput, RefreshControl,
} from "react-native";
import { getTheme, FF } from "./theme";
import Sprout from "./SproutArt";
import { supabase } from "./supabase";
import { notifyChildSubmittedTask } from "./notifications";
import FamilyProfileModal from "./FamilyProfile";
import { FamilyDock, HistoryList, shortDate } from "./FamilyUI";
import { FamilyWeekCard, useFamilyWeek } from "./FamilyStats";
import {
  fetchMyFamily, fetchFamilyChildren, fetchPendingApprovals, fetchChildrenBalances,
  fetchFamilyHistory, assignChildTask, approveChildTask, rejectChildTask,
  setFamilyPin, CONSENT_NOTICE_VERSION,
} from "./family";
import { ParentConsentCard, ChildDataModal, ConsentSettings } from "./ParentConsent";

import { tr } from "./i18n";
// There used to be an "Always allow" list here (Messages, Phone, Maps, ...)
// saved to family_members.app_policy.allow. Nothing on the child's phone ever
// read it, so the toggles changed nothing. iOS only hands an app opaque
// tokens chosen in Apple's picker on the device being managed; a name like
// "Messages" cannot become one. So the only way to pick a kid's apps is the
// PIN-gated picker on their phone (ParentPinPad), and this sheet says so.

export default function ParentShell({ userId, userEmail, username, dark = false, onSignOut, onToggleTheme, onDeleteAccount }) {
  const t = getTheme(dark);
  const onDeep = dark ? t.ink.void : "#FAF6EE"; // legible text on earn.deep buttons
  const [showProfile, setShowProfile] = useState(false);
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
  const [dataFor, setDataFor] = useState(null); // child object (COPPA review / delete)
  const [tab, setTab] = useState("home");
  const [refreshing, setRefreshing] = useState(false);
  const [history, setHistory] = useState([]);
  const [showPin, setShowPin] = useState(false);
  const [pin, setPin] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinMsg, setPinMsg] = useState("");

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
  const reloadHistory = useCallback(async (ids) => {
    setHistory(await fetchFamilyHistory(ids));
  }, []);

  const load = useCallback(async () => {
    if (!userId) return;
    const fam = await fetchMyFamily(userId);
    setFamily(fam);
    if (fam?.id) {
      const kids = await fetchFamilyChildren(fam.id);
      setChildren(kids);
      const ids = kids.map((c) => c.user_id);
      await Promise.all([reloadApprovals(ids), reloadBalances(ids), reloadHistory(ids)]);
    }
    setLoading(false);
  }, [userId, reloadApprovals, reloadBalances, reloadHistory]);

  useEffect(() => { load(); }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // Live: any child task change → refresh the approval queue + history; any
  // readable profile change → refresh balances. RLS delivers only this parent's
  // children.
  useEffect(() => {
    if (!userId || childIds.length === 0) return;
    const ch = supabase
      .channel(`parent:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" },
        () => { reloadApprovals(childIds); reloadHistory(childIds); })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" },
        () => { reloadBalances(childIds); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, childIds.join(","), reloadApprovals, reloadBalances, reloadHistory]);

  // Live: a kid joining/leaving the family (family_members change) → reload the
  // roster so new kids appear WITHOUT a manual refresh. Runs even with zero kids
  // so the very first join is caught.
  useEffect(() => {
    if (!family?.id) return;
    const ch = supabase
      .channel(`family_members:${family.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "family_members", filter: `family_id=eq.${family.id}` },
        async () => {
          const kids = await fetchFamilyChildren(family.id);
          setChildren(kids);
          const ids = kids.map((c) => c.user_id);
          reloadBalances(ids); reloadApprovals(ids); reloadHistory(ids);
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [family?.id, reloadBalances, reloadApprovals, reloadHistory]);

  async function shareCode() {
    if (!family?.code) return;
    try {
      await Share.share({
        message: tr("Join our family on Drift — open the app, pick \"I'm a kid\", and enter this code: {{code}}", { code: family.code }),
      });
    } catch {}
  }

  const childName = (id) => children.find((c) => c.user_id === id)?.display_name || tr("Your kid");

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


  async function savePin() {
    setPinMsg("");
    if (pin.length < 4) { setPinMsg(tr("Enter at least 4 digits.")); return; }
    setPinBusy(true);
    const res = await setFamilyPin(pin);
    setPinBusy(false);
    if (!res.ok) { setPinMsg(tr("Couldn't save the PIN. Try again.")); return; }
    setPin(""); setShowPin(false); setPinMsg("");
  }

  async function submitAssign() {
    setAssignErr("");
    const m = Math.round(Number(minutes));
    if (!title.trim()) { setAssignErr(tr("Give the task a name.")); return; }
    if (!Number.isFinite(m) || m < 1 || m > 600) { setAssignErr(tr("Enter minutes between 1 and 600.")); return; }
    setAssigning(true);
    const res = await assignChildTask(assignFor.user_id, title.trim(), m);
    setAssigning(false);
    if (!res.ok) { setAssignErr(tr("Couldn't assign the task. Try again.")); return; }
    setAssignFor(null); setTitle(""); setMinutes("20");
  }

  const mins = (id) => Math.max(0, Math.ceil((balances[id] || 0) / 60));
  // COPPA: no family code until the parent has consented to the current notice.
  const needsConsent = !loading && !!family && (!family.consent_at || family.consent_version !== CONSENT_NOTICE_VERSION);
  const consentCard = (
    <ParentConsentCard
      dark={dark}
      renewing={!!family?.consent_at || children.length > 0}
      onGranted={(d) => setFamily((f) => ({ ...f, consent_at: d?.consent_at || new Date().toISOString(), consent_version: d?.consent_version || CONSENT_NOTICE_VERSION }))}
    />
  );
  const week = useFamilyWeek(history, childIds);
  const hasKids = children.length > 0;

  // Family code + parent PIN. Setup things: on the home screen until the first
  // kid joins, then they move into the profile sheet (where they're still one
  // tap away for adding another kid) and the home screen shows the family.
  const setupSection = needsConsent ? consentCard : (
    <>
      <View style={[s.card, { backgroundColor: t.paper.card, borderColor: t.ink.border }]}>
        <Text style={[s.cardLabel, { color: t.ink.faint }]}>{tr("FAMILY CODE")}</Text>
        {loading ? <ActivityIndicator color={t.earn.sage} style={{ marginVertical: 14 }} />
          : <Text style={[s.code, { color: t.ink.deep }]}>{family?.code || "—"}</Text>}
        <TouchableOpacity style={[s.shareBtn, { backgroundColor: t.earn.deep }, t.fx.glow]} onPress={shareCode} disabled={!family?.code}>
          <Text style={[s.shareBtnText, { color: onDeep }]}>{tr("Share code")}</Text>
        </TouchableOpacity>
      </View>

      {/* Parent PIN — gates the app picker on a kid's device */}
      {showPin ? (
        <View style={[s.pinCard, { backgroundColor: t.paper.card, borderColor: t.ink.border }]}>
          <Text style={[s.pinLabel, { color: t.ink.mid }]}>{tr("Set a PIN. You'll enter it on your kid's phone to pick which apps get blocked.")}</Text>
          <TextInput
            style={[s.input, { borderColor: t.ink.border, color: t.ink.deep, backgroundColor: t.paper.warm, textAlign: "center", letterSpacing: 8, fontSize: 22 }]}
            placeholder="••••" placeholderTextColor={t.ink.faint}
            value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, "").slice(0, 8))}
            keyboardType="number-pad" secureTextEntry maxLength={8}
          />
          {pinMsg ? <Text style={s.err}>{pinMsg}</Text> : null}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
            <TouchableOpacity style={[s.modalBtn, { backgroundColor: t.paper.warm, flex: 1 }]} onPress={() => { setShowPin(false); setPin(""); setPinMsg(""); }}>
              <Text style={[s.modalBtnText, { color: t.ink.mid }]}>{tr("Cancel")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.modalBtn, { backgroundColor: t.earn.deep, flex: 1 }, t.fx.glow]} onPress={savePin} disabled={pinBusy}>
              {pinBusy ? <ActivityIndicator color={onDeep} /> : <Text style={[s.modalBtnText, { color: onDeep }]}>{tr("Save PIN")}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={[s.linkRow, { borderColor: t.ink.hairline }]} onPress={() => { setShowPin(true); setPinMsg(""); }}>
          <Text style={[s.linkText, { color: t.ink.mid }]}>{tr("Set parent PIN (for picking a kid's apps)")}</Text>
        </TouchableOpacity>
      )}
    </>
  );

  return (
    <View style={[s.root, { backgroundColor: t.paper.warm, paddingTop: Platform.OS === "ios" ? 64 : 40 }]}>
      <StatusBar barStyle={dark ? "light-content" : "dark-content"} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.earn.sage} />}
      >
        <View pointerEvents="none" style={{ position: "absolute", right: -50, top: -10, opacity: 0.1 }}>
          <Sprout size={180} tone="fresh" />
        </View>

        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
          <View style={{ flex: 1 }}>
            <Text style={[s.kicker, { color: t.earn.sage }]}>{tr("YOUR FAMILY")}</Text>
            <Text style={[s.title, { color: t.ink.deep }]}>{tr("Welcome home")}</Text>
          </View>
          <TouchableOpacity style={[s.profileBtn, { backgroundColor: t.earn.sageLo }]} onPress={() => setShowProfile(true)}>
            <Text style={[s.profileInitial, { color: t.earn.sage }]}>{(username || "?").slice(0, 1).toUpperCase()}</Text>
          </TouchableOpacity>
        </View>

        {tab === "history" ? (
          <>
            <Text style={[s.sectionLabel, { color: t.ink.faint }]}>{tr("COMPLETED")}</Text>
            <HistoryList
              items={history.map((h) => ({
                id: h.id, title: h.title, minutes: h.minutes,
                subtitle: `${childName(h.user_id)} · ${shortDate(h.completed_at)}`,
              }))}
              dark={dark}
              emptyText={tr("No completed tasks yet. Approved tasks show up here.")}
            />
          </>
        ) : (
        <>
        {hasKids && needsConsent ? consentCard : null}
        {hasKids ? <FamilyWeekCard week={week} dark={dark} /> : setupSection}

        {/* Approvals */}
        {approvals.length > 0 && (
          <>
            <Text style={[s.sectionLabel, { color: t.ink.faint }]}>{tr("WAITING FOR YOUR OK")}</Text>
            {approvals.map((a) => (
              <View key={a.id} style={[s.approvalCard, { backgroundColor: t.paper.card, borderColor: t.earn.sage }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.childName, { color: t.ink.deep }]}>{childName(a.user_id)}</Text>
                  <Text style={[s.approvalTask, { color: t.ink.mid }]}>{tr("{{title}} · +{{minutes}} min", { title: a.title, minutes: a.minutes })}</Text>
                </View>
                <TouchableOpacity style={[s.rejectBtn, { borderColor: t.ink.border }]} onPress={() => doReject(a.id)} disabled={busyId === a.id}>
                  <Text style={[s.rejectText, { color: t.ink.mid }]}>{tr("Not yet")}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.approveBtn, { backgroundColor: t.earn.deep }, t.fx.glow]} onPress={() => doApprove(a.id)} disabled={busyId === a.id}>
                  {busyId === a.id ? <ActivityIndicator color={onDeep} /> : <Text style={[s.approveText, { color: onDeep }]}>{tr("Approve")}</Text>}
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}

        {/* Kids */}
        <Text style={[s.sectionLabel, { color: t.ink.faint }]}>{tr("YOUR KIDS")}</Text>
        {loading ? null : children.length === 0 ? (
          <View style={[s.emptyCard, { borderColor: t.paper.dash }]}>
            <Text style={[s.emptyText, { color: t.ink.mid }]}>
              {tr("No kids yet. Share your code above and they'll show up here once they join.")}
            </Text>
          </View>
        ) : (
          children.map((cc) => (
            <View key={cc.user_id} style={[s.childRow, { backgroundColor: t.paper.card, borderColor: t.ink.border }]}>
              <View style={[s.avatar, { backgroundColor: t.earn.sageLo }]}>
                <Text style={[s.avatarText, { color: t.earn.sage }]}>{(cc.display_name || "?").slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.childName, { color: t.ink.deep }]}>{cc.display_name || tr("Kid")}</Text>
                <Text style={[s.childSub, { color: t.ink.mid }]}>
                  {tr("{{mins}} min left · {{p}} this week{{p2}}", { mins: mins(cc.user_id), p: week.perKid[cc.user_id]?.weekTasks || 0, p2: week.perKid[cc.user_id]?.streak > 1 ? tr(" · {{streak}}-day streak", { streak: week.perKid[cc.user_id].streak }) : "" })}
                </Text>
              </View>
              <TouchableOpacity style={[s.smallBtn, { backgroundColor: t.paper.warm, marginRight: 8 }]} onPress={() => setDataFor(cc)}>
                <Text style={[s.smallBtnText, { color: t.ink.mid }]}>{tr("Data")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.smallBtn, { backgroundColor: t.earn.sageLo }]} onPress={() => setAppsFor(cc)}>
                <Text style={[s.smallBtnText, { color: t.earn.greenD }]}>{tr("Apps")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.smallBtn, { backgroundColor: t.earn.deep, marginLeft: 8 }, t.fx.glow]} onPress={() => { setAssignFor(cc); setAssignErr(""); }}>
                <Text style={[s.smallBtnText, { color: onDeep }]}>{tr("+ Task")}</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
        </>
        )}
      </ScrollView>

      <FamilyDock tab={tab} onTab={setTab} dark={dark} />

      {/* Assign task modal */}
      <Modal visible={!!assignFor} transparent animationType="fade" onRequestClose={() => setAssignFor(null)}>
        <View style={s.modalWrap}>
          <View style={[s.modalCard, { backgroundColor: t.paper.card }]}>
            <Text style={[s.modalTitle, { color: t.ink.deep }]}>{tr("New task for {{display_name}}", { display_name: assignFor?.display_name })}</Text>
            <Text style={[s.inputLabel, { color: t.ink.faint }]}>{tr("TASK")}</Text>
            <TextInput
              style={[s.input, { borderColor: t.ink.border, color: t.ink.deep, backgroundColor: t.paper.warm }]}
              placeholder={tr("Clean your room")} placeholderTextColor={t.ink.faint}
              value={title} onChangeText={setTitle} maxLength={100} returnKeyType="next"
            />
            <Text style={[s.inputLabel, { color: t.ink.faint }]}>{tr("SCREEN TIME REWARD (MINUTES)")}</Text>
            <TextInput
              style={[s.input, { borderColor: t.ink.border, color: t.ink.deep, backgroundColor: t.paper.warm }]}
              placeholder="20" placeholderTextColor={t.ink.faint}
              value={minutes} onChangeText={(v) => setMinutes(v.replace(/[^0-9]/g, "").slice(0, 3))}
              keyboardType="number-pad" maxLength={3}
            />
            {assignErr ? <Text style={s.err}>{assignErr}</Text> : null}
            <View style={{ flexDirection: "row", marginTop: 16, gap: 10 }}>
              <TouchableOpacity style={[s.modalBtn, { backgroundColor: t.paper.warm, flex: 1 }]} onPress={() => setAssignFor(null)}>
                <Text style={[s.modalBtnText, { color: t.ink.mid }]}>{tr("Cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modalBtn, { backgroundColor: t.earn.deep, flex: 1 }, t.fx.glow]} onPress={submitAssign} disabled={assigning}>
                {assigning ? <ActivityIndicator color={onDeep} /> : <Text style={[s.modalBtnText, { color: onDeep }]}>{tr("Assign")}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* App policy modal */}
      <Modal visible={!!appsFor} transparent animationType="fade" onRequestClose={() => setAppsFor(null)}>
        <View style={s.modalWrap}>
          <View style={[s.modalCard, { backgroundColor: t.paper.card }]}>
            <Text style={[s.modalTitle, { color: t.ink.deep }]}>{tr("Apps on {{display_name}}'s phone", { display_name: appsFor?.display_name })}</Text>
            <Text style={[s.modalSub, { color: t.ink.mid }]}>
              {appsFor?.app_policy?.mode === "custom"
                ? tr("When {{display_name}} runs out of time, the apps you picked on their phone get blocked.", { display_name: appsFor?.display_name })
                : tr("When {{display_name}} runs out of time, social and entertainment apps get blocked automatically.", { display_name: appsFor?.display_name })}
            </Text>
            <Text style={[s.modalSub, { color: t.ink.mid }]}>
              {tr("Apple only lets apps be chosen on the phone being managed. To pick which apps get blocked, or to keep one open:")}
            </Text>
            {[
              tr("Open Drift on {{display_name}}'s phone and tap Manage app access.", { display_name: appsFor?.display_name }),
              tr("Enter your parent PIN. Apple's app picker opens."),
              tr("Select the apps to block. Anything you leave out stays open."),
            ].map((step, i) => (
              <View key={i} style={[s.allowRow, { borderColor: t.ink.hairline }]}>
                <Text style={[s.allowLabel, { color: t.ink.deep, flex: 1 }]}>{i + 1}. {step}</Text>
              </View>
            ))}
            <TouchableOpacity style={[s.modalBtn, { backgroundColor: t.earn.deep, marginTop: 16 }, t.fx.glow]} onPress={() => setAppsFor(null)}>
              <Text style={[s.modalBtnText, { color: onDeep }]}>{tr("Done")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ChildDataModal
        child={dataFor}
        minutesLeft={dataFor ? mins(dataFor.user_id) : 0}
        dark={dark}
        onClose={() => setDataFor(null)}
        onDeleted={(id) => { setDataFor(null); setChildren((prev) => prev.filter((c) => c.user_id !== id)); }}
      />

      <FamilyProfileModal
        visible={showProfile}
        onClose={() => setShowProfile(false)}
        dark={dark}
        onToggleTheme={onToggleTheme}
        name={username || tr("Parent")}
        subtitle={userEmail || tr("Drift parent account")}
        onSignOut={onSignOut}
        onDeleteAccount={onDeleteAccount}
        deleteMessage={hasKids
          ? tr("This permanently deletes your Drift account and every child account in your family, with all their data. This can't be undone. Cancel your Family subscription separately in iPhone Settings.")
          : undefined}
      >
        {hasKids && (
          <>
            <Text style={[s.sectionLabel, { color: t.ink.faint, marginTop: 8 }]}>{tr("ADD A KID")}</Text>
            {setupSection}
          </>
        )}
        <ConsentSettings
          dark={dark}
          consentAt={family?.consent_at}
          onWithdrawn={() => { setFamily((f) => ({ ...f, consent_at: null, consent_version: null })); setChildren([]); setShowProfile(false); }}
        />
      </FamilyProfileModal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  profileBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  profileInitial: { fontFamily: FF.bodyBold, fontSize: 18 },
  pinCard: { borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 20 },
  pinLabel: { fontFamily: FF.body, fontSize: 13, lineHeight: 19, marginBottom: 12 },
  linkRow: { borderTopWidth: 1, paddingVertical: 14, marginBottom: 8, marginTop: -6 },
  linkText: { fontFamily: FF.bodyMed, fontSize: 13 },
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
  err: { color: "#B5564B", fontFamily: FF.bodyMed, fontSize: 13, marginTop: 8 },
  modalBtn: { borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  modalBtnText: { fontFamily: FF.bodyMed, fontSize: 15 },
  allowRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: 1 },
  allowLabel: { fontFamily: FF.bodyMed, fontSize: 15 },
  toggle: { borderRadius: 10, paddingVertical: 6, paddingHorizontal: 12 },
});
