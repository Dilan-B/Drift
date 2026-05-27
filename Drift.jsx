import React, { useState, useEffect, useRef } from "react";
import { CameraView, useCameraPermissions } from "expo-camera";
import {
  View, Text, TouchableOpacity, TextInput, ScrollView,
  StyleSheet, SafeAreaView, KeyboardAvoidingView,
  StatusBar, Platform, BackHandler, Alert, AppState,
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
  { id: "pushups",   title: "10 pushups",              emoji: "💪", type: "reps",  goal: 10,   desc: "Drop and do 10 — full range" },
  { id: "walk",      title: "5 min walk outside",       emoji: "🚶", type: "timer", secs: 300,  desc: "Get outside, move your legs" },
  { id: "squats",    title: "20 squats",                emoji: "🏋️", type: "reps",  goal: 20,   desc: "Full depth counts" },
  { id: "work",      title: "25 min work session",      emoji: "💼", type: "timer", secs: 1500, desc: "Lock in and actually focus" },
  { id: "stretch",   title: "3 min full stretch",       emoji: "🧘", type: "timer", secs: 180,  desc: "Full body — take your time" },
  { id: "jacks",     title: "30 jumping jacks",         emoji: "⚡", type: "reps",  goal: 30,   desc: "Get that heart rate up" },
  { id: "water",     title: "Drink a full glass of water", emoji: "💧", type: "reps", goal: 1,  desc: "Hydrate before you scroll" },
  { id: "journal",   title: "3 things you're grateful for", emoji: "📓", type: "reps", goal: 3, desc: "One sentence each — write it down" },
  { id: "coldwater", title: "60s cold water on your face", emoji: "🚿", type: "timer", secs: 60, desc: "Wake up the hard way" },
  { id: "meditate",  title: "5 min breathing",          emoji: "🌬️", type: "timer", secs: 300,  desc: "Box breathing or just slow breaths" },
  { id: "burpees",   title: "10 burpees",               emoji: "🔥", type: "reps",  goal: 10,   desc: "Full range — no shortcuts" },
  { id: "read",      title: "10 min reading",           emoji: "📚", type: "timer", secs: 600,  desc: "Anything — just not social media" },
  { id: "lunges",    title: "20 lunges",                emoji: "🦵", type: "reps",  goal: 20,   desc: "10 each leg, full depth" },
  { id: "plank",     title: "1 min plank",              emoji: "🏄", type: "timer", secs: 60,   desc: "Core tight, breathe steady" },
  { id: "situps",    title: "15 sit-ups",               emoji: "🤸", type: "reps",  goal: 15,   desc: "Controlled movement, no yanking" },
  { id: "dips",      title: "10 tricep dips",           emoji: "💺", type: "reps",  goal: 10,   desc: "Use your chair or a low surface" },
  { id: "run",       title: "10 min jog or run",        emoji: "🏃", type: "timer", secs: 600,  desc: "Outside or treadmill" },
  { id: "hiit",      title: "2 min HIIT",               emoji: "🌡️", type: "timer", secs: 120,  desc: "Max effort — go all out" },
];

// ── Camera motion scoring ────────────────────────────────────
// Samples 60 evenly-spaced positions in the base64 image data region
// and returns the average absolute character-code difference between frames.
// Score ~0 = no movement; score > 15 = person is moving; score > 30 = vigorous.
const camMotion = (a, b) => {
  if (!a || !b) return 0;
  const len   = Math.min(a.length, b.length);
  if (len < 200) return 0;
  const start = Math.floor(len * 0.12); // skip JPEG header bytes
  const span  = len - start;
  const step  = Math.max(1, Math.floor(span / 60));
  let diff = 0;
  for (let i = start; i < len; i += step) diff += Math.abs(a.charCodeAt(i) - b.charCodeAt(i));
  return diff / (span / step);
};

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
const todayKey    = () => new Date().toISOString().slice(0, 10);
const clockStr    = () => new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
const fmtSecLeft  = s => {
  if (s <= 0)   return "locked";
  if (s < 60)   return `0:${String(s).padStart(2, "0")}`;
  if (s < 3600) return `${Math.floor(s/60)}:${String(s%60).padStart(2, "0")}`;
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
};

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

// ── Payment Screen ────────────────────────────────────────────
function PaymentScreen({ skips, onPay }) {
  const [cardNum,  setCardNum]  = useState("");
  const [expiry,   setExpiry]   = useState("");
  const [cvv,      setCvv]      = useState("");
  const [name,     setName]     = useState("");
  const [processing, setProcessing] = useState(false);
  const [paid,     setPaid]     = useState(false);

  // Block all back navigation from payment screen
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);

  const fmtCard   = t => t.replace(/\D/g,"").slice(0,16).replace(/(.{4})/g,"$1 ").trim();
  const fmtExpiry = t => { const c=t.replace(/\D/g,"").slice(0,4); return c.length>=3?c.slice(0,2)+"/"+c.slice(2):c; };
  const fmtCvv    = t => t.replace(/\D/g,"").slice(0,3);

  const canPay = cardNum.replace(/\s/g,"").length === 16 && expiry.length === 5 && cvv.length === 3 && name.trim().length > 1;

  const handlePay = () => {
    if (!canPay || processing) return;
    setProcessing(true);
    setTimeout(() => { setPaid(true); setTimeout(onPay, 1600); }, 2200);
  };

  if (paid) return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: earn.green, alignItems:"center", justifyContent:"center" }]}>
      <StatusBar barStyle="light-content" />
      <Text style={{ fontSize: 72, marginBottom: 16 }}>✓</Text>
      <Text style={{ fontFamily: FD, fontSize: 26, color: "#fff", fontStyle: "italic" }}>Payment accepted</Text>
      <Text style={{ fontFamily: FB, fontSize: 14, color: "rgba(255,255,255,0.7)", marginTop: 8 }}>Unlocking your phone…</Text>
    </View>
  );

  if (processing) return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: ink.void, alignItems:"center", justifyContent:"center" }]}>
      <StatusBar barStyle="light-content" />
      <Text style={{ fontSize: 48, marginBottom: 20 }}>⏳</Text>
      <Text style={{ fontFamily: FB, fontSize: 15, color: "#8A7060" }}>Processing payment…</Text>
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: ink.void }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 60 }} keyboardShouldPersistTaps="handled">

        {/* Header */}
        <View style={{ alignItems: "center", marginBottom: 32 }}>
          <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: earn.terra, alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
            <Text style={{ fontSize: 26 }}>💳</Text>
          </View>
          <Text style={{ fontFamily: FD, fontSize: 24, color: "#F0E8D8", fontStyle: "italic", marginBottom: 4 }}>Skip this morning</Text>
          <Text style={{ fontFamily: FB, fontSize: 13, color: "#5A4838" }}>One-time charge of <Text style={{ color: earn.terra, fontWeight: "600" }}>$0.25</Text></Text>
        </View>

        {/* Card */}
        <View style={{ backgroundColor: "rgba(255,255,255,0.055)", borderRadius: 16, padding: 20, borderWidth: 0.5, borderColor: "rgba(255,255,255,0.09)", marginBottom: 20 }}>
          {/* Card number */}
          <Text style={{ fontFamily: FB, fontSize: 10, fontWeight: "600", color: "#4A3828", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Card number</Text>
          <TextInput
            value={cardNum}
            onChangeText={t => setCardNum(fmtCard(t))}
            placeholder="1234 5678 9012 3456"
            placeholderTextColor="#3A2818"
            keyboardType="number-pad"
            style={{ fontFamily: FB, fontSize: 17, color: "#F0E8D8", letterSpacing: 2, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.1)", marginBottom: 18 }}
          />

          {/* Expiry + CVV */}
          <View style={{ flexDirection: "row", gap: 16 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: FB, fontSize: 10, fontWeight: "600", color: "#4A3828", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Expiry</Text>
              <TextInput
                value={expiry}
                onChangeText={t => setExpiry(fmtExpiry(t))}
                placeholder="MM/YY"
                placeholderTextColor="#3A2818"
                keyboardType="number-pad"
                style={{ fontFamily: FB, fontSize: 17, color: "#F0E8D8", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.1)" }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: FB, fontSize: 10, fontWeight: "600", color: "#4A3828", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>CVV</Text>
              <TextInput
                value={cvv}
                onChangeText={t => setCvv(fmtCvv(t))}
                placeholder="123"
                placeholderTextColor="#3A2818"
                keyboardType="number-pad"
                secureTextEntry
                style={{ fontFamily: FB, fontSize: 17, color: "#F0E8D8", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.1)" }}
              />
            </View>
          </View>
        </View>

        {/* Name */}
        <View style={{ backgroundColor: "rgba(255,255,255,0.055)", borderRadius: 16, padding: 20, borderWidth: 0.5, borderColor: "rgba(255,255,255,0.09)", marginBottom: 28 }}>
          <Text style={{ fontFamily: FB, fontSize: 10, fontWeight: "600", color: "#4A3828", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Name on card</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor="#3A2818"
            autoCapitalize="words"
            style={{ fontFamily: FB, fontSize: 17, color: "#F0E8D8", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.1)" }}
          />
        </View>

        {/* Pay button */}
        <TouchableOpacity
          onPress={handlePay}
          disabled={!canPay}
          style={{ paddingVertical: 16, borderRadius: 14, backgroundColor: canPay ? earn.terra : "rgba(212,98,42,0.25)", alignItems: "center", marginBottom: 16 }}
        >
          <Text style={{ fontFamily: FB, fontWeight: "700", fontSize: 16, color: canPay ? "#fff" : "#4A2A18" }}>
            Pay $0.25
          </Text>
        </TouchableOpacity>

        {/* Fine print */}
        <View style={{ alignItems: "center", gap: 4 }}>
          <Text style={{ fontFamily: FB, fontSize: 11, color: "#3A2818" }}>🔒 Secured by Stripe</Text>
          <Text style={{ fontFamily: FB, fontSize: 10, color: "#2A1808", textAlign: "center" }}>
            {skips > 0 ? `You've paid to skip ${skips}× this week ($${(skips * 0.25).toFixed(2)} total)` : "First skip this week"}
          </Text>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
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
  const [motionVal, setMotionVal] = useState(0);     // 0–1 normalised motion bar
  const [repFlash, setRepFlash]   = useState(false); // brief highlight on rep detect

  const timerRef    = useRef(null);
  const repsLeftRef = useRef(0);     // stale-closure-safe rep counter
  const cameraRef   = useRef(null);  // CameraView ref
  const snapRef     = useRef(null);  // snapshot setInterval handle
  const prevB64Ref  = useRef(null);  // last frame base64 for diff
  const histRef     = useRef([]);    // rolling motion-score history (smoothing)
  const inMotRef    = useRef(false); // are we in the "moving" phase of a rep?
  const lastRepRef  = useRef(0);     // timestamp of last counted rep (debounce)

  // Block back button entirely on morning gate — can't exit or go back mid-challenge
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const i = setInterval(() => setClock(clockStr()), 1000);
    return () => clearInterval(i);
  }, []);
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  // Camera permission
  const [camPerm, requestCamPerm] = useCameraPermissions();

  // ── Camera rep detection ──────────────────────────────────────
  // Takes a snapshot every 450ms, diffs consecutive base64 strings to
  // measure motion. Rep = motion spike that settles back to stillness.
  useEffect(() => {
    if (!chosen || chosen.type !== "reps" || done || !camPerm?.granted) return;

    snapRef.current = setInterval(async () => {
      if (!cameraRef.current) return;
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0,      // lowest JPEG quality = smallest file, fastest
          base64: true,
          exif: false,
        });
        if (!photo?.base64) return;

        const score = camMotion(prevB64Ref.current, photo.base64);
        prevB64Ref.current = photo.base64;

        // Smooth over last 3 frames
        histRef.current.push(score);
        if (histRef.current.length > 3) histRef.current.shift();
        const avg = histRef.current.reduce((a, b) => a + b, 0) / histRef.current.length;

        setMotionVal(Math.min(1, avg / 30)); // normalise: score 30 → full bar

        const now = Date.now();
        if (avg > 15 && !inMotRef.current) {
          inMotRef.current = true; // person started moving
        } else if (avg < 7 && inMotRef.current && (now - lastRepRef.current) > 800) {
          // Movement completed and settled → count the rep
          inMotRef.current = false;
          lastRepRef.current = now;
          setRepFlash(true);
          setTimeout(() => setRepFlash(false), 450);
          const next = Math.max(0, repsLeftRef.current - 1);
          repsLeftRef.current = next;
          setRepsLeft(next);
          if (next <= 0) { setDone(true); setTimeout(onUnlock, 1400); }
        }
      } catch {}
    }, 450);

    return () => {
      if (snapRef.current) { clearInterval(snapRef.current); snapRef.current = null; }
    };
  }, [chosen, done, camPerm?.granted]);

  const pick = ch => {
    setChosen(ch);
    if (ch.type === "timer") setCountdown(ch.secs);
    if (ch.type === "reps") {
      repsLeftRef.current = ch.goal;
      setRepsLeft(ch.goal);
      // Immediately trigger the system camera permission dialog
      requestCamPerm();
    }
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

  // Manual fallback (also used by accelerometer path via repsLeftRef)
  const doRepManual = () => {
    const next = Math.max(0, repsLeftRef.current - 1);
    repsLeftRef.current = next;
    setRepsLeft(next);
    if (next <= 0) { setDone(true); setTimeout(onUnlock, 1400); }
  };

  const back = () => {
    if (snapRef.current)  { clearInterval(snapRef.current); snapRef.current = null; }
    if (timerRef.current) clearInterval(timerRef.current);
    setChosen(null); setCountdown(null); setRunning(false);
    setRepsLeft(0); repsLeftRef.current = 0; setDone(false);
    setMotionVal(0); setRepFlash(false);
    prevB64Ref.current = null; histRef.current = [];
    inMotRef.current = false; lastRepRef.current = 0;
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
      {/* No back button — once you start a challenge you finish it */}

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
        <View style={{ alignItems: "center", width: "100%" }}>

          {/* Camera preview — or grant-permission prompt */}
          {camPerm?.granted ? (
            <CameraView
              ref={cameraRef}
              style={{ width: 220, height: 160, borderRadius: 14, overflow: "hidden", marginBottom: 16 }}
              facing="front"
            />
          ) : (
            <TouchableOpacity
              onPress={requestCamPerm}
              style={{
                width: 220, height: 160, borderRadius: 14, marginBottom: 16,
                backgroundColor: "rgba(255,255,255,0.04)",
                borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
                alignItems: "center", justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 36, marginBottom: 8 }}>📷</Text>
              <Text style={{ fontFamily: FB, fontSize: 13, fontWeight: "600", color: earn.terra }}>Enable Camera</Text>
              <Text style={{ fontFamily: FB, fontSize: 11, color: "#4A3020", marginTop: 4, textAlign: "center" }}>
                Camera watches your movement{"\n"}to count reps automatically
              </Text>
            </TouchableOpacity>
          )}

          {/* Rep counter ring */}
          <View style={{
            width: 120, height: 120, borderRadius: 60,
            borderWidth: 4,
            borderColor: repsLeft <= 0 ? earn.green : repFlash ? "#FFD700" : earn.terra,
            alignItems: "center", justifyContent: "center", marginBottom: 14,
          }}>
            <Text style={{ fontFamily: FD, fontSize: 38, color: repFlash ? "#FFD700" : "#F0E8D8", fontWeight: "300", lineHeight: 44 }}>
              {repsLeft}
            </Text>
            <Text style={{ fontFamily: FB, fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>remaining</Text>
          </View>

          {/* Status label */}
          <Text style={{ fontFamily: FB, fontSize: 13, color: repFlash ? "#FFD700" : "#5A4838", marginBottom: 12, textAlign: "center" }}>
            {repFlash ? "⚡ Rep counted!" : repsLeft <= 0 ? "✓ Done!" : camPerm?.granted ? "Camera is watching — do your reps" : "Grant camera access above"}
          </Text>

          {/* Live motion bar */}
          {repsLeft > 0 && camPerm?.granted && (
            <View style={{ width: 220, marginBottom: 16 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 5 }}>
                <Text style={{ fontFamily: FB, fontSize: 9, color: "#3A2818" }}>still</Text>
                <Text style={{ fontFamily: FB, fontSize: 9, color: "#3A2818" }}>moving</Text>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
                <View style={{
                  height: "100%",
                  width: `${motionVal * 100}%`,
                  backgroundColor: repFlash ? "#FFD700" : motionVal > 0.5 ? earn.green : earn.terra,
                  borderRadius: 3,
                }} />
              </View>
            </View>
          )}

          {/* Manual fallback */}
          <TouchableOpacity
            onPress={doRepManual}
            disabled={repsLeft <= 0}
            style={{
              paddingVertical: 7, paddingHorizontal: 18, borderRadius: 10,
              borderWidth: 0.5, borderColor: "rgba(255,255,255,0.1)",
              backgroundColor: "rgba(255,255,255,0.04)",
              opacity: repsLeft <= 0 ? 0.3 : 1,
            }}
          >
            <Text style={{ fontFamily: FB, fontSize: 11, color: "#4A3020" }}>+ Count manually</Text>
          </TouchableOpacity>
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
  const [secLeft, setSecLeft] = useState(0);

  // ── Countdown engine ─────────────────────────────────────────
  const secRef   = useRef(0);   // source of truth for seconds remaining
  const tickRef  = useRef(null);
  const screenRef = useRef("loading");

  const stopTick = () => { if (tickRef.current) clearInterval(tickRef.current); };

  const startTick = (initialSec) => {
    stopTick();
    secRef.current = initialSec;
    if (initialSec <= 0) return;
    tickRef.current = setInterval(() => {
      secRef.current = Math.max(0, secRef.current - 1);
      const s = secRef.current;
      setSecLeft(s);
      // Keep credits.balance in sync (in whole minutes, rounded up so 1s remaining ≠ 0m)
      setCredits(c => {
        const newBal = s > 0 ? Math.ceil(s / 60) : 0;
        return c.balance === newBal ? c : { ...c, balance: newBal };
      });
      if (s <= 0) {
        stopTick();
        if (screenRef.current === "app") setScreen("morning");
      }
    }, 1000);
  };

  // Track screen in a ref so AppState listener always sees latest value
  useEffect(() => { screenRef.current = screen; }, [screen]);

  // Start/stop tick when screen changes
  useEffect(() => {
    if (screen === "app" && secRef.current > 0) startTick(secRef.current);
    else stopTick();
    return stopTick;
  }, [screen]);

  // Pause when backgrounded, recalculate elapsed when foregrounded
  useEffect(() => {
    let bgTime = null;
    const sub = AppState.addEventListener("change", nextState => {
      if (nextState !== "active") {
        bgTime = Date.now();
        stopTick();
      } else {
        if (bgTime && screenRef.current === "app") {
          const elapsedSec = Math.floor((Date.now() - bgTime) / 1000);
          const remaining  = Math.max(0, secRef.current - elapsedSec);
          secRef.current   = remaining;
          setSecLeft(remaining);
          setCredits(c => {
            const nb = remaining > 0 ? Math.ceil(remaining / 60) : 0;
            return c.balance === nb ? c : { ...c, balance: nb };
          });
          if (remaining > 0) startTick(remaining);
          else setScreen("morning");
        }
        bgTime = null;
      }
    });
    return () => { sub.remove(); stopTick(); };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const d = await storage.get("drift_v4");
        if (d?.value) {
          const p = JSON.parse(d.value);
          if (p.date !== todayKey()) {
            setTotalXp(p.totalXp || 0); setSkips(0); setScreen("morning");
          } else {
            const savedCredits = p.credits || { balance: 0, earned: 0, spent: 0 };
            setTasks(p.tasks || []);
            setCredits(savedCredits);
            setTotalXp(p.totalXp || 0);
            setSkips(p.skips || 0);
            const initSec = (savedCredits.balance || 0) * 60;
            secRef.current = initSec;
            setSecLeft(initSec);
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

  const unlock  = () => { setScreen("app"); persist({ morningDone: true }); };
  const goToPay = () => { setScreen("payment"); };
  const pay     = () => { const ns = skips + 1; setSkips(ns); setScreen("app"); persist({ morningDone: true, skips: ns }); };

  const loadDemo = () => {
    const dc = { balance: 90, earned: 180, spent: 90 };
    secRef.current = 90 * 60;
    setSecLeft(90 * 60);
    setTasks(DEMO_TASKS); setCredits(dc); setTotalXp(340); setSkips(1); setScreen("app");
    persist({ tasks: DEMO_TASKS, credits: dc, totalXp: 340, skips: 1, morningDone: true });
  };

  const completeTask = id => {
    const task = tasks.find(t => t.id === id);
    if (!task || task.done) return;
    const nt  = tasks.map(t => t.id === id ? { ...t, done: true } : t);
    const nx  = totalXp + task.xp;
    // Add earned minutes to the live countdown
    const newSec = secRef.current + task.credits * 60;
    const nc  = { balance: Math.ceil(newSec / 60), earned: credits.earned + task.credits, spent: credits.spent };
    setTasks(nt); setCredits(nc); setTotalXp(nx);
    setPopup({ credits: task.credits, xp: task.xp });
    setTimeout(() => setPopup(null), 2000);
    startTick(newSec); // restart countdown with new total
    persist({ tasks: nt, credits: nc, totalXp: nx });
  };

  const addTask  = t => { const nt = [...tasks, t]; setTasks(nt); persist({ tasks: nt }); };
  const simSpend = () => {
    const useSec = Math.min(10 * 60, secRef.current);
    const newSec = Math.max(0, secRef.current - useSec);
    const newBal = Math.ceil(newSec / 60);
    const nc     = { ...credits, balance: newBal, spent: credits.spent + Math.floor(useSec / 60) };
    startTick(newSec);
    setCredits(nc);
    persist({ credits: nc });
    if (newSec <= 0) setScreen("morning");
  };

  if (screen === "loading") return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: ink.void }}>
      <StatusBar barStyle="light-content" />
      <Text style={{ fontSize: 44 }}>🔒</Text>
      <Text style={{ fontFamily: FD, fontSize: 22, color: "#F0E8D8", fontStyle: "italic", marginTop: 12 }}>Drift</Text>
    </View>
  );

  if (screen === "morning") return <MorningGate skips={skips} onUnlock={unlock} onPay={goToPay} />;
  if (screen === "payment") return <PaymentScreen skips={skips} onPay={pay} />;

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
          backgroundColor: secLeft > 0 ? earn.green : "#1C1408",
          alignItems: "center", justifyContent: "center", marginRight: 8,
        }}>
          <Text style={{ fontSize: 13 }}>{secLeft > 0 ? "🔓" : "🔒"}</Text>
        </View>
        <Text style={{ fontFamily: FD, fontSize: 17, color: ink.deep, fontStyle: "italic", flex: 1 }}>Drift</Text>
        <View style={{
          backgroundColor: secLeft > 0 ? (secLeft < 120 ? "#FDECEA" : earn.greenLo) : "#EDE7D8",
          borderRadius: 20, paddingVertical: 3, paddingHorizontal: 10, marginRight: 10,
        }}>
          <Text style={{ fontFamily: FB, fontSize: 11, fontWeight: "600", color: secLeft > 0 ? (secLeft < 120 ? "#C0392B" : earn.greenD) : ink.faint }}>
            {fmtSecLeft(secLeft)}
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
