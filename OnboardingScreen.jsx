/**
 * OnboardingScreen.jsx
 * Opal-style onboarding: stats → goals → login
 */
import React, { useState, useRef } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Dimensions,
  ScrollView, Animated, StatusBar, TextInput, KeyboardAvoidingView,
  Platform, ActivityIndicator, Alert,
} from "react-native";
import { supabase } from "./supabase";

const { width, height } = Dimensions.get("window");
const BG = "#0D0D0D";
const CARD_BG = "#1A1A1A";
const ACCENT = "#D4622A";
const ACCENT2 = "#E87B45";
const TEXT = "#F5F0EB";
const MUTED = "#6B6560";
const BORDER = "#2A2A2A";

// ─── Step data ──────────────────────────────────────────────────────────────

const STEPS = [
  { id: "welcome" },
  {
    id: "usage",
    emoji: "📱",
    question: "How much time do you\nspend on your phone?",
    subtitle: "Be honest — no judgment here.",
    type: "single",
    options: [
      { id: "1-2", label: "1–2 hours", sub: "Pretty good" },
      { id: "2-4", label: "2–4 hours", sub: "Average" },
      { id: "4-6", label: "4–6 hours", sub: "Getting up there" },
      { id: "6+", label: "6+ hours", sub: "Let's fix this" },
    ],
  },
  {
    id: "wakeup",
    emoji: "⏰",
    question: "When do you usually\nwake up?",
    subtitle: "Drift locks your phone until you earn it.",
    type: "single",
    options: [
      { id: "5-6", label: "5:00 – 6:00 AM", sub: "Early bird" },
      { id: "6-7", label: "6:00 – 7:00 AM", sub: "Morning person" },
      { id: "7-8", label: "7:00 – 8:00 AM", sub: "Standard" },
      { id: "8+", label: "8:00 AM or later", sub: "Night owl" },
    ],
  },
  {
    id: "distractions",
    emoji: "🕳️",
    question: "What pulls you in\nfirst thing?",
    subtitle: "Select all that apply.",
    type: "multi",
    options: [
      { id: "social", label: "Social Media", sub: "Instagram, X, Threads" },
      { id: "news", label: "News", sub: "Doomscrolling headlines" },
      { id: "youtube", label: "YouTube", sub: "One more video…" },
      { id: "tiktok", label: "TikTok", sub: "The infinite scroll" },
      { id: "games", label: "Games", sub: "Quick match turns into hours" },
      { id: "messages", label: "Messages", sub: "Texts, DMs, replies" },
    ],
  },
  {
    id: "age",
    emoji: "🎂",
    question: "How old are you?",
    subtitle: "Helps us tailor your challenges.",
    type: "single",
    options: [
      { id: "under18", label: "Under 18" },
      { id: "18-24", label: "18 – 24" },
      { id: "25-34", label: "25 – 34" },
      { id: "35+", label: "35 or older" },
    ],
  },
  {
    id: "goals",
    emoji: "🎯",
    question: "What do you want\nfrom Drift?",
    subtitle: "Pick everything that resonates.",
    type: "multi",
    options: [
      { id: "cut", label: "Cut screen time", sub: "Reclaim hours every day" },
      { id: "mornings", label: "Better mornings", sub: "Own your first hour" },
      { id: "focus", label: "More focus", sub: "Deep work, fewer interruptions" },
      { id: "addiction", label: "Break the addiction", sub: "Stop compulsive checking" },
    ],
  },
  { id: "auth" },
];

// ─── Welcome Screen ──────────────────────────────────────────────────────────

function WelcomeSlide({ onNext }) {
  return (
    <View style={styles.slide}>
      <View style={styles.welcomeContent}>
        <Text style={styles.welcomeLogo}>drift</Text>
        <Text style={styles.welcomeHeadline}>{"Your phone unlocks\nwhen you earn it."}</Text>
        <Text style={styles.welcomeSub}>
          Complete a physical challenge every morning before your screen time begins.
        </Text>
      </View>
      <TouchableOpacity style={styles.ctaBtn} onPress={onNext}>
        <Text style={styles.ctaBtnText}>Get started</Text>
      </TouchableOpacity>
      <Text style={styles.legal}>Takes 60 seconds · No credit card</Text>
    </View>
  );
}

// ─── Question Slide ──────────────────────────────────────────────────────────

function QuestionSlide({ step, answers, onToggle, onNext, canContinue }) {
  return (
    <View style={styles.slide}>
      <View style={{ flex: 1 }}>
        <Text style={styles.stepEmoji}>{step.emoji}</Text>
        <Text style={styles.question}>{step.question}</Text>
        <Text style={styles.questionSub}>{step.subtitle}</Text>

        <ScrollView
          style={styles.optionsScroll}
          showsVerticalScrollIndicator={false}
        >
          {step.options.map((opt) => {
            const selected = answers[step.id]?.includes(opt.id);
            return (
              <TouchableOpacity
                key={opt.id}
                style={[styles.optionCard, selected && styles.optionCardSelected]}
                onPress={() => onToggle(step.id, opt.id, step.type)}
                activeOpacity={0.75}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                    {opt.label}
                  </Text>
                  {opt.sub ? (
                    <Text style={[styles.optionSub, selected && styles.optionSubSelected]}>
                      {opt.sub}
                    </Text>
                  ) : null}
                </View>
                <View style={[styles.check, selected && styles.checkSelected]}>
                  {selected && <Text style={styles.checkMark}>✓</Text>}
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <TouchableOpacity
        style={[styles.ctaBtn, !canContinue && styles.ctaBtnDisabled]}
        onPress={canContinue ? onNext : null}
        activeOpacity={canContinue ? 0.8 : 1}
      >
        <Text style={styles.ctaBtnText}>Continue</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Auth Screen ─────────────────────────────────────────────────────────────

function AuthSlide({ onDone }) {
  const [mode, setMode] = useState("signup"); // "signup" | "login"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (!email.trim() || !password.trim()) {
      setError("Please fill in all fields.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: { data: { full_name: name.trim() } },
        });
        if (err) throw err;
        // Insert profile row
        if (data.user) {
          await supabase.from("profiles").upsert({
            id: data.user.id,
            username: email.split("@")[0],
            full_name: name.trim(),
          });
        }
        onDone(data.user);
      } else {
        const { data, error: err } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
        if (err) throw err;
        onDone(data.user);
      }
    } catch (e) {
      setError(e.message || "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.slide}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.stepEmoji}>👋</Text>
        <Text style={styles.question}>
          {mode === "signup" ? "Create your account" : "Welcome back"}
        </Text>
        <Text style={styles.questionSub}>
          {mode === "signup"
            ? "Your progress saves across devices."
            : "Sign in to pick up where you left off."}
        </Text>

        <View style={styles.authForm}>
          {mode === "signup" && (
            <View style={styles.inputWrap}>
              <Text style={styles.inputLabel}>Name</Text>
              <TextInput
                style={styles.input}
                placeholder="Your name"
                placeholderTextColor={MUTED}
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                returnKeyType="next"
              />
            </View>
          )}

          <View style={styles.inputWrap}>
            <Text style={styles.inputLabel}>Email</Text>
            <TextInput
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={MUTED}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              returnKeyType="next"
            />
          </View>

          <View style={styles.inputWrap}>
            <Text style={styles.inputLabel}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="Min. 6 characters"
              placeholderTextColor={MUTED}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
            />
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
      </View>

      <TouchableOpacity
        style={[styles.ctaBtn, loading && styles.ctaBtnDisabled]}
        onPress={handleSubmit}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.ctaBtnText}>
            {mode === "signup" ? "Create account" : "Sign in"}
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => { setMode(mode === "signup" ? "login" : "signup"); setError(""); }}
        style={{ marginTop: 16, alignItems: "center" }}
      >
        <Text style={styles.switchMode}>
          {mode === "signup"
            ? "Already have an account? Sign in"
            : "No account yet? Sign up"}
        </Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

// ─── Main Onboarding ──────────────────────────────────────────────────────────

export default function OnboardingScreen({ onComplete }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const step = STEPS[stepIndex];
  const totalQuestions = STEPS.filter((s) => s.id !== "welcome" && s.id !== "auth").length;
  const questionIndex = STEPS.slice(1, stepIndex).filter((s) => s.id !== "auth").length;

  function canContinue() {
    if (!step.options) return true;
    return answers[step.id]?.length > 0;
  }

  function toggleAnswer(stepId, optId, type) {
    setAnswers((prev) => {
      const current = prev[stepId] || [];
      if (type === "single") return { ...prev, [stepId]: [optId] };
      if (current.includes(optId)) {
        return { ...prev, [stepId]: current.filter((x) => x !== optId) };
      }
      return { ...prev, [stepId]: [...current, optId] };
    });
  }

  function goNext() {
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
    setTimeout(() => setStepIndex((i) => i + 1), 150);
  }

  function handleAuthDone(user) {
    onComplete({ user, answers });
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Progress bar (hidden on welcome/auth) */}
      {step.id !== "welcome" && step.id !== "auth" && (
        <View style={styles.progressWrap}>
          {Array.from({ length: totalQuestions }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.progressDot,
                i < questionIndex && styles.progressDotDone,
                i === questionIndex && styles.progressDotActive,
              ]}
            />
          ))}
        </View>
      )}

      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        {step.id === "welcome" && <WelcomeSlide onNext={goNext} />}
        {step.id === "auth" && <AuthSlide onDone={handleAuthDone} />}
        {step.options && (
          <QuestionSlide
            step={step}
            answers={answers}
            onToggle={toggleAnswer}
            onNext={goNext}
            canContinue={canContinue()}
          />
        )}
      </Animated.View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
    paddingTop: Platform.OS === "ios" ? 56 : 32,
  },
  slide: {
    flex: 1,
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === "ios" ? 40 : 24,
  },

  // Welcome
  welcomeContent: { flex: 1, justifyContent: "center", paddingBottom: 40 },
  welcomeLogo: {
    fontSize: 18,
    color: ACCENT,
    fontWeight: "700",
    letterSpacing: 4,
    textTransform: "uppercase",
    marginBottom: 48,
  },
  welcomeHeadline: {
    fontSize: 40,
    fontWeight: "800",
    color: TEXT,
    lineHeight: 48,
    marginBottom: 20,
  },
  welcomeSub: {
    fontSize: 17,
    color: "#8A8480",
    lineHeight: 26,
  },

  // Question
  stepEmoji: { fontSize: 40, marginBottom: 20, marginTop: 8 },
  question: {
    fontSize: 30,
    fontWeight: "800",
    color: TEXT,
    lineHeight: 38,
    marginBottom: 10,
  },
  questionSub: {
    fontSize: 15,
    color: MUTED,
    marginBottom: 28,
    lineHeight: 22,
  },
  optionsScroll: { flex: 1 },
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: CARD_BG,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: BORDER,
    paddingVertical: 16,
    paddingHorizontal: 18,
    marginBottom: 10,
  },
  optionCardSelected: {
    borderColor: ACCENT,
    backgroundColor: "#2A1810",
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: TEXT,
  },
  optionLabelSelected: { color: ACCENT2 },
  optionSub: {
    fontSize: 13,
    color: MUTED,
    marginTop: 3,
  },
  optionSubSelected: { color: "#9B5030" },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },
  checkSelected: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  checkMark: { color: "#fff", fontSize: 13, fontWeight: "700" },

  // Auth
  authForm: { marginTop: 8 },
  inputWrap: { marginBottom: 16 },
  inputLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: MUTED,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  input: {
    backgroundColor: CARD_BG,
    borderWidth: 1.5,
    borderColor: BORDER,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: TEXT,
  },
  errorText: {
    color: "#E05050",
    fontSize: 14,
    marginTop: 8,
    lineHeight: 20,
  },
  switchMode: {
    color: MUTED,
    fontSize: 14,
  },

  // Buttons
  ctaBtn: {
    backgroundColor: ACCENT,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: "center",
    marginTop: 16,
  },
  ctaBtnDisabled: {
    backgroundColor: "#3A2820",
  },
  ctaBtnText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  legal: {
    color: MUTED,
    fontSize: 13,
    textAlign: "center",
    marginTop: 14,
  },

  // Progress
  progressWrap: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    paddingBottom: 16,
    paddingHorizontal: 24,
  },
  progressDot: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: "#2A2A2A",
  },
  progressDotDone: { backgroundColor: "#5A3020" },
  progressDotActive: { backgroundColor: ACCENT },
});
