/**
 * ChallengeModal.jsx
 * Send a challenge to a friend — two modes:
 *   dare:    loser (whoever finishes last / doesn't finish) loses 30 min screen time tomorrow
 *   compete: same challenge, first to finish wins. winner gets +20 min bonus tomorrow.
 */
import React, { useState } from "react";
import {
  ActivityIndicator, Alert, Modal, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from "react-native";
import { supabase } from "./supabase";

const ink = { void: "#16120E", deep: "#1E1B15", border: "rgba(255,255,255,0.09)" };
const terra = "#D4622A";
const FD = "Georgia";

const CHALLENGE_OPTIONS = [
  { id: "pushups", label: "Push-ups",      emoji: "💪", reps: 20  },
  { id: "squats",  label: "Squats",         emoji: "🏋️", reps: 30  },
  { id: "jacks",   label: "Jumping Jacks",  emoji: "⚡", reps: 30  },
  { id: "situps",  label: "Sit-ups",        emoji: "🤸", reps: 20  },
  { id: "burpees", label: "Burpees",        emoji: "🔥", reps: 10  },
  { id: "lunges",  label: "Lunges",         emoji: "🦵", reps: 20  },
  { id: "plank",   label: "Plank",          emoji: "🏄", secs: 60  },
  { id: "run",     label: "10 min jog",     emoji: "🏃", secs: 600 },
];

export default function ChallengeSheet({ userId, target, onClose }) {
  const [type,     setType]     = useState("compete"); // 'dare' | 'compete'
  const [exercise, setExercise] = useState(null);
  const [sending,  setSending]  = useState(false);

  const send = async () => {
    if (!exercise) return;
    setSending(true);
    const { error } = await supabase.from("challenges").insert({
      challenger_id: userId,
      challenged_id: target.id,
      type,
      exercise:     exercise.id,
      reps:         exercise.reps ?? null,
      secs:         exercise.secs ?? null,
      status:       "pending",
    });
    setSending(false);
    if (error) {
      Alert.alert("Error", error.message);
    } else {
      Alert.alert(
        "Challenge sent! 🔥",
        `${target.username} has been challenged to ${exercise.label}.`,
        [{ text: "OK", onPress: onClose }]
      );
    }
  };

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.handle} />

          <Text style={s.title}>Challenge @{target.username}</Text>

          {/* Mode selector */}
          <View style={s.modeRow}>
            {[
              { id: "compete", label: "Compete",  sub: "First to finish wins +20 min" },
              { id: "dare",    label: "Dare",      sub: "Loser loses 30 min tomorrow" },
            ].map(m => (
              <TouchableOpacity
                key={m.id}
                onPress={() => setType(m.id)}
                style={[s.modeCard, type === m.id && s.modeCardOn]}
              >
                <Text style={[s.modeLabel, type === m.id && s.modeLabelOn]}>{m.label}</Text>
                <Text style={[s.modeSub,   type === m.id && s.modeSubOn]}>{m.sub}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Exercise picker */}
          <Text style={s.pickLabel}>Choose exercise</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
            {CHALLENGE_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.id}
                onPress={() => setExercise(opt)}
                style={[s.exCard, exercise?.id === opt.id && s.exCardOn]}
              >
                <Text style={{ fontSize: 28, marginBottom: 6 }}>{opt.emoji}</Text>
                <Text style={[s.exLabel, exercise?.id === opt.id && { color: terra }]}>{opt.label}</Text>
                <Text style={s.exSub}>
                  {opt.reps ? `${opt.reps} reps` : `${opt.secs}s`}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Type explanation */}
          <View style={s.infoBox}>
            {type === "compete" ? (
              <Text style={s.infoText}>
                📢 Both of you get the same challenge.{"\n"}
                First to complete it earns <Text style={{ color: terra }}>+20 min</Text> bonus screen time tomorrow.
              </Text>
            ) : (
              <Text style={s.infoText}>
                ⚠️ You dare @{target.username} to complete this.{"\n"}
                If they don't finish by midnight, they lose <Text style={{ color: "#E05A5A" }}>30 min</Text> screen time tomorrow.{"\n"}
                If you lose, same applies to you.
              </Text>
            )}
          </View>

          {/* Actions */}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <TouchableOpacity onPress={onClose} style={s.cancelBtn}>
              <Text style={s.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={send}
              disabled={!exercise || sending}
              style={[s.sendBtn, (!exercise || sending) && { opacity: 0.4 }]}
            >
              {sending
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={s.sendBtnText}>Send Challenge 🔥</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Incoming challenge notification row ──────────────────────
// Used in SocialScreen to show pending challenges you received
export function IncomingChallenge({ challenge, myId, onAccept, onDecline }) {
  const isMe = challenge.challenged_id === myId;
  if (!isMe) return null;

  const opt = CHALLENGE_OPTIONS.find(o => o.id === challenge.exercise);
  const typeLabel = challenge.type === "dare" ? "dared" : "challenged";

  return (
    <View style={s.incomingRow}>
      <Text style={s.incomingText}>
        @{challenge.challenger_username} {typeLabel} you to <Text style={{ color: terra }}>{opt?.label}</Text>
        {opt?.reps ? ` (${opt.reps} reps)` : opt?.secs ? ` (${opt.secs}s)` : ""}
      </Text>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
        <TouchableOpacity onPress={() => onDecline(challenge.id)} style={s.declineBtn}>
          <Text style={s.declineBtnText}>Decline</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onAccept(challenge)} style={s.acceptBtn}>
          <Text style={s.acceptBtnText}>Accept</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────
const s = StyleSheet.create({
  overlay: {
    flex: 1, justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    backgroundColor: ink.deep,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40,
    borderTopWidth: 0.5, borderColor: "rgba(255,255,255,0.1)",
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignSelf: "center", marginBottom: 20,
  },
  title: {
    fontFamily: FD, fontSize: 22, color: "#F0E8D8",
    fontStyle: "italic", fontWeight: "300", marginBottom: 20,
  },
  modeRow:    { flexDirection: "row", gap: 10, marginBottom: 20 },
  modeCard: {
    flex: 1, padding: 14, borderRadius: 12,
    borderWidth: 0.5, borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  modeCardOn:  { borderColor: terra, backgroundColor: "rgba(212,98,42,0.12)" },
  modeLabel:   { color: "#8A7E70", fontSize: 15, fontWeight: "600", marginBottom: 4 },
  modeLabelOn: { color: terra },
  modeSub:     { color: "#4A3828", fontSize: 11, lineHeight: 16 },
  modeSubOn:   { color: "#9A6858" },
  pickLabel:   { color: "#5A4838", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 },
  exCard: {
    width: 90, padding: 12, marginRight: 8, borderRadius: 12, alignItems: "center",
    borderWidth: 0.5, borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  exCardOn: { borderColor: terra, backgroundColor: "rgba(212,98,42,0.12)" },
  exLabel:  { color: "#C0B0A0", fontSize: 12, fontWeight: "600", textAlign: "center" },
  exSub:    { color: "#4A3828", fontSize: 10, marginTop: 3 },
  infoBox: {
    padding: 14, borderRadius: 12, marginBottom: 20,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 0.5, borderColor: "rgba(255,255,255,0.07)",
  },
  infoText: { color: "#8A7060", fontSize: 13, lineHeight: 20 },
  cancelBtn: {
    flex: 1, padding: 14, borderRadius: 12,
    borderWidth: 0.5, borderColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
  },
  cancelBtnText: { color: "#5A4838", fontSize: 14 },
  sendBtn: {
    flex: 2, padding: 14, borderRadius: 12,
    backgroundColor: terra, alignItems: "center",
  },
  sendBtnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  incomingRow: {
    margin: 12, padding: 14, borderRadius: 12,
    borderWidth: 0.5, borderColor: "rgba(212,98,42,0.3)",
    backgroundColor: "rgba(212,98,42,0.07)",
  },
  incomingText: { color: "#C0A898", fontSize: 13, lineHeight: 20 },
  declineBtn: {
    flex: 1, padding: 10, borderRadius: 8,
    borderWidth: 0.5, borderColor: "rgba(255,255,255,0.1)", alignItems: "center",
  },
  declineBtnText: { color: "#5A4838", fontSize: 13 },
  acceptBtn: {
    flex: 2, padding: 10, borderRadius: 8,
    backgroundColor: terra, alignItems: "center",
  },
  acceptBtnText: { color: "#fff", fontWeight: "600", fontSize: 13 },
});
