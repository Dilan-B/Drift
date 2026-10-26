/**
 * ParentConsent.jsx
 * COPPA pieces of the parent shell:
 *
 *   ParentConsentCard — the direct notice + verifiable parental consent, shown
 *     in place of the family code until the parent agrees. The notice has to
 *     say itself what is collected, why, who gets it, the parent's rights and
 *     retention (16 CFR 312.4(c)); a link to the policy alone isn't enough.
 *     The family code is inert server-side until consent is recorded.
 *
 *   ChildDataModal — the parent's right to review what Drift holds about one
 *     child and to have it deleted (312.6).
 *
 *   ConsentSettings — withdraw consent (erases every child) from the profile
 *     sheet.
 *
 * If the notice text changes materially, bump CONSENT_NOTICE_VERSION in
 * family.js so every parent is asked again.
 */
import React, { useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Modal, ScrollView, Alert, Linking,
} from "react-native";
import { getTheme, FF } from "./theme";
import { grantParentalConsent, withdrawParentalConsent, deleteChildData } from "./family";
import { tr } from "./i18n";

const PRIVACY_URL = "https://driftproductivity.com/privacy/";

function NoticeSection({ title, body, t }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={[s.noticeHead, { color: t.ink.deep }]}>{title}</Text>
      <Text style={[s.noticeBody, { color: t.ink.mid }]}>{body}</Text>
    </View>
  );
}

export function ParentConsentCard({ dark = false, renewing = false, onGranted }) {
  const t = getTheme(dark);
  const onDeep = dark ? t.ink.void : "#FAF6EE";
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function agree() {
    if (!checked) { setErr(tr("Tick the box to confirm you're the parent or legal guardian.")); return; }
    setBusy(true); setErr("");
    const res = await grantParentalConsent();
    setBusy(false);
    if (!res.ok) {
      setErr(res.reason === "no_plan" ? tr("Choose a Drift Family plan first. It's how Drift confirms an adult is setting this up.") : tr("Something went wrong. Check your connection and try again."));
      return;
    }
    onGranted?.(res.data);
  }

  return (
    <View style={[s.card, { backgroundColor: t.paper.card, borderColor: t.ink.border }]}>
      <Text style={[s.kicker, { color: t.earn.sage }]}>{tr("BEFORE YOUR KIDS JOIN")}</Text>
      <Text style={[s.title, { color: t.ink.deep }]}>
        {renewing ? tr("We've updated how we handle your kids' data") : tr("Your permission, first")}
      </Text>
      <Text style={[s.lead, { color: t.ink.mid }]}>{tr("US law (COPPA) requires a parent's consent before an app collects information from children under 13. Here is exactly what Drift does with your kids' information. Your family code won't work until you agree.")}</Text>

      <NoticeSection t={t} title={tr("What we collect from your child")} body={tr("The first name or nickname they type when joining. The tasks you assign and whether they're done. Their screen-time balance and the app categories you allow. Requests they send you to allow an app. A notification token so their phone can get alerts.")} />
      <NoticeSection t={t} title={tr("What we don't collect")} body={tr("No email, phone number, password, photos, location, contacts or birthday. Kids' accounts never use AI Check, so nothing your child does is sent to an AI service. No ads, no tracking, no analytics on kids' accounts. Which apps they use stays on their phone \u2014 Apple only gives Drift unreadable tokens.")} />
      <NoticeSection t={t} title={tr("Why")} body={tr("Only to run the features you use: assigning tasks, approving them, and unlocking screen time on your child's phone.")} />
      <NoticeSection t={t} title={tr("Who can see it")} body={tr("You, and your child. It's never public, sold or used for ads. It's stored by Supabase (our database host, in the US) and notifications are delivered through Apple. Both are bound to keep it confidential and use it only to run Drift.")} />
      <NoticeSection t={t} title={tr("How long we keep it")} body={tr("Until you delete it. It's erased when you remove your child, withdraw consent or delete your account, and automatically after 18 months with no activity.")} />
      <NoticeSection t={t} title={tr("Your rights")} body={tr("At any time you can review what Drift holds about your child (tap Data next to their name), delete it, or withdraw consent, which deletes every child's data and stops any more being collected. Questions: driftappcontact@gmail.com.")} />
      <NoticeSection t={t} title={tr("How we confirm you're the parent")} body={tr("Your Drift Family plan is bought through Apple, which notifies the account holder of the purchase. That purchase plus your agreement here is how Drift verifies a parent is giving consent.")} />

      <TouchableOpacity onPress={() => Linking.openURL(PRIVACY_URL)} style={{ marginBottom: 14 }}>
        <Text style={[s.link, { color: t.earn.sage }]}>{tr("Read the full privacy policy")}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={s.checkRow}
        onPress={() => { setChecked(!checked); setErr(""); }}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
      >
        <View style={[s.box, { borderColor: checked ? t.earn.deep : t.ink.border, backgroundColor: checked ? t.earn.deep : "transparent" }]}>
          {checked ? <Text style={{ color: onDeep, fontFamily: FF.bodyBold, fontSize: 14 }}>✓</Text> : null}
        </View>
        <Text style={[s.checkText, { color: t.ink.deep }]}>{tr("I'm the parent or legal guardian of the children who will join this family, and I agree to Drift collecting and using their information as described above.")}</Text>
      </TouchableOpacity>

      {err ? <Text style={s.err}>{err}</Text> : null}

      <TouchableOpacity
        style={[s.btn, { backgroundColor: t.earn.deep, opacity: checked ? 1 : 0.55 }, t.fx.glow]}
        onPress={agree}
        disabled={busy}
      >
        {busy ? <ActivityIndicator color={onDeep} /> : <Text style={[s.btnText, { color: onDeep }]}>{tr("I agree")}</Text>}
      </TouchableOpacity>
    </View>
  );
}

export function ChildDataModal({ child, minutesLeft = 0, dark = false, onClose, onDeleted }) {
  const t = getTheme(dark);
  const [busy, setBusy] = useState(false);
  const name = child?.display_name || tr("Your kid");

  function confirmDelete() {
    Alert.alert(
      tr("Delete {{name}}'s data?", { name }),
      tr("This permanently deletes {{name}}'s account, tasks, balance and requests, and signs out their phone. This can't be undone.", { name }),
      [
        { text: tr("Cancel"), style: "cancel" },
        {
          text: tr("Delete"),
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            const res = await deleteChildData(child.user_id);
            setBusy(false);
            if (!res.ok) { Alert.alert(tr("Couldn't delete it. Check your connection and try again.")); return; }
            onDeleted?.(child.user_id);
          },
        },
      ],
    );
  }

  return (
    <Modal visible={!!child} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.modalWrap}>
        <View style={[s.modalCard, { backgroundColor: t.paper.card }]}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={[s.title, { color: t.ink.deep }]}>{tr("What Drift holds about {{name}}", { name })}</Text>
            <Text style={[s.lead, { color: t.ink.mid }]}>{tr("Everything stored for {{name}}'s account. Nothing else is kept.", { name })}</Text>
            {[
              [tr("Name"), name],
              [tr("Tasks"), tr("Ones you assigned, and their status")],
              [tr("Screen time"), tr("{{n}} min left", { n: minutesLeft })],
              [tr("Allowed apps"), tr("The categories you chose")],
              [tr("App requests"), tr("Requests sent to you")],
              [tr("Device"), tr("A notification token")],
            ].map(([k, v]) => (
              <View key={k} style={[s.dataRow, { borderColor: t.ink.hairline }]}>
                <Text style={[s.dataKey, { color: t.ink.faint }]}>{k}</Text>
                <Text style={[s.dataVal, { color: t.ink.deep }]}>{v}</Text>
              </View>
            ))}
            <Text style={[s.noticeBody, { color: t.ink.mid, marginTop: 14 }]}>{tr("No email, photos, location, contacts or AI checks. Which apps they open stays on their phone.")}</Text>
            <TouchableOpacity style={[s.dangerBtn]} onPress={confirmDelete} disabled={busy}>
              {busy ? <ActivityIndicator color="#B5564B" /> : <Text style={s.dangerText}>{tr("Delete {{name}}'s data", { name })}</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, { backgroundColor: t.paper.warm, marginTop: 10 }]} onPress={onClose}>
              <Text style={[s.btnText, { color: t.ink.mid }]}>{tr("Done")}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function ConsentSettings({ dark = false, consentAt, onWithdrawn }) {
  const t = getTheme(dark);
  const [busy, setBusy] = useState(false);
  if (!consentAt) return null;

  function confirmWithdraw() {
    Alert.alert(
      tr("Withdraw consent?"),
      tr("This permanently deletes every child's account and data in your family, and no child can join until you agree again. This can't be undone."),
      [
        { text: tr("Cancel"), style: "cancel" },
        {
          text: tr("Withdraw"),
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            const res = await withdrawParentalConsent();
            setBusy(false);
            if (!res.ok) { Alert.alert(tr("Something went wrong. Check your connection and try again.")); return; }
            onWithdrawn?.();
          },
        },
      ],
    );
  }

  return (
    <View style={{ marginTop: 8 }}>
      <Text style={[s.kicker, { color: t.ink.faint }]}>{tr("YOUR KIDS' PRIVACY")}</Text>
      <Text style={[s.noticeBody, { color: t.ink.mid, marginBottom: 10 }]}>
        {tr("You gave consent on {{date}}.", { date: new Date(consentAt).toLocaleDateString() })}
      </Text>
      <TouchableOpacity onPress={() => Linking.openURL(PRIVACY_URL)} style={{ marginBottom: 10 }}>
        <Text style={[s.link, { color: t.earn.sage }]}>{tr("Read the full privacy policy")}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.dangerBtn} onPress={confirmWithdraw} disabled={busy}>
        {busy ? <ActivityIndicator color="#B5564B" /> : <Text style={s.dangerText}>{tr("Withdraw consent and delete kids' data")}</Text>}
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 20, borderWidth: 1, padding: 20, marginBottom: 26 },
  kicker: { fontFamily: FF.kicker, fontSize: 11, letterSpacing: 2, marginBottom: 8 },
  title: { fontFamily: FF.display, fontSize: 22, marginBottom: 8 },
  lead: { fontFamily: FF.body, fontSize: 14, lineHeight: 20, marginBottom: 14 },
  noticeHead: { fontFamily: FF.bodyMed, fontSize: 14, marginBottom: 3 },
  noticeBody: { fontFamily: FF.body, fontSize: 13, lineHeight: 19 },
  link: { fontFamily: FF.bodyMed, fontSize: 14, textDecorationLine: "underline" },
  checkRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 14 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center", marginRight: 10, marginTop: 1 },
  checkText: { flex: 1, fontFamily: FF.body, fontSize: 14, lineHeight: 20 },
  err: { color: "#B5564B", fontFamily: FF.bodyMed, fontSize: 13, marginBottom: 10 },
  btn: { borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  btnText: { fontFamily: FF.bodyMed, fontSize: 15 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", paddingHorizontal: 22, paddingVertical: 60 },
  modalCard: { borderRadius: 22, padding: 22, maxHeight: "100%" },
  dataRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, gap: 12 },
  dataKey: { fontFamily: FF.body, fontSize: 13, flexShrink: 0 },
  dataVal: { fontFamily: FF.bodyMed, fontSize: 13, flex: 1, textAlign: "right" },
  dangerBtn: { borderRadius: 14, borderWidth: 1, borderColor: "#B5564B", paddingVertical: 13, alignItems: "center", marginTop: 16 },
  dangerText: { color: "#B5564B", fontFamily: FF.bodyMed, fontSize: 14 },
});
