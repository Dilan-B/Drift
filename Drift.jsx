import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, TouchableOpacity, TextInput, ScrollView,
  StyleSheet, SafeAreaView, KeyboardAvoidingView,
  StatusBar, Platform,
} from "react-native";

// ── Design tokens ────────────────────────────────────────────
const ink = {
  void: "#16120E", deep: "#1E1B15", mid: "#8A7E70",
  faint: "#BFB5A6", ghost: "rgba(30,27,21,0.08)", border: "rgba(30,27,21,0.12)",
};
const paper = { warm: "#F0EBE0", card: "#FBF8F2" };
const earn = {
  terra: "#D4622A", terraLo: "#F7E6DC",
  green: "#3A7D52", greenLo: "#DCF0E6", greenD: "#275C3B",
};
const FD = "Georgia";   // iOS: Georgia; Android: system serif fallback
const FB = undefined;   // system default sans-serif on all platforms

// ── Data constants ───────────────────────────────────────────
const CATS = {
  work:     { e: "💼", c: "#3A6EA8", l: "Work" },
  physical: { e: "💪", c: "#3A7D52", l: "Physical" },
  outdoor:  { e: "🌿", c: "#4A8040", l: "Outdoor" },
  learning: { e: "📚", c: "#6B5EA8", l: "Learning" },
  life:     { e: "🏠", c: "#8A6040", l: "Life" },
  social:   { e: "💬", c: "#D4622A", l: "Social" },
};

const EFFORT = [
  { id: 1, label: "Light",    mult: 1.0, desc: "Quick task, easy admin, low exertion" },
  { id: 2, label: "Moderate", mult: 1.5, desc: "Focused work, gym, cooking, studying" },
  { id: 3, label: "Intense",  mult: 2.0, desc: "Hard workout, deep sprint, long outdoor" },
];

const CHALLENGES = [
  { id: "pushups", title: "10 pushups",         emoji: "💪", type: "reps",  goal: 10,   desc: "Drop and do 10" },
  { id: "walk",    title: "5 min walk outside",  emoji: "🚶", type: "timer", secs: 300,  desc: "Get outside, move your legs" },
  { id: "squats",  title: "20 squats",           emoji: "🏋️", type: "reps",  goal: 20,   desc: "Full depth counts" },
  { id: "work",    title: "25 min work session", emoji: "💼", type: "timer", secs: 1500, desc: "Lock in and focus" },
  { id: "stretch", title: "3 min stretch",       emoji: "🧘", type: "timer", secs: 180,  desc: "Full body, take your time" },
  { id: "jacks",   title: "30 jumping jacks",    emoji: "⚡", type: "reps",  goal: 30,   desc: "Get that heart rate up" },
];

const LEVELS = [
  { name: "Seedling",   min: 0,    e: "🌱" },
  { name: "Sprout",     min: 150,  e: "🌿" },
  { name: "Sapling",    min: 400,  e: "🌳" },
  { name: "Grove",      min: 900,  e: "🏕️" },
  { name: "Canopy",     min: 2000, e: "🌲" },
  { name: "Forest",     min: 4000, e: "🌾" },
  { name: "Old Growth", min: 8000, e: "🏔️" },
];

const DEMO_TASKS = [
  { id: "d1", title: "Finish the Q2 report",  cat: "work",     effort: 2, minutes: 60, done: true,  credits: 90, xp: 35 },
  { id: "d2", title: "Morning gym session",   cat: "physical", effort: 3, minutes: 45, done: true,  credits: 90, xp: 42 },
  { id: "d3", title: "Review pull requests",  cat: "work",     effort: 1, minutes: 30, done: false, credits: 30, xp: 22 },
  { id: "d4", title: "Walk to get lunch",     cat: "outdoor",  effort: 1, minutes: 20, done: false, credits: 20, xp: 17 },
  { id: "d5", title: "Call mom",              cat: "social",   effort: 1, minutes: 30, done: false, credits: 30, xp: 22 },
];

// ── Helpers ──────────────────────────────────────────────────
const calcCredits = (mins, effort) => Math.round(mins * (EFFORT.find(e => e.id === effort)?.mult || 1));
const calcXp      = (mins, effort) => Math.round(mins * (EFFORT.find(e => e.id === effort)?.mult || 1) * 0.45 + 8);
const fmtMins = m => m <= 0 ? "0m" : m < 60 ? `${m}m` : m % 60 > 0 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}h`;
const fmtSecs = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const getLevel  = xp => [...LEVELS].reverse().find(l => xp >= l.min) || LEVELS[0];
const xpProg    = xp => { const lv = getLevel(xp); const ni = LEVELS.findIndex(l => l.min > xp); if (ni === -1) return 1; return (xp - lv.min) / (LEVELS[ni].min - lv.min); };
const xpToNext  = xp => { const ni = LEVELS.findIndex(l => l.min > xp); return ni === -1 ? 0 : LEVELS[ni].min - xp; };
const todayKey  = () => new Date().toISOString().slice(0, 10);
const clockStr  = () => new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

// ── Storage (in-memory) ──────────────────────────────────────
const _store = {};
const storage = {
  get: async (key) => ({ value: _store[key] ?? null }),
  set: async (key, value) => { _store[key] = value; },
};

// ── Credit Ticker ────────────────────────────────────────────
function CreditTicker({ value }) {
  const prevRef = useRef(value);
  const [show, setShow] = useState(value);
  const animRef = useRef(null);
  useEffect(() => {
    if (value === prevRef.current) return;
    if (animRef.current) clearInterval(animRef.current);
    const start = prevRef.current, diff = value - start;
    const steps = Math.min(Math.abs(diff), 18);
    let step = 0;
    animRef.current = setInterval(() => {
      step++;
      const cur = Math.round(start + diff * (step / steps));
      setShow(cur); prevRef.current = cur;
      if (step >= steps) { clearInterval(animRef.current); setShow(value); prevRef.current = value; }
    }, 40);
    return () => { if (animRef.current) clearInterval(animRef.current); };
  }, [value]);
  return (
    <Text style={{ fontFamily: FD, fontSize: 46, color: "#F0E8D8", fontWeight: "300", lineHeight: 54 }}>
      {fmtMins(show)}
    </Text>
  );
}

// ── Morning Gate ─────────────────────────────────────────────
function MorningGate({ skips, onUnlock, onPay }) {
  const [chosen, setChosen] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [running, setRunning] = useState(false);
  const [clock, setClock] = useState(clockStr());
  const [repsLeft, setRepsLeft] = useState(0);
  const [done, setDone] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    const i = setInterval(() => setClock(clockStr()), 1000);
    return () => clearInterval(i);
  }, []);
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const pick = ch => {
    setChosen(ch);
    if (ch.type === "timer") setCountdown(ch.secs);
    if (ch.type === "reps")  setRepsLeft(ch.goal);
  };

  const startTimer = () => {
    setRunning(true);
    timerRef.current = setInterval(() => {
      setCountdown(p => {
        if (p <= 1) { clearInterval(timerRef.current); setRunning(false); setDone(true); setTimeout(onUnlock, 1400); return 0; }
        return p - 1;
      });
    }, 1000);
  };

  const doRep = () => {
    const next = repsLeft - 1;
    setRepsLeft(next);
    if (next <= 0) { setDone(true); setTimeout(onUnlock, 1400); }
  };

  const back = () => {
    setChosen(null); setCountdown(null); setRunning(false); setRepsLeft(0); setDone(false);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  if (done) return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: earn.green, alignItems: "center", justifyContent: "center" }]}>
      <Text style={{ fontSize: 72, marginBottom: 16 }}>✅</Text>
      <Text style={{ fontFamily: FD, fontSize: 26, color: "#fff", fontStyle: "italic" }}>Unlocked</Text>
      <Text style={{ fontFamily: FB, fontSize: 14, color: "rgba(255,255,255,0.7)", marginTop: 6 }}>
        You earned your screen time.
      </Text>
    </View>
  );

  if (chosen) return (
    <View style={{ flex: 1, backgroundColor: ink.void, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <StatusBar barStyle="light-content" />
      <TouchableOpacity onPress={back} style={{ position: "absolute", top: 60, left: 20, flexDirection: "row", alignItems: "center", gap: 5 }}>
        <Text style={{ fontFamily: FB, fontSize: 13, color: "#5A4838" }}>← Back</Text>
      </TouchableOpacity>

      <Text style={{ fontSize: 64, marginBottom: 16 }}>{chosen.emoji}</Text>
      <Text style={{ fontFamily: FD, fontSize: 24, color: "#F0E8D8", fontStyle: "italic", marginBottom: 6 }}>{chosen.title}</Text>
      <Text style={{ fontFamily: FB, fontSize: 13, color: "#6A5848", marginBottom: 32, textAlign: "center" }}>{chosen.desc}</Text>

      {chosen.type === "timer" && countdown !== null && (
        <View style={{ alignItems: "center" }}>
          <View style={{
            width: 140, height: 140, borderRadius: 70,
            borderWidth: 4, borderColor: countdown === 0 ? earn.green : "rgba(255,255,255,0.1)",
            alignItems: "center", justifyContent: "center", marginBottom: 24,
          }}>
            <Text style={{ fontFamily: FD, fontSize: 36, color: countdown === 0 ? earn.green : "#F0E8D8", fontWeight: "300" }}>
              {countdown === 0 ? "✓" : fmtSecs(countdown)}
            </Text>
          </View>
          {!running && countdown > 0 && (
            <TouchableOpacity onPress={startTimer} style={{ paddingVertical: 14, paddingHorizontal: 32, borderRadius: 14, backgroundColor: earn.terra }}>
              <Text style={{ fontFamily: FB, fontWeight: "600", fontSize: 15, color: "#fff" }}>Start timer</Text>
            </TouchableOpacity>
          )}
          {running && (
            <Text style={{ fontFamily: FB, fontSize: 12, color: "#4A3020", marginTop: 12 }}>
              Timer running — stay off your phone
            </Text>
          )}
        </View>
      )}

      {chosen.type === "reps" && (
        <View style={{ alignItems: "center" }}>
          <View style={{
            width: 140, height: 140, borderRadius: 70,
            borderWidth: 4, borderColor: repsLeft <= 0 ? earn.green : earn.terra,
            alignItems: "center", justifyContent: "center", marginBottom: 24,
          }}>
            <Text style={{ fontFamily: FD, fontSize: 42, color: "#F0E8D8", fontWeight: "300", lineHeight: 46 }}>{repsLeft}</Text>
            <Text style={{ fontFamily: FB, fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>remaining</Text>
          </View>
          <TouchableOpacity
            onPress={doRep}
            disabled={repsLeft <= 0}
            style={{ paddingVertical: 14, paddingHorizontal: 32, borderRadius: 14, backgroundColor: earn.green, opacity: repsLeft <= 0 ? 0.4 : 1 }}
          >
            <Text style={{ fontFamily: FB, fontWeight: "600", fontSize: 15, color: "#fff" }}>✓ I did one — count it</Text>
          </TouchableOpacity>
          <Text style={{ fontFamily: FB, fontSize: 11, color: "#3A2A18", marginTop: 12, textAlign: "center" }}>
            Honor system for now. AI camera tracking coming soon.
          </Text>
        </View>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: "#141008", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        style={{ width: "100%" }}
        contentContainerStyle={{ alignItems: "center", paddingVertical: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ width: "100%", maxWidth: 400 }}>
          <View style={{ marginBottom: 44, alignItems: "center" }}>
            <Text style={{ fontFamily: FD, fontSize: 48, color: "#F0E8D8", fontWeight: "300", letterSpacing: -1, lineHeight: 56, marginBottom: 10 }}>
              {clock}
            </Text>
            <Text style={{ fontFamily: FD, fontSize: 22, color: "rgba(240,232,216,0.7)", fontStyle: "italic", fontWeight: "300", marginBottom: 6 }}>
              Your phone is locked.
            </Text>
            <Text style={{ fontFamily: FB, fontSize: 13, color: "#5A4838", lineHeight: 21, textAlign: "center" }}>
              Complete a challenge to earn your screen time.
            </Text>
          </View>

          <View style={{ gap: 8, marginBottom: 22 }}>
            {CHALLENGES.map(ch => (
              <TouchableOpacity
                key={ch.id}
                onPress={() => pick(ch)}
                style={{
                  flexDirection: "row", alignItems: "center", gap: 12,
                  paddingVertical: 13, paddingHorizontal: 16,
                  backgroundColor: "rgba(255,255,255,0.055)",
                  borderWidth: 0.5, borderColor: "rgba(255,255,255,0.09)", borderRadius: 12,
                }}
              >
                <Text style={{ fontSize: 24, width: 32, textAlign: "center" }}>{ch.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: FB, fontSize: 14, fontWeight: "600", color: "#F0E8D8", marginBottom: 2 }}>{ch.title}</Text>
                  <Text style={{ fontFamily: FB, fontSize: 11, color: "#5A4838" }}>{ch.desc}</Text>
                </View>
                <Text style={{ color: "#4A3A28", fontSize: 18 }}>›</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={{ height: 0.5, backgroundColor: "rgba(255,255,255,0.07)", marginBottom: 18 }} />

          <TouchableOpacity
            onPress={onPay}
            style={{
              width: "100%", padding: 13, borderRadius: 12,
              borderWidth: 0.5, borderColor: "rgba(212,98,42,0.35)",
              backgroundColor: "rgba(212,98,42,0.1)",
            }}
          >
            <Text style={{ fontFamily: FB, fontWeight: "600", fontSize: 14, color: earn.terra, textAlign: "center" }}>
              Pay $0.25 to skip
            </Text>
          </TouchableOpacity>

          {skips > 0 && (
            <Text style={{ fontFamily: FB, fontSize: 11, color: "#4A3020", marginTop: 10, textAlign: "center" }}>
              ${(skips * 0.25).toFixed(2)} paid this week ({skips}×){skips >= 5 ? " 🤔" : ""}
            </Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// ── Add Task Overlay ─────────────────────────────────────────
function AddTaskOverlay({ onSave, onClose }) {
  const [title, setTitle] = useState("");
  const [cat, setCat] = useState("work");
  const [effort, setEffort] = useState(1);
  const [mins, setMins] = useState(30);
  const preview   = calcCredits(mins, effort);
  const xpPreview = calcXp(mins, effort);

  useEffect(() => {
    if (title.length < 4) return;
    const lo = title.toLowerCase();
    const minM = title.match(/(\d+)\s*(?:min|m\b)/i);
    const hrM  = title.match(/(\d+)\s*(?:hr|h\b)/i);
    if (minM) setMins(parseInt(minM[1]));
    else if (hrM) setMins(parseInt(hrM[1]) * 60);
    if      (/gym|run|push|squat|lift|workout|swim|yoga/i.test(lo)) setCat("physical");
    else if (/walk|outside|park|hike|garden/i.test(lo))             setCat("outdoor");
    else if (/work|meeting|email|report|code|call|zoom/i.test(lo))  setCat("work");
    else if (/read|study|learn|book|practice/i.test(lo))            setCat("learning");
    else if (/friend|dinner|date|mom|dad|drinks/i.test(lo))         setCat("social");
  }, [title]);

  const save = () => {
    if (!title.trim()) return;
    onSave({
      id: `t_${Date.now()}`, title: title.trim(), cat, effort, minutes: mins,
      done: false, credits: calcCredits(mins, effort), xp: calcXp(mins, effort),
    });
    onClose();
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: paper.warm }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* Header */}
      <View style={{
        flexDirection: "row", alignItems: "center",
        paddingVertical: 14, paddingHorizontal: 20,
        backgroundColor: paper.card,
        borderBottomWidth: 0.5, borderBottomColor: ink.border,
      }}>
        <TouchableOpacity onPress={onClose} style={{ marginRight: 12 }}>
          <Text style={{ fontSize: 22, color: ink.mid, lineHeight: 26 }}>×</Text>
        </TouchableOpacity>
        <Text style={{ fontFamily: FD, fontSize: 17, color: ink.deep, fontStyle: "italic", flex: 1 }}>Add task</Text>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <View style={{ backgroundColor: earn.greenLo, borderRadius: 8, paddingVertical: 3, paddingHorizontal: 10 }}>
            <Text style={{ fontFamily: FB, fontSize: 11, fontWeight: "600", color: earn.greenD }}>+{fmtMins(preview)}</Text>
          </View>
          <View style={{ backgroundColor: earn.terraLo, borderRadius: 8, paddingVertical: 3, paddingHorizontal: 10 }}>
            <Text style={{ fontFamily: FB, fontSize: 11, fontWeight: "600", color: earn.terra }}>+{xpPreview} XP</Text>
          </View>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
        {/* Preview */}
        <View style={{ alignItems: "center", padding: 14, backgroundColor: earn.greenLo, borderRadius: 12, marginBottom: 12 }}>
          <Text style={{ fontFamily: FD, fontSize: 34, color: earn.greenD, fontWeight: "300" }}>{fmtMins(preview)}</Text>
          <Text style={{ fontFamily: FB, fontSize: 12, color: earn.greenD, marginTop: 2 }}>screen time earned</Text>
        </View>

        {/* Title */}
        <View style={{ marginBottom: 14 }}>
          <Text style={s.label}>What needs doing?</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder='e.g. "30 min gym" or "finish report"'
            placeholderTextColor={ink.faint}
            onSubmitEditing={save}
            returnKeyType="done"
            style={{
              padding: 11, paddingHorizontal: 14, borderRadius: 10,
              borderWidth: 1, borderColor: ink.border,
              fontFamily: FB, fontSize: 14,
              backgroundColor: "rgba(255,255,255,0.7)", color: ink.deep,
            }}
          />
        </View>

        {/* Category */}
        <View style={{ marginBottom: 14 }}>
          <Text style={s.label}>Category</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
            {Object.entries(CATS).map(([k, v]) => (
              <TouchableOpacity
                key={k}
                onPress={() => setCat(k)}
                style={{
                  paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20,
                  borderWidth: 1.5,
                  borderColor: cat === k ? v.c : ink.border,
                  backgroundColor: cat === k ? `${v.c}14` : "transparent",
                }}
              >
                <Text style={{ fontFamily: FB, fontSize: 11, fontWeight: cat === k ? "600" : "400", color: cat === k ? v.c : ink.mid }}>
                  {v.e} {v.l}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Duration */}
        <View style={{ marginBottom: 14 }}>
          <Text style={s.label}>Duration</Text>
          <View style={{ flexDirection: "row", gap: 7 }}>
            {[15, 30, 45, 60, 90, 120].map(d => (
              <TouchableOpacity
                key={d}
                onPress={() => setMins(d)}
                style={{
                  flex: 1, paddingVertical: 9, borderRadius: 10,
                  borderWidth: 1.5,
                  borderColor: mins === d ? earn.terra : ink.border,
                  backgroundColor: mins === d ? earn.terraLo : "transparent",
                }}
              >
                <Text style={{ fontFamily: FB, fontSize: 12, fontWeight: mins === d ? "600" : "400", color: mins === d ? earn.terra : ink.mid, textAlign: "center" }}>
                  {d < 60 ? `${d}m` : `${d / 60}h`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Effort */}
        <View style={{ marginBottom: 24 }}>
          <Text style={s.label}>Effort <Text style={{ fontWeight: "400", textTransform: "none", letterSpacing: 0, fontSize: 10 }}>— determines payout</Text></Text>
          <View style={{ gap: 7 }}>
            {EFFORT.map(e => (
              <TouchableOpacity
                key={e.id}
                onPress={() => setEffort(e.id)}
                style={{
                  flexDirection: "row", alignItems: "center", gap: 12,
                  paddingVertical: 11, paddingHorizontal: 14, borderRadius: 10,
                  borderWidth: 1.5,
                  borderColor: effort === e.id ? earn.green : ink.border,
                  backgroundColor: effort === e.id ? earn.greenLo : "transparent",
                }}
              >
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: effort === e.id ? earn.green : ink.ghost, flexShrink: 0 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: FB, fontSize: 13, fontWeight: "600", color: effort === e.id ? earn.green : ink.deep, marginBottom: 2 }}>
                    {e.label}{" "}
                    <Text style={{ fontWeight: "400", color: ink.faint }}>{e.mult}×</Text>
                  </Text>
                  <Text style={{ fontFamily: FB, fontSize: 11, color: ink.mid }}>{e.desc}</Text>
                </View>
                {effort === e.id && (
                  <Text style={{ fontFamily: FB, fontSize: 12, fontWeight: "600", color: earn.green }}>
                    +{fmtMins(calcCredits(mins, e.id))}
                  </Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity
          onPress={save}
          disabled={!title.trim()}
          style={{ paddingVertical: 14, borderRadius: 14, backgroundColor: title.trim() ? earn.terra : ink.faint }}
        >
          <Text style={{ fontFamily: FB, fontWeight: "600", fontSize: 15, color: "#fff", textAlign: "center" }}>
            Add task — earn {fmtMins(preview)} screen time
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Today View ───────────────────────────────────────────────
function TodayView({ tasks, credits, totalXp, onComplete, onAdd, onSimSpend }) {
  const pending       = tasks.filter(t => !t.done);
  const done          = tasks.filter(t => t.done);
  const unlocked      = credits.balance > 0;
  const lv            = getLevel(totalXp);
  const stillEarnable = pending.reduce((s, t) => s + t.credits, 0);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
      {/* Credit bank */}
      <View style={{
        borderRadius: 16, padding: 20, marginBottom: 12,
        backgroundColor: unlocked ? earn.greenD : "#1C1408",
        overflow: "hidden",
      }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View>
            <Text style={{
              fontFamily: FB, fontSize: 11, fontWeight: "600",
              color: unlocked ? "rgba(255,255,255,0.55)" : "#4A3020",
              textTransform: "uppercase", letterSpacing: 1, marginBottom: 6,
            }}>
              {unlocked ? "Screen time balance" : "No time earned yet"}
            </Text>
            <CreditTicker value={credits.balance} />
            <Text style={{ fontFamily: FB, fontSize: 12, color: unlocked ? "rgba(255,255,255,0.5)" : "#4A3020", marginTop: 4 }}>
              {unlocked ? "Available now" : "Complete a task below"}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: 28 }}>{unlocked ? "🔓" : "🔒"}</Text>
            <View style={{ backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 8, paddingVertical: 3, paddingHorizontal: 10, marginTop: 6 }}>
              <Text style={{ fontFamily: FB, fontSize: 10, fontWeight: "600", color: unlocked ? "rgba(255,255,255,0.65)" : "#4A3020" }}>
                {lv.e} {lv.name}
              </Text>
            </View>
          </View>
        </View>

        {credits.earned > 0 && (
          <View style={{ flexDirection: "row", gap: 20, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.1)" }}>
            {[["Earned", fmtMins(credits.earned)], ["Used", fmtMins(credits.spent)], stillEarnable > 0 ? ["Earnable", fmtMins(stillEarnable)] : null]
              .filter(Boolean)
              .map(([l, v]) => (
                <View key={l}>
                  <Text style={{ fontFamily: FB, fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 2 }}>{l}</Text>
                  <Text style={{ fontFamily: FD, fontSize: 15, color: "rgba(255,255,255,0.85)", fontWeight: "300" }}>{v}</Text>
                </View>
              ))}
          </View>
        )}
      </View>

      {unlocked && (
        <TouchableOpacity
          onPress={onSimSpend}
          style={{
            padding: 9, borderRadius: 10,
            borderWidth: 1, borderColor: earn.terra,
            backgroundColor: `${earn.terra}14`, marginBottom: 12,
          }}
        >
          <Text style={{ fontFamily: FB, fontWeight: "500", fontSize: 12, color: earn.terra, textAlign: "center" }}>
            📱 Use 10 min of screen time (demo)
          </Text>
        </TouchableOpacity>
      )}

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <Text style={{ fontFamily: FD, fontSize: 18, color: ink.deep, fontStyle: "italic" }}>Today's work</Text>
        <TouchableOpacity
          onPress={onAdd}
          style={{
            flexDirection: "row", alignItems: "center", gap: 5,
            paddingVertical: 5, paddingHorizontal: 13,
            borderRadius: 20, borderWidth: 1.5, borderColor: earn.terra,
            backgroundColor: earn.terraLo,
          }}
        >
          <Text style={{ fontFamily: FB, fontWeight: "600", fontSize: 11, color: earn.terra }}>+ Add task</Text>
        </TouchableOpacity>
      </View>

      {tasks.length === 0 && (
        <View style={{ alignItems: "center", paddingVertical: 36 }}>
          <Text style={{ fontSize: 36, marginBottom: 10 }}>📋</Text>
          <Text style={{ fontFamily: FD, fontSize: 17, color: ink.mid, fontStyle: "italic", marginBottom: 6 }}>Nothing to earn from yet</Text>
          <Text style={{ fontFamily: FB, fontSize: 13, color: ink.faint }}>Add the work you actually need to do today.</Text>
        </View>
      )}

      {pending.map(t => {
        const cat = CATS[t.cat] || CATS.life;
        return (
          <TouchableOpacity
            key={t.id}
            onPress={() => onComplete(t.id)}
            style={{
              flexDirection: "row", alignItems: "center",
              backgroundColor: paper.card, borderRadius: 16,
              marginBottom: 8, overflow: "hidden",
              borderWidth: 0.5, borderColor: ink.border,
            }}
          >
            <View style={{
              width: 3, backgroundColor: cat.c,
              height: t.effort === 1 ? 24 : t.effort === 2 ? 36 : 48,
              borderRadius: 2, marginLeft: 12, marginRight: 12,
              alignSelf: "center", flexShrink: 0,
            }} />
            <View style={{ flex: 1, paddingVertical: 12 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <Text style={{ fontFamily: FB, fontSize: 14, fontWeight: "500", color: ink.deep, lineHeight: 19, flex: 1 }}>{t.title}</Text>
                <View style={{ backgroundColor: `${cat.c}16`, borderRadius: 6, paddingVertical: 2, paddingHorizontal: 6, marginLeft: 8 }}>
                  <Text style={{ fontSize: 14 }}>{cat.e}</Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Text style={{ fontSize: 11, color: ink.mid }}>{t.minutes}m</Text>
                <View style={{ flexDirection: "row", gap: 3 }}>
                  {[1, 2, 3].map(d => (
                    <View key={d} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: d <= t.effort ? cat.c : ink.ghost }} />
                  ))}
                </View>
                <View style={{ flex: 1, alignItems: "flex-end" }}>
                  <Text style={{ fontSize: 11, fontWeight: "600", color: earn.green }}>+{fmtMins(t.credits)}</Text>
                </View>
              </View>
            </View>
            <View style={{
              width: 28, height: 28, borderRadius: 14,
              borderWidth: 1.5, borderColor: earn.green,
              alignItems: "center", justifyContent: "center",
              marginRight: 14, flexShrink: 0,
            }}>
              <Text style={{ color: earn.green, fontSize: 14 }}>✓</Text>
            </View>
          </TouchableOpacity>
        );
      })}

      {done.length > 0 && (
        <View style={{ marginTop: 10 }}>
          <Text style={{ fontFamily: FB, fontSize: 11, fontWeight: "600", color: ink.faint, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
            Done today
          </Text>
          {done.map(t => {
            const cat = CATS[t.cat] || CATS.life;
            return (
              <View key={t.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: ink.border, opacity: 0.55 }}>
                <Text style={{ fontSize: 18 }}>{cat.e}</Text>
                <Text style={{ flex: 1, fontFamily: FB, fontSize: 13, color: ink.mid, textDecorationLine: "line-through" }}>{t.title}</Text>
                <Text style={{ fontSize: 11, fontWeight: "600", color: earn.green }}>+{fmtMins(t.credits)}</Text>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

// ── Progress View ────────────────────────────────────────────
function ProgressView({ tasks, totalXp, skips }) {
  const lv        = getLevel(totalXp);
  const prog      = xpProg(totalXp);
  const toNext    = xpToNext(totalXp);
  const done      = tasks.filter(t => t.done);
  const catCounts = done.reduce((a, t) => { a[t.cat] = (a[t.cat] || 0) + t.credits; return a; }, {});
  const maxCat    = Math.max(...Object.values(catCounts), 1);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
      {/* Level card */}
      <View style={[s.card, { marginBottom: 12 }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 14 }}>
          <Text style={{ fontSize: 36 }}>{lv.e}</Text>
          <View>
            <Text style={{ fontFamily: FD, fontSize: 20, color: earn.terra, fontStyle: "italic" }}>{lv.name}</Text>
            <Text style={{ fontFamily: FB, fontSize: 12, color: ink.mid }}>{totalXp.toLocaleString()} XP total</Text>
          </View>
        </View>
        {toNext > 0 && (
          <>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 5 }}>
              <Text style={{ fontFamily: FB, fontSize: 11, color: ink.faint }}>Progress to next level</Text>
              <Text style={{ fontFamily: FB, fontSize: 11, color: ink.faint }}>{toNext} XP to go</Text>
            </View>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: ink.ghost, overflow: "hidden" }}>
              <View style={{ height: "100%", width: `${prog * 100}%`, backgroundColor: earn.terra, borderRadius: 4 }} />
            </View>
          </>
        )}
      </View>

      {/* Stats */}
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}>
        {[["Earned", fmtMins(done.reduce((s, t) => s + t.credits, 0))], ["Done", `${done.length}`]].map(([l, v]) => (
          <View key={l} style={[s.card, { flex: 1, alignItems: "center", paddingVertical: 12 }]}>
            <Text style={{ fontFamily: FD, fontSize: 22, color: ink.deep, fontWeight: "300" }}>{v}</Text>
            <Text style={{ fontFamily: FB, fontSize: 10, color: ink.mid, marginTop: 2 }}>{l}</Text>
          </View>
        ))}
      </View>

      {/* Category chart */}
      {Object.keys(catCounts).length > 0 && (
        <View style={[s.card, { marginBottom: 12 }]}>
          <Text style={{ fontFamily: FD, fontSize: 16, color: ink.deep, fontStyle: "italic", marginBottom: 12 }}>Earned by type</Text>
          {Object.entries(catCounts).sort((a, b) => b[1] - a[1]).map(([cat, mins]) => {
            const meta = CATS[cat];
            return (
              <View key={cat} style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <Text style={{ fontSize: 18, width: 26, textAlign: "center" }}>{meta.e}</Text>
                <View style={{ flex: 1, height: 8, backgroundColor: ink.ghost, borderRadius: 4, overflow: "hidden" }}>
                  <View style={{ height: "100%", width: `${(mins / maxCat) * 100}%`, backgroundColor: meta.c, borderRadius: 4 }} />
                </View>
                <Text style={{ fontFamily: FB, fontSize: 11, color: ink.mid, width: 34, textAlign: "right" }}>{fmtMins(mins)}</Text>
              </View>
            );
          })}
        </View>
      )}

      {/* Skips */}
      <View style={{
        backgroundColor: paper.card, borderRadius: 16, padding: 20,
        flexDirection: "row", justifyContent: "space-between", alignItems: "center",
        borderTopWidth: 0.5, borderRightWidth: 0.5, borderBottomWidth: 0.5,
        borderLeftWidth: 3,
        borderTopColor: ink.border, borderRightColor: ink.border,
        borderBottomColor: ink.border, borderLeftColor: skips >= 5 ? "#A32D2D" : earn.terra,
        borderRadius: 16,
      }}>
        <View>
          <Text style={{ fontFamily: FB, fontSize: 13, color: ink.mid, marginBottom: 4 }}>Morning skips this week</Text>
          <Text style={{ fontFamily: FD, fontSize: 32, color: skips >= 5 ? "#A32D2D" : earn.terra, fontWeight: "300" }}>
            ${(skips * 0.25).toFixed(2)}
          </Text>
          <Text style={{ fontFamily: FB, fontSize: 11, color: ink.mid, marginTop: 4 }}>
            {skips === 0 ? "Zero skips. 🔥" : `${skips}× $0.25`}{skips >= 5 ? " — worth rethinking mornings." : ""}
          </Text>
        </View>
        <Text style={{ fontSize: 36 }}>{skips === 0 ? "🔥" : skips >= 5 ? "🤔" : "💰"}</Text>
      </View>
    </ScrollView>
  );
}

// ── Shared styles ────────────────────────────────────────────
const s = StyleSheet.create({
  card: {
    backgroundColor: paper.card,
    borderRadius: 16,
    padding: 20,
    borderWidth: 0.5,
    borderColor: ink.border,
  },
  label: {
    fontFamily: FB,
    fontSize: 11,
    fontWeight: "600",
    color: ink.faint,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
  },
});

// ── Root App ─────────────────────────────────────────────────
const TABS = [{ id: "today", label: "Today" }, { id: "progress", label: "Progress" }];

export default function App() {
  const [screen,  setScreen]  = useState("loading");
  const [tab,     setTab]     = useState("today");
  const [tasks,   setTasks]   = useState([]);
  const [credits, setCredits] = useState({ balance: 0, earned: 0, spent: 0 });
  const [totalXp, setTotalXp] = useState(0);
  const [skips,   setSkips]   = useState(0);
  const [overlay, setOverlay] = useState(null);
  const [popup,   setPopup]   = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await storage.get("drift_v4");
        if (d?.value) {
          const p = JSON.parse(d.value);
          if (p.date !== todayKey()) {
            setTotalXp(p.totalXp || 0); setSkips(0); setScreen("morning");
          } else {
            setTasks(p.tasks || []);
            setCredits(p.credits || { balance: 0, earned: 0, spent: 0 });
            setTotalXp(p.totalXp || 0);
            setSkips(p.skips || 0);
            setScreen(p.morningDone ? "app" : "morning");
          }
        } else setScreen("morning");
      } catch { setScreen("morning"); }
    })();
  }, []);

  const persist = async upd => {
    try {
      await storage.set("drift_v4", JSON.stringify({
        tasks:       upd.tasks       ?? tasks,
        credits:     upd.credits     ?? credits,
        totalXp:     upd.totalXp     ?? totalXp,
        skips:       upd.skips       ?? skips,
        morningDone: upd.morningDone ?? true,
        date:        todayKey(),
      }));
    } catch {}
  };

  const unlock = () => { setScreen("app"); persist({ morningDone: true }); };
  const pay    = () => { const ns = skips + 1; setSkips(ns); setScreen("app"); persist({ morningDone: true, skips: ns }); };

  const loadDemo = () => {
    const dc = { balance: 90, earned: 180, spent: 90 };
    setTasks(DEMO_TASKS); setCredits(dc); setTotalXp(340); setSkips(1); setScreen("app");
    persist({ tasks: DEMO_TASKS, credits: dc, totalXp: 340, skips: 1, morningDone: true });
  };

  const completeTask = id => {
    const task = tasks.find(t => t.id === id);
    if (!task || task.done) return;
    const nt = tasks.map(t => t.id === id ? { ...t, done: true } : t);
    const nc = { balance: credits.balance + task.credits, earned: credits.earned + task.credits, spent: credits.spent };
    const nx = totalXp + task.xp;
    setTasks(nt); setCredits(nc); setTotalXp(nx);
    setPopup({ credits: task.credits, xp: task.xp });
    setTimeout(() => setPopup(null), 2000);
    persist({ tasks: nt, credits: nc, totalXp: nx });
  };

  const addTask  = t => { const nt = [...tasks, t]; setTasks(nt); persist({ tasks: nt }); };
  const simSpend = () => {
    const use = Math.min(10, credits.balance);
    const nc  = { ...credits, balance: credits.balance - use, spent: credits.spent + use };
    setCredits(nc); persist({ credits: nc });
  };

  if (screen === "loading") return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: ink.void }}>
      <StatusBar barStyle="light-content" />
      <Text style={{ fontSize: 44 }}>🔒</Text>
      <Text style={{ fontFamily: FD, fontSize: 22, color: "#F0E8D8", fontStyle: "italic", marginTop: 12 }}>Drift</Text>
    </View>
  );

  if (screen === "morning") return <MorningGate skips={skips} onUnlock={unlock} onPay={pay} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: paper.card }}>
      <StatusBar barStyle="dark-content" />

      {/* XP / credit popup */}
      {popup && (
        <View style={{
          position: "absolute", top: "20%", left: 0, right: 0,
          alignItems: "center", zIndex: 300,
          flexDirection: "row", justifyContent: "center", gap: 8,
          pointerEvents: "none",
        }}>
          <View style={{ backgroundColor: earn.green, borderRadius: 20, paddingVertical: 7, paddingHorizontal: 14 }}>
            <Text style={{ fontFamily: FB, fontWeight: "600", fontSize: 13, color: "#fff" }}>+{fmtMins(popup.credits)} earned</Text>
          </View>
          <View style={{ backgroundColor: earn.terra, borderRadius: 20, paddingVertical: 7, paddingHorizontal: 14 }}>
            <Text style={{ fontFamily: FB, fontWeight: "600", fontSize: 13, color: "#fff" }}>+{popup.xp} XP</Text>
          </View>
        </View>
      )}

      {/* Header */}
      <View style={{
        flexDirection: "row", alignItems: "center",
        paddingHorizontal: 18, height: 52,
        backgroundColor: paper.card,
        borderBottomWidth: 0.5, borderBottomColor: ink.border,
      }}>
        <View style={{
          width: 28, height: 28, borderRadius: 9,
          backgroundColor: credits.balance > 0 ? earn.green : "#1C1408",
          alignItems: "center", justifyContent: "center", marginRight: 8,
        }}>
          <Text style={{ fontSize: 13 }}>{credits.balance > 0 ? "🔓" : "🔒"}</Text>
        </View>
        <Text style={{ fontFamily: FD, fontSize: 17, color: ink.deep, fontStyle: "italic", flex: 1 }}>Drift</Text>
        <View style={{
          backgroundColor: credits.balance > 0 ? earn.greenLo : "#EDE7D8",
          borderRadius: 20, paddingVertical: 3, paddingHorizontal: 10, marginRight: 10,
        }}>
          <Text style={{ fontFamily: FB, fontSize: 11, fontWeight: "600", color: credits.balance > 0 ? earn.greenD : ink.faint }}>
            {credits.balance > 0 ? `${credits.balance}m` : "locked"}
          </Text>
        </View>
        <TouchableOpacity onPress={loadDemo}>
          <Text style={{ fontSize: 10, color: ink.faint }}>demo</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={{ flexDirection: "row", backgroundColor: paper.card, borderBottomWidth: 0.5, borderBottomColor: ink.border }}>
        {TABS.map(t => {
          const active = tab === t.id;
          return (
            <TouchableOpacity
              key={t.id}
              onPress={() => setTab(t.id)}
              style={{ flex: 1, paddingVertical: 10, alignItems: "center", borderBottomWidth: 2, borderBottomColor: active ? earn.terra : "transparent" }}
            >
              <Text style={{ fontFamily: FB, fontSize: 13, fontWeight: active ? "600" : "400", color: active ? ink.deep : ink.mid }}>
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Content */}
      <View style={{ flex: 1, backgroundColor: paper.warm }}>
        {tab === "today"    && <TodayView    tasks={tasks} credits={credits} totalXp={totalXp} onComplete={completeTask} onAdd={() => setOverlay("add")} onSimSpend={simSpend} />}
        {tab === "progress" && <ProgressView tasks={tasks} totalXp={totalXp} skips={skips} />}
      </View>

      {/* Overlay */}
      {overlay && (
        <View style={[StyleSheet.absoluteFill, { zIndex: 200 }]}>
          {overlay === "add" && <AddTaskOverlay onSave={addTask} onClose={() => setOverlay(null)} />}
        </View>
      )}
    </SafeAreaView>
  );
}
