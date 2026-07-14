/**
 * ChallengeModal.jsx
 * Send a preset exercise or custom accountability challenge to a friend.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Animated, KeyboardAvoidingView, PanResponder, Platform, ScrollView, StyleSheet,
  Pressable, Text, TextInput, TouchableOpacity, Vibration, View,
} from "react-native";
import { supabase } from "./supabase";
import { cached, rateLimited } from "./apiGuards";
import {
  DumbbellIcon, BoltIcon, FireIcon, LegIcon, SurfIcon, RunIcon,
  SpeakerIcon, WarnIcon, SparkleIcon,
} from "./Icons";
import { FF } from "./theme";
import { LeafGlyph } from "./SproutArt";

const terra = "#3E6B4E";

const CHALLENGE_OPTIONS = [
  { id: "pushups", label: "Push-ups", Icon: DumbbellIcon, reps: 20, title: "20 push-ups", minutes: 5 },
  { id: "squats", label: "Squats", Icon: DumbbellIcon, reps: 30, title: "30 squats", minutes: 5 },
  { id: "jacks", label: "Jumping Jacks", Icon: BoltIcon, reps: 30, title: "30 jumping jacks", minutes: 4 },
  { id: "situps", label: "Sit-ups", Icon: LegIcon, reps: 20, title: "20 sit-ups", minutes: 5 },
  { id: "burpees", label: "Burpees", Icon: FireIcon, reps: 10, title: "10 burpees", minutes: 6 },
  { id: "lunges", label: "Lunges", Icon: LegIcon, reps: 20, title: "20 lunges", minutes: 5 },
  { id: "plank", label: "Plank", Icon: SurfIcon, secs: 60, title: "60 second plank", minutes: 2 },
  { id: "run", label: "10 min jog", Icon: RunIcon, secs: 600, title: "10 minute jog", minutes: 10 },
];

const palette = (dark) => dark ? {
  overlay: "rgba(0,0,0,0.66)",
  sheet: "#1A241C",
  card: "#212D24",
  ink: "#F1F5E9",
  mid: "#AFC0AA",
  faint: "#71836F",
  border: "rgba(222,240,216,0.11)",
  hairline: "rgba(222,240,216,0.07)",
  wash: "rgba(181,217,160,0.16)",
  washStrong: "rgba(181,217,160,0.26)",
  input: "#212D24",
  deep: "#D9EFAD",
  clay: "#E2B084",
} : {
  overlay: "rgba(11,26,17,0.35)",
  sheet: "#FFFFFF",
  card: "#FBFBF9",
  ink: "#1A2820",
  mid: "#6B7A6E",
  faint: "#A8B0A8",
  border: "rgba(26,40,32,0.08)",
  hairline: "rgba(26,40,32,0.06)",
  wash: "#E4ECE0",
  washStrong: "rgba(62,107,78,0.14)",
  input: "#FAF6EE",
  deep: "#1F3A2A",
  clay: "#B0764E",
};

function isSubActive(profile) {
  if (!profile?.sub_active) return false;
  return !profile.sub_expires || new Date(profile.sub_expires) > new Date();
}

export default function ChallengeSheet({
  userId, target, userIsPremium = false, onClose, onSent, onSwipeLockChange, dark = false,
}) {
  const th = palette(dark);
  const [mode, setMode] = useState("exercise");
  const [type, setType] = useState("compete");
  const [exercise, setExercise] = useState(CHALLENGE_OPTIONS[0]);
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState("20");
  const [rules, setRules] = useState("");
  const [targetPremium, setTargetPremium] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const slideY = useRef(new Animated.Value(0)).current;
  const sentScale = useRef(new Animated.Value(0.9)).current;

  const bothPremium = userIsPremium && targetPremium;
  const chosenTitle = mode === "exercise" ? exercise?.title : title.trim();
  const chosenMinutes = mode === "exercise" ? exercise?.minutes : Math.max(1, Math.min(600, Number(minutes) || 20));
  const canSend = !!chosenTitle && !sending;

  useEffect(() => {
    onSwipeLockChange?.(true);
    return () => onSwipeLockChange?.(false);
  }, [onSwipeLockChange]);

  useEffect(() => {
    (async () => {
      // Use the can_user_ai RPC instead of reading raw sub_active/sub_expires.
      // Friends shouldn't see each other's exact subscription state — the RPC
      // returns just the boolean we need.
      const { data } = await cached(`can_user_ai_${target.id}`, 60_000, () =>
        supabase.rpc("can_user_ai", { uid: target.id })
      );
      setTargetPremium(data === true);
    })();
  }, [target.id]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dy) > Math.abs(gs.dx) * 1.4 && gs.dy > 12,
    onPanResponderMove: (_, gs) => {
      if (gs.dy > 0) slideY.setValue(gs.dy);
    },
    onPanResponderRelease: (_, gs) => {
      if (gs.dy > 90 || gs.vy > 1.1) onClose?.();
      else Animated.spring(slideY, { toValue: 0, useNativeDriver: true, tension: 90, friction: 10 }).start();
    },
  }), [onClose, slideY]);

  const send = async () => {
    if (!canSend) return;
    setErrorMsg("");
    setSending(true);
    const insert = {
      challenger_id: userId,
      challenged_id: target.id,
      type,
      exercise: mode === "exercise" ? exercise.id : "custom",
      title: chosenTitle,
      description: mode === "custom" ? rules.trim() || null : null,
      duration_mins: chosenMinutes,
      reps: mode === "exercise" ? exercise.reps ?? null : null,
      secs: mode === "exercise" ? exercise.secs ?? null : null,
      ai_required: mode === "custom" && bothPremium,
      status: "pending",
    };
    let { error } = await rateLimited(`send_challenge_${userId}`, { limit: 20, windowMs: 60_000 }, () =>
      supabase.from("challenges").insert(insert)
    );
    if (error && mode === "exercise" && /title|description|duration_mins|ai_required|schema cache/i.test(error.message || "")) {
      const legacy = {
        challenger_id: userId,
        challenged_id: target.id,
        type,
        exercise: exercise.id,
        reps: exercise.reps ?? null,
        secs: exercise.secs ?? null,
        status: "pending",
      };
      const retry = await rateLimited(`send_challenge_${userId}`, { limit: 20, windowMs: 60_000 }, () =>
        supabase.from("challenges").insert(legacy)
      );
      error = retry.error;
    }
    setSending(false);
    if (error) {
      Vibration.vibrate([0, 30, 40, 30]);
      setErrorMsg(/title|description|duration_mins|ai_required|schema cache/i.test(error.message || "")
        ? "Custom challenges need the Supabase SQL update before they can be sent."
        : (error.message || "Could not send challenge."));
      return;
    }
    Vibration.vibrate(18);
    setSent(true);
    Animated.spring(sentScale, { toValue: 1, useNativeDriver: true, tension: 120, friction: 8 }).start();
    setTimeout(() => {
      onSent?.();
      onClose?.();
    }, 720);
  };

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 500 }]}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: th.overlay }]} onPress={onClose} />
      <KeyboardAvoidingView
        pointerEvents="box-none"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={StyleSheet.absoluteFill}
      >
      <Animated.View
        {...panResponder.panHandlers}
        style={[s.sheet, { backgroundColor: th.sheet, borderColor: th.border, transform: [{ translateY: slideY }] }]}
      >
        <View style={[s.handle, { backgroundColor: th.border }]} />
        {sent && (
          <Animated.View pointerEvents="none" style={[s.sentPill, { backgroundColor: th.deep, transform: [{ scale: sentScale }] }]}>
            <Text style={s.sentText}>Sent</Text>
          </Animated.View>
        )}

        <View style={s.hero}>
          <View style={[s.leafBadge, { backgroundColor: th.wash }]}>
            <LeafGlyph size={19} color={terra} />
          </View>
          <Text style={[s.kicker, { color: th.faint }]}>{type === "dare" ? "DARE" : "CHALLENGE"}</Text>
          <Text style={[s.title, { color: th.ink }]}>@{target.username}</Text>
        </View>

        <View style={[s.segment, { backgroundColor: th.card }]}>
          {[
            ["exercise", "Exercise"],
            ["custom", "Custom"],
          ].map(([id, label]) => (
            <TouchableOpacity key={id} onPress={() => setMode(id)} style={[s.segmentItem, mode === id && { backgroundColor: th.deep }]}>
              <Text style={{
                color: mode === id ? (dark ? "#1F3A2A" : "#FAF6EE") : th.mid,
                fontFamily: FF.bodyMed,
                fontSize: 12,
              }}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={s.modeRow}>
          {[
            { id: "compete", label: "Compete", sub: "first done wins" },
            { id: "dare", label: "Dare", sub: "finish before midnight" },
          ].map(m => (
            <TouchableOpacity key={m.id} onPress={() => setType(m.id)} style={[s.modeCard, { backgroundColor: th.card, borderColor: th.border }, type === m.id && { borderColor: terra, backgroundColor: th.wash }]}>
              <Text style={{ color: type === m.id ? terra : th.ink, fontFamily: FF.bodyMed, fontSize: 14 }}>{m.label}</Text>
              <Text style={{ color: th.mid, fontFamily: FF.body, fontSize: 11, marginTop: 2 }}>{m.sub}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={s.bodyScroll}
          contentContainerStyle={s.bodyContent}
        >
        {mode === "exercise" ? (
          <>
            <Text style={[s.pickLabel, { color: th.faint }]}>{type === "dare" ? "Choose a dare" : "Choose challenge"}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }} contentContainerStyle={{ paddingBottom: 4 }}>
              {CHALLENGE_OPTIONS.map(opt => (
                <TouchableOpacity key={opt.id} onPress={() => setExercise(opt)} pointerEvents="box-only" style={[s.exCard, { backgroundColor: th.card, borderColor: th.border }, exercise?.id === opt.id && { borderColor: terra, backgroundColor: th.washStrong }]}>
                  <View style={s.exIconWrap}><opt.Icon size={24} color={exercise?.id === opt.id ? terra : th.mid} /></View>
                  <Text numberOfLines={2} style={[s.exLabel, { color: exercise?.id === opt.id ? terra : th.ink }]}>{opt.label}</Text>
                  <Text numberOfLines={1} style={[s.exMeta, { color: th.mid }]}>{opt.reps ? `${opt.reps} reps` : `${opt.secs}s`}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        ) : (
          <View style={{ gap: 10, marginBottom: 16 }}>
            <TextInput
              style={[s.input, { backgroundColor: th.input, borderColor: th.border, color: th.ink }]}
              value={title}
              onChangeText={setTitle}
              placeholder={type === "dare" ? "Dare title" : "Competition title"}
              placeholderTextColor={th.faint}
              maxLength={80}
            />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TextInput
                style={[s.input, { flex: 0.45, backgroundColor: th.input, borderColor: th.border, color: th.ink }]}
                value={minutes}
                onChangeText={setMinutes}
                placeholder="Minutes"
                placeholderTextColor={th.faint}
                keyboardType="number-pad"
                maxLength={4}
              />
              <TextInput
                style={[s.input, { flex: 1, backgroundColor: th.input, borderColor: th.border, color: th.ink }]}
                value={rules}
                onChangeText={setRules}
                placeholder={type === "dare" ? "What they must do" : "Rules or proof needed"}
                placeholderTextColor={th.faint}
                maxLength={140}
              />
            </View>
          </View>
        )}

        <View style={[s.infoBox, { backgroundColor: th.card, borderColor: th.border }]}>
          {mode === "custom" && bothPremium ? <SparkleIcon size={18} color={terra} /> : type === "dare" ? <WarnIcon size={18} color="#E05A5A" /> : <SpeakerIcon size={18} color={terra} />}
          <Text style={[s.infoText, { color: th.mid }]}>
            {mode === "custom"
              ? bothPremium
                ? "Both accounts have Pro, so completion uses AI Check."
                : "Custom challenges send normally. AI verification turns on when both users have Pro."
              : type === "compete"
                ? "Both of you get the same challenge. First completion is tracked."
                : "They need to complete this before it expires."}
            </Text>
        </View>
        </ScrollView>

        {!!errorMsg && <Text style={s.errorText}>{errorMsg}</Text>}

        <View style={{ flexDirection: "row", gap: 10 }}>
          <TouchableOpacity onPress={onClose} style={[s.cancelBtn, { borderColor: th.border }]}>
            <Text style={{ color: th.mid, fontFamily: FF.bodyMed, fontSize: 14 }}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={send} disabled={!canSend || sending} style={[s.sendBtn, { backgroundColor: th.deep }, (!canSend || sending) && { opacity: 0.45 }]}>
            {sending ? <ActivityIndicator color={dark ? "#1F3A2A" : "#FAF6EE"} size="small" /> : <Text style={[s.sendBtnText, { color: dark ? "#1F3A2A" : "#FAF6EE" }]}>Send</Text>}
          </TouchableOpacity>
        </View>
      </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  sheet: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 18,
    maxHeight: "90%",
    borderRadius: 28,
    padding: 22,
    paddingBottom: 24,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    elevation: 18,
  },
  handle: { width: 38, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 14 },
  sentPill: { position: "absolute", top: 18, right: 20, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 7 },
  sentText: { color: "#1F3A2A", fontFamily: FF.bodyBold, fontSize: 12 },
  hero: { alignItems: "center", marginBottom: 16 },
  leafBadge: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  kicker: { fontFamily: FF.kicker, fontSize: 9, letterSpacing: 2.4, marginBottom: 4 },
  title: { fontFamily: FF.display, fontSize: 32, letterSpacing: -0.4 },
  segment: { flexDirection: "row", padding: 4, borderRadius: 16, marginBottom: 12 },
  segmentItem: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 11 },
  modeRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  modeCard: { flex: 1, padding: 13, borderRadius: 16, borderWidth: 1 },
  bodyScroll: { maxHeight: 260, marginBottom: 12 },
  bodyContent: { paddingBottom: 2 },
  pickLabel: { fontFamily: FF.kicker, fontSize: 9, textTransform: "uppercase", letterSpacing: 1.8, marginBottom: 10 },
  exCard: {
    width: 106,
    minHeight: 118,
    paddingVertical: 13,
    paddingHorizontal: 10,
    marginRight: 8,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
  },
  exIconWrap: {
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  exLabel: {
    fontFamily: FF.bodyMed,
    fontSize: 12,
    lineHeight: 15,
    minHeight: 30,
    textAlign: "center",
    marginTop: 5,
  },
  exMeta: {
    fontFamily: FF.body,
    fontSize: 10,
    lineHeight: 13,
    marginTop: 5,
    textAlign: "center",
  },
  input: { borderWidth: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 13, fontFamily: FF.body, fontSize: 14 },
  infoBox: { flexDirection: "row", gap: 9, padding: 13, borderRadius: 16, borderWidth: 1, marginBottom: 16 },
  infoText: { flex: 1, fontFamily: FF.body, fontSize: 12, lineHeight: 18 },
  errorText: { color: "#E05050", fontFamily: FF.body, fontSize: 12, marginBottom: 12, textAlign: "center" },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 14, borderWidth: 1, alignItems: "center" },
  sendBtn: { flex: 2, padding: 14, borderRadius: 14, alignItems: "center" },
  sendBtnText: { fontFamily: FF.bodyMed, fontSize: 15 },
});
