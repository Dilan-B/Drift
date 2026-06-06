/**
 * OnboardingScreen.jsx
 * Opal-style onboarding: stats → goals → login
 */
import React, { useState, useRef } from "react";
import { useFonts, Orbitron_700Bold, Orbitron_400Regular } from "@expo-google-fonts/orbitron";
import { Oswald_700Bold } from "@expo-google-fonts/oswald";
import {
  View, Text, TouchableOpacity, StyleSheet, Dimensions,
  ScrollView, Animated, StatusBar, TextInput, KeyboardAvoidingView,
  Platform, ActivityIndicator, Alert,
} from "react-native";
import { supabase } from "./supabase";
let AppleAuthentication = null;
try { AppleAuthentication = require("expo-apple-authentication"); } catch {}
import { PhoneIcon, HoleIcon, CakeIcon, TargetIcon, WaveIcon, CheckIcon } from "./Icons";
import Svg, { Circle as SvgCircle, Path as SvgPath } from "react-native-svg";

function ClockIcon({ size = 56, color = ACCENT }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <SvgCircle cx="12" cy="13" r="8" stroke={color} strokeWidth={2} />
      <SvgPath d="M12 9v4l3 2 M9 3h6 M5 5l-1.5 1.5 M19 5l1.5 1.5" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

const STEP_ICONS = {
  usage: PhoneIcon,
  wakeup: ClockIcon,
  distractions: HoleIcon,
  age: CakeIcon,
  goals: TargetIcon,
};

const { width, height } = Dimensions.get("window");
const BG = "#F4F9F6";
const CARD_BG = "#FFFFFF";
const ACCENT = "#2FAB72";
const ACCENT2 = "#3DC985";
const TEXT = "#1A2B1F";
const MUTED = "#6B8A78";
const BORDER = "#DFF0E8";

// ─── Step data ──────────────────────────────────────────────────────────────

const STEPS = [
  { id: "welcome" },
  {
    id: "usage",
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
  const [fontsLoaded] = useFonts({ Orbitron_700Bold, Orbitron_400Regular, Oswald_700Bold });
  return (
    <View style={styles.slide}>
      <View style={styles.welcomeContent}>
        <Text style={[styles.welcomeLogo, fontsLoaded && { fontFamily: "Orbitron_700Bold", fontSize: 22, letterSpacing: 4 }]}>DRIFT</Text>
        <Text style={[styles.welcomeHeadline, fontsLoaded && { fontFamily: "Oswald_700Bold", fontSize: 36, lineHeight: 44, letterSpacing: 0.5 }]}>{"Your phone unlocks\nwhen you earn it."}</Text>
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
        <View style={styles.stepEmoji}>
          {(() => {
            const Icon = STEP_ICONS[step.id];
            return Icon ? <Icon size={48} color={ACCENT} /> : null;
          })()}
        </View>
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
                  {selected && <CheckIcon size={14} color="#fff" />}
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

// ── Validation helpers ────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validatePassword(pw) {
  if (pw.length < 8) return "Password must be at least 8 characters.";
  if (pw.length > 72) return "Password too long (max 72 characters).";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw))
    return "Password must contain letters and at least one number.";
  return null;
}

function validateEmail(e) {
  const trimmed = e.trim().toLowerCase();
  if (!trimmed) return "Email required.";
  if (trimmed.length > 254) return "Email too long.";
  if (!EMAIL_RE.test(trimmed)) return "Enter a valid email address.";
  return null;
}

function sanitizeName(n) {
  // Strip control chars and HTML-ish characters
  return n.replace(/[\x00-\x1F\x7F<>{}]/g, "").trim().slice(0, 50);
}

// Username rules: 3–20 chars, letters / digits / underscores, lowercase.
function normalizeUsername(raw) {
  return (raw || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
}

function validateUsername(raw) {
  const u = normalizeUsername(raw);
  if (!u) return "Pick a username.";
  if (u.length < 3) return "Username must be at least 3 characters.";
  if (u.length > 20) return "Username can be at most 20 characters.";
  if (!/^[a-z0-9_]+$/.test(u)) return "Use letters, numbers, and underscores only.";
  return null;
}

function AuthSlide({ onDone, defaultMode = "signup" }) {
  const [mode,     setMode]     = useState(defaultMode); // "signup" | "login"
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");

  // Client-side rate limiting (anti-spam, not a security boundary)
  const attemptsRef = useRef([]);

  async function handleSubmit() {
    setError("");

    // Validate email
    const cleanEmail = email.trim().toLowerCase();
    const emailErr   = validateEmail(cleanEmail);
    if (emailErr) { setError(emailErr); return; }

    // Validate password
    const pwErr = validatePassword(password);
    if (pwErr) { setError(pwErr); return; }

    // Validate username (signup only) + availability check
    let cleanUsername = "";
    if (mode === "signup") {
      cleanUsername = normalizeUsername(username);
      const uErr = validateUsername(cleanUsername);
      if (uErr) { setError(uErr); return; }

      // Availability — case-insensitive
      try {
        const { data: taken, error: lookupErr } = await supabase
          .from("profiles").select("id").ilike("username", cleanUsername).maybeSingle();
        if (lookupErr) throw lookupErr;
        if (taken) { setError("That username is taken. Try another."); return; }
      } catch {
        setError("Could not check username availability. Try again.");
        return;
      }
    }

    // Client-side rate limit: max 5 attempts per 60s window
    const now = Date.now();
    attemptsRef.current = attemptsRef.current.filter(t => now - t < 60_000);
    if (attemptsRef.current.length >= 5) {
      setError("Too many attempts. Wait a minute and try again.");
      return;
    }
    attemptsRef.current.push(now);

    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error: err } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              username:  cleanUsername,
              full_name: cleanUsername, // keep full_name for backwards-compat
            },
            emailRedirectTo: "drift://auth-callback",
          },
        });
        if (err) throw err;

        // Supabase quirk: if a user with this email already exists but is
        // *unconfirmed*, signUp succeeds with no error and no session.
        // We detect this and tell the user.
        if (!data.session && !data.user?.identities?.length) {
          setError("An account with that email already exists. Try signing in.");
          setLoading(false);
          setMode("login");
          return;
        }

        // Profile row should be created by the auth.users trigger
        // (handle_new_user). If this is an immediate-session signup and the
        // trigger is missing, insert the row here so username uniqueness is
        // still enforced before the account enters the app.
        if (data.user) {
          let { data: prof, error: profLookupErr } = await supabase
            .from("profiles").select("username").eq("id", data.user.id).maybeSingle();
          if (profLookupErr) throw profLookupErr;

          if (!prof && data.session) {
            const { data: inserted, error: insertErr } = await supabase
              .from("profiles")
              .insert({ id: data.user.id, username: cleanUsername })
              .select("username")
              .single();
            if (insertErr) throw insertErr;
            prof = inserted;
          }

          if (prof && prof.username !== cleanUsername) {
            try { await supabase.auth.signOut(); } catch {}
            setError("That username was just taken. Please pick another.");
            setLoading(false);
            return;
          }
        }

        // Email confirmation flow (confirmed email setting ON)
        if (!data.session) {
          setError("Check your email to verify your account, then sign in.");
          setLoading(false);
          setMode("login");
          return;
        }

        // Claim 7-day free trial (server tracks IP hash to prevent abuse)
        try {
          await supabase.functions.invoke("claim-trial", {});
        } catch (e) {
          // Non-fatal — user just won't get the trial
          console.warn("Trial claim failed:", e?.message);
        }

        onDone(data.user);
      } else {
        const { data, error: err } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (err) throw err;
        onDone(data.user);
      }
    } catch (e) {
      // Map generic Supabase errors to friendlier messages WITHOUT leaking enumeration info
      const raw = (e?.message || "").toLowerCase();
      if (raw.includes("already") || raw.includes("registered") || raw.includes("exists")) {
        setError("An account with that email already exists. Try signing in.");
      } else if (raw.includes("duplicate") || (raw.includes("unique") && raw.includes("username"))) {
        setError("That username is taken. Try another.");
      } else if (raw.includes("invalid") && raw.includes("credential")) {
        setError("Email or password is incorrect.");
      } else if (raw.includes("network") || raw.includes("fetch")) {
        setError("Network error. Check your connection.");
      } else if (raw.includes("rate") || raw.includes("too many")) {
        setError("Too many attempts. Try again in a few minutes.");
      } else {
        setError(e?.message || "Sign-in failed. Try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.slide}
      behavior={Platform.OS === "ios" ? "height" : undefined}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 20 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.stepEmoji}><WaveIcon size={48} color={ACCENT} /></View>
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
              <Text style={styles.inputLabel}>Username</Text>
              <TextInput
                style={styles.input}
                placeholder="3–20 chars, letters/numbers/_"
                placeholderTextColor={MUTED}
                value={username}
                onChangeText={(t) => setUsername(normalizeUsername(t))}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                maxLength={20}
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
              placeholder="Min. 8 characters"
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
      </ScrollView>

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

      {/* Sign in with Apple */}
      {AppleAuthentication?.AppleAuthenticationButton && Platform.OS === "ios" && (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 16, marginBottom: 12, gap: 10 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: BORDER }} />
            <Text style={{ color: MUTED, fontSize: 12 }}>or</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: BORDER }} />
          </View>
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={mode === "signup"
              ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
              : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={14}
            style={{ height: 52, width: "100%" }}
            onPress={async () => {
              setError("");
              try {
                const cred = await AppleAuthentication.signInAsync({
                  requestedScopes: [
                    AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
                    AppleAuthentication.AppleAuthenticationScope.EMAIL,
                  ],
                });
                if (!cred.identityToken) throw new Error("No identity token from Apple");

                setLoading(true);
                const { data, error: err } = await supabase.auth.signInWithIdToken({
                  provider: "apple",
                  token: cred.identityToken,
                });
                if (err) throw err;

                // First-time Apple sign-in: ensure a profile row with a username exists.
                if (data?.user) {
                  const { data: prof } = await supabase
                    .from("profiles").select("username").eq("id", data.user.id).maybeSingle();
                  if (!prof?.username) {
                    // Generate a random username; user can rename later from account.
                    const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
                    let rand = "";
                    for (let i = 0; i < 8; i++) rand += alphabet[Math.floor(Math.random() * alphabet.length)];
                    const newUsername = `drifter${rand}`;
                    await supabase.from("profiles").upsert(
                      { id: data.user.id, username: newUsername },
                      { onConflict: "id" }
                    );
                  }
                  try { await supabase.functions.invoke("claim-trial", {}); } catch {}
                  onDone?.(data.user);
                }
              } catch (e) {
                if (e?.code === "ERR_REQUEST_CANCELED") return;
                setError(e?.message || "Sign in with Apple failed.");
              } finally {
                setLoading(false);
              }
            }}
          />
        </>
      )}

      <TouchableOpacity
        onPress={() => { setMode(mode === "signup" ? "login" : "signup"); setError(""); }}
        style={{ marginTop: 14, marginBottom: 32, alignItems: "center" }}
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

export default function OnboardingScreen({ onComplete, signInOnly = false }) {
  // signInOnly: skip welcome + questionnaire, jump straight to auth slide
  const authStepIndex = STEPS.findIndex(s => s.id === "auth");
  const [stepIndex, setStepIndex] = useState(signInOnly ? authStepIndex : 0);
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
      <StatusBar barStyle="dark-content" />

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
        {step.id === "auth" && <AuthSlide onDone={handleAuthDone} defaultMode={signInOnly ? "login" : "signup"} />}
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
    paddingBottom: Platform.OS === "ios" ? 80 : 56,
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
  stepEmoji: { marginBottom: 20, marginTop: 8 },
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
    backgroundColor: "#E4F5EE",
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: TEXT,
  },
  optionLabelSelected: { color: ACCENT },
  optionSub: {
    fontSize: 13,
    color: MUTED,
    marginTop: 3,
  },
  optionSubSelected: { color: "#1A8050" },
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
    backgroundColor: "#C2DDD3",
  },
  ctaBtnText: {
    color: "#fff",
    fontFamily: "Orbitron_700Bold",
    fontSize: 13,
    letterSpacing: 2,
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
    backgroundColor: "#DFF0E8",
  },
  progressDotDone: { backgroundColor: "#1A8050" },
  progressDotActive: { backgroundColor: ACCENT },
});
