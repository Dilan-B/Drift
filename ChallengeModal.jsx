/**
 * ChallengeModal.jsx
 * Send a preset exercise or custom accountability challenge to a friend.
 *
 * Remodeled to the organic-editorial system: a full page over warm paper with
 * aurora pools (matching Add Task / Drift In), serif headline, pill segments,
 * a two-column exercise grid with LIVE badges on pose-tracked movements, a
 * plain-language stakes card, and a bottom Send dock in thumb reach.
 * Exercises with a pose config are verified by the camera counting reps live.
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
  SpeakerIcon, WarnIcon, SparkleIcon, CameraIcon,
} from "./Icons";
import { FF } from "./theme";
import { LeafGlyph } from "./SproutArt";
import { POSE_EXERCISE_IDS } from "./PoseCamera";

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

// Mirrors getStake() in SocialScreen so the preview matches what's at stake.
const STAKES = {
  compete: { xp: 30, penaltyMins: 15 },
  dare:    { xp: 20, penaltyMins: 30 },
};

const palette = (dark) => dark ? {
  bg: "#0E1A13",
  card: "#17291D",
  card2: "#1E3325",
  sand: "#122117",
  ink: "#F0F7EA",
  mid: "#A9C4AB",
  faint: "#6E8A74",
  ghost: "rgba(160,230,170,0.07)",
  border: "rgba(160,230,170,0.15)",
  hairline: "rgba(160,230,170,0.09)",
  wash: "rgba(165,227,155,0.17)",
  washStrong: "rgba(165,227,155,0.27)",
  sage: "#A5E39B",
  deep: "#C6F2A0",
  onDeep: "#16261C",
  clay: "#F0B984",
  danger: "#EFA293",
  auroraMint: "rgba(127,227,165,0.10)",
  auroraClay: "rgba(240,185,132,0.055)",
  glow: { shadowColor: "#C6F2A0", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 6 },
} : {
  bg: "#F7F7F4",
  card: "#FFFFFF",
  card2: "#FBFBF9",
  sand: "#F1F2EE",
  ink: "#1A2820",
  mid: "#6B7A6E",
  faint: "#A8B0A8",
  ghost: "rgba(26,40,32,0.05)",
  border: "rgba(26,40,32,0.08)",
  hairline: "rgba(26,40,32,0.06)",
  wash: "#E4ECE0",
  washStrong: "rgba(62,107,78,0.14)",
  sage: "#3E6B4E",
  deep: "#1F3A2A",
  onDeep: "#FAF6EE",
  clay: "#B0764E",
  danger: "#B5564B",
  auroraMint: "rgba(62,107,78,0.06)",
  auroraClay: "rgba(176,118,78,0.05)",
  glow: { shadowColor: "#1F3A2A", shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.22, shadowRadius: 12, elevation: 5 },
};

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
  const intro = useRef(new Animated.Value(0)).current;
  const sentScale = useRef(new Animated.Value(0.9)).current;

  const bothPremium = userIsPremium && targetPremium;
  const chosenTitle = mode === "exercise" ? exercise?.title : title.trim();
  const chosenMinutes = mode === "exercise" ? exercise?.minutes : Math.max(1, Math.min(600, Number(minutes) || 20));
  const canSend = !!chosenTitle && !sending;
  const stake = STAKES[type] || STAKES.compete;

  useEffect(() => {
    Animated.spring(intro, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 180, mass: 0.8 }).start();
  }, [intro]);

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

  // Drag-down-to-dismiss, attached to the header only so it never fights the
  // body ScrollView for vertical gestures.
  const slideY = useRef(new Animated.Value(0)).current;
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

  const introY = intro.interpolate({ inputRange: [0, 1], outputRange: [36, 0] });
  const fieldKicker = { fontFamily: FF.kicker, fontSize: 9, color: th.faint, letterSpacing: 2.4, marginBottom: 10 };
  const cardDivider = { height: 1, backgroundColor: th.hairline, marginVertical: 18 };

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 500 }]}>
      {/* Dimmed grove behind; tap to dismiss */}
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(11,26,17,0.45)" }]} onPress={onClose} />

      <Animated.View style={{
        flex: 1, marginTop: 40,
        opacity: intro,
        transform: [{ translateY: Animated.add(introY, slideY) }],
        borderTopLeftRadius: 30, borderTopRightRadius: 30,
        overflow: "hidden",
        backgroundColor: th.bg,
        borderWidth: 1, borderColor: th.border,
        shadowColor: "#000", shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.2, shadowRadius: 24, elevation: 18,
      }}>
        {/* Aurora pools */}
        <View pointerEvents="none" style={{
          position: "absolute", top: -120, right: -90,
          width: 300, height: 300, borderRadius: 150,
          backgroundColor: th.auroraMint,
        }} />
        <View pointerEvents="none" style={{
          position: "absolute", bottom: -130, left: -100,
          width: 280, height: 280, borderRadius: 140,
          backgroundColor: th.auroraClay,
        }} />

        {sent && (
          <Animated.View pointerEvents="none" style={{
            position: "absolute", top: 18, alignSelf: "center", zIndex: 20,
            borderRadius: 16, paddingHorizontal: 16, paddingVertical: 9,
            backgroundColor: th.deep, transform: [{ scale: sentScale }],
          }}>
            <Text style={{ color: th.onDeep, fontFamily: FF.bodyMed, fontSize: 13 }}>Sent</Text>
          </Animated.View>
        )}

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          {/* Header — grab handle + editorial title; drag down here to close */}
          <View {...panResponder.panHandlers} style={{ paddingHorizontal: 22, paddingTop: 12, paddingBottom: 4 }}>
            <View style={{
              width: 38, height: 4, borderRadius: 2, alignSelf: "center",
              backgroundColor: th.border, marginBottom: 14,
            }} />
            <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
              <View style={{ flex: 1 }}>
                <Text style={fieldKicker}>
                  {type === "dare" ? "SEND A DARE" : "SEND A CHALLENGE"}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ fontFamily: FF.display, fontSize: 32, color: th.ink, letterSpacing: -0.4 }}
                >
                  @{target.username}
                </Text>
              </View>
              <TouchableOpacity
                onPress={onClose}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={{
                  width: 36, height: 36, borderRadius: 18, marginTop: 4,
                  alignItems: "center", justifyContent: "center",
                  backgroundColor: th.ghost,
                }}
              >
                <Text style={{ fontSize: 20, color: th.mid, lineHeight: 23 }}>×</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 12, paddingBottom: 16 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Composed card — type, kind, and the challenge itself */}
            <View style={{
              backgroundColor: th.card,
              borderRadius: 26,
              borderWidth: 1,
              borderColor: th.border,
              padding: 20,
              overflow: "hidden",
            }}>
              {/* Type */}
              <Text style={fieldKicker}>TYPE</Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                {[
                  { id: "compete", label: "Compete", sub: "first done wins" },
                  { id: "dare", label: "Dare", sub: "finish before midnight" },
                ].map(m => {
                  const active = type === m.id;
                  return (
                    <TouchableOpacity
                      key={m.id}
                      onPress={() => setType(m.id)}
                      activeOpacity={0.8}
                      style={{
                        flex: 1, padding: 13, borderRadius: 16,
                        borderWidth: 1.2,
                        borderColor: active ? th.sage : th.border,
                        backgroundColor: active ? th.wash : "transparent",
                      }}
                    >
                      <Text style={{ color: active ? th.sage : th.ink, fontFamily: FF.bodyMed, fontSize: 14 }}>{m.label}</Text>
                      <Text style={{ color: th.mid, fontFamily: FF.body, fontSize: 11, marginTop: 2 }}>{m.sub}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={cardDivider} />

              {/* Exercise / Custom segment */}
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
                {[
                  ["exercise", "Exercise"],
                  ["custom", "Custom"],
                ].map(([id, label]) => {
                  const active = mode === id;
                  return (
                    <TouchableOpacity
                      key={id}
                      onPress={() => setMode(id)}
                      activeOpacity={0.8}
                      style={{
                        paddingVertical: 9, paddingHorizontal: 16, borderRadius: 999,
                        borderWidth: 1.2,
                        borderColor: active ? th.sage : th.border,
                        backgroundColor: active ? th.wash : "transparent",
                      }}
                    >
                      <Text style={{ color: active ? th.sage : th.mid, fontFamily: FF.bodyMed, fontSize: 13 }}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {mode === "exercise" ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  {CHALLENGE_OPTIONS.map(opt => {
                    const active = exercise?.id === opt.id;
                    const live = POSE_EXERCISE_IDS.has(opt.id);
                    return (
                      <TouchableOpacity
                        key={opt.id}
                        onPress={() => setExercise(opt)}
                        activeOpacity={0.8}
                        style={{
                          width: "47.5%", flexGrow: 1,
                          padding: 13, borderRadius: 16,
                          borderWidth: 1.2,
                          borderColor: active ? th.sage : th.border,
                          backgroundColor: active ? th.washStrong : th.card2,
                        }}
                      >
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                          <opt.Icon size={20} color={active ? th.sage : th.mid} />
                          {live && (
                            <View style={{
                              flexDirection: "row", alignItems: "center", gap: 4,
                              paddingVertical: 3, paddingHorizontal: 7, borderRadius: 999,
                              backgroundColor: active ? th.wash : th.ghost,
                            }}>
                              <CameraIcon size={9} color={th.sage} />
                              <Text style={{ fontFamily: FF.kicker, fontSize: 7, color: th.sage, letterSpacing: 1 }}>
                                LIVE
                              </Text>
                            </View>
                          )}
                        </View>
                        <Text numberOfLines={1} style={{
                          fontFamily: FF.bodyMed, fontSize: 13,
                          color: active ? th.sage : th.ink, marginTop: 8,
                        }}>
                          {opt.label}
                        </Text>
                        <Text numberOfLines={1} style={{ fontFamily: FF.body, fontSize: 11, color: th.mid, marginTop: 2 }}>
                          {opt.reps ? `${opt.reps} reps` : `${opt.secs >= 120 ? `${Math.round(opt.secs / 60)} min` : `${opt.secs}s`}`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : (
                <View style={{ gap: 10 }}>
                  <TextInput
                    style={{
                      backgroundColor: th.sand, color: th.ink,
                      borderWidth: 1.2, borderColor: title.trim() ? th.sage : "transparent",
                      borderRadius: 16, paddingVertical: 13, paddingHorizontal: 15,
                      fontFamily: FF.bodyMed, fontSize: 14,
                    }}
                    value={title}
                    onChangeText={setTitle}
                    placeholder={type === "dare" ? "Dare title" : "Competition title"}
                    placeholderTextColor={th.faint}
                    maxLength={80}
                  />
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <TextInput
                      style={{
                        flex: 0.45,
                        backgroundColor: th.sand, color: th.ink,
                        borderRadius: 16, paddingVertical: 13, paddingHorizontal: 15,
                        fontFamily: FF.body, fontSize: 14,
                      }}
                      value={minutes}
                      onChangeText={setMinutes}
                      placeholder="Minutes"
                      placeholderTextColor={th.faint}
                      keyboardType="number-pad"
                      maxLength={4}
                    />
                    <TextInput
                      style={{
                        flex: 1,
                        backgroundColor: th.sand, color: th.ink,
                        borderRadius: 16, paddingVertical: 13, paddingHorizontal: 15,
                        fontFamily: FF.body, fontSize: 14,
                      }}
                      value={rules}
                      onChangeText={setRules}
                      placeholder={type === "dare" ? "What they must do" : "Rules or proof needed"}
                      placeholderTextColor={th.faint}
                      maxLength={140}
                    />
                  </View>
                </View>
              )}
            </View>

            {/* Stakes — the deal, stated plainly */}
            <View style={{
              marginTop: 14,
              flexDirection: "row", alignItems: "center", gap: 12,
              padding: 16, borderRadius: 18,
              backgroundColor: th.card,
              borderWidth: 1, borderColor: th.border,
            }}>
              <View style={{
                width: 34, height: 34, borderRadius: 17,
                alignItems: "center", justifyContent: "center",
                backgroundColor: th.wash,
              }}>
                <LeafGlyph size={16} color={th.sage} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: FF.bodyMed, fontSize: 13, color: th.ink }}>
                  {type === "dare"
                    ? `Done before midnight earns +${stake.xp} XP`
                    : `First to finish wins +${stake.xp} XP`}
                </Text>
                <Text style={{ fontFamily: FF.body, fontSize: 12, color: th.mid, marginTop: 2, lineHeight: 17 }}>
                  {type === "dare"
                    ? `Missing the deadline costs ${stake.penaltyMins} minutes of screen time.`
                    : `The loser gives up ${stake.penaltyMins} minutes of screen time.`}
                </Text>
              </View>
            </View>

            {/* Verification note */}
            <View style={{
              marginTop: 10,
              flexDirection: "row", alignItems: "center", gap: 12,
              padding: 16, borderRadius: 18,
              backgroundColor: th.card,
              borderWidth: 1, borderColor: th.border,
            }}>
              <View style={{
                width: 34, height: 34, borderRadius: 17,
                alignItems: "center", justifyContent: "center",
                backgroundColor: th.wash,
              }}>
                {mode === "custom" && bothPremium
                  ? <SparkleIcon size={16} color={th.sage} />
                  : mode === "exercise" && POSE_EXERCISE_IDS.has(exercise?.id)
                    ? <CameraIcon size={16} color={th.sage} />
                    : type === "dare"
                      ? <WarnIcon size={16} color={th.clay} />
                      : <SpeakerIcon size={16} color={th.sage} />}
              </View>
              <Text style={{ flex: 1, fontFamily: FF.body, fontSize: 12, color: th.mid, lineHeight: 18 }}>
                {mode === "exercise"
                  ? POSE_EXERCISE_IDS.has(exercise?.id)
                    ? "Verified live — the camera watches the movement and counts every rep automatically."
                    : "Verified with a photo when the exercise is done."
                  : bothPremium
                    ? "Both accounts have Pro, so completion uses AI Check."
                    : "Custom challenges send normally. AI verification turns on when both users have Pro."}
              </Text>
            </View>

            {!!errorMsg && (
              <View style={{
                marginTop: 10, padding: 12, borderRadius: 14,
                backgroundColor: dark ? "rgba(239,162,147,0.13)" : "rgba(181,86,75,0.10)",
                borderWidth: 1,
                borderColor: dark ? "rgba(239,162,147,0.26)" : "rgba(181,86,75,0.22)",
              }}>
                <Text style={{ color: th.danger, fontFamily: FF.body, fontSize: 12, textAlign: "center" }}>
                  {errorMsg}
                </Text>
              </View>
            )}
          </ScrollView>

          {/* Bottom dock — Send in thumb reach */}
          <View style={{ paddingHorizontal: 22, paddingTop: 8, paddingBottom: Platform.OS === "ios" ? 26 : 14 }}>
            <TouchableOpacity
              onPress={send}
              disabled={!canSend || sending}
              activeOpacity={0.85}
              style={[
                {
                  height: 54, borderRadius: 18,
                  alignItems: "center", justifyContent: "center",
                  flexDirection: "row", gap: 9,
                  backgroundColor: canSend ? th.deep : th.ghost,
                  opacity: sending ? 0.7 : 1,
                },
                canSend && !sending && th.glow,
              ]}
            >
              {sending
                ? <ActivityIndicator color={th.onDeep} size="small" />
                : canSend && <LeafGlyph size={15} color={th.onDeep} />}
              <Text style={{
                fontFamily: FF.bodyMed, fontSize: 15, letterSpacing: 0.2,
                color: canSend ? th.onDeep : th.faint,
              }}>
                {sending
                  ? "Sending…"
                  : canSend
                    ? (type === "dare" ? "Send dare" : "Send challenge")
                    : "Name your challenge first"}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Animated.View>
    </View>
  );
}
