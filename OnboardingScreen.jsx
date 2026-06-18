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
  Platform, ActivityIndicator, Alert, Linking,
} from "react-native";
import { supabase } from "./supabase";
import { useGoogleSignIn } from "./oauthSignIn";
import { cached, rateLimited } from "./apiGuards";
// Apple Sign-In is intentionally disabled for now — re-enable by restoring
// the imports above and the Apple button block in OAuthButtons.
import { PhoneIcon, HoleIcon, CakeIcon, TargetIcon, WaveIcon, CheckIcon } from "./Icons";
import Svg, { Circle as SvgCircle, Path as SvgPath } from "react-native-svg";
import Sprout, { Sprig, SeedDots } from "./SproutArt";
import { FF } from "./theme";

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
const BG = "#F7F7F4";
const CARD_BG = "#FFFFFF";
const ACCENT = "#3E6B4E";
const TEXT = "#1A2820";
const MUTED = "#6B7A6E";
const FAINT = "#A8B0A8";
const BORDER = "rgba(26,40,32,0.08)";
const HAIRLINE = "rgba(26,40,32,0.06)";
const SAGE_LO = "#E4ECE0";
const CLAY = "#B0764E";

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
    subtitle: "Sets your baseline.",
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
    subtitle: "Pick any.",
    type: "multi",
    options: [
      { id: "cut", label: "Cut screen time", sub: "Reclaim hours" },
      { id: "mornings", label: "Better mornings", sub: "Own the first hour" },
      { id: "focus", label: "More focus", sub: "Fewer interruptions" },
      { id: "addiction", label: "Break the addiction", sub: "Stop checking" },
    ],
  },
  {
    id: "difficulty",
    question: "How strict should\nDrift be?",
    subtitle: "Controls how much free screen time the Take button gives you.",
    type: "single",
    options: [
      { id: "easy", label: "Easy", sub: "15 min per tap — gentle start" },
      { id: "medium", label: "Medium", sub: "7 min per tap — balanced" },
      { id: "hard", label: "Hard", sub: "3 min per tap — stay disciplined" },
      { id: "committed", label: "Committed", sub: "1 min per tap — earn everything" },
    ],
  },
  { id: "auth" },
];

// ─── Welcome Screen ──────────────────────────────────────────────────────────

function WelcomeSlide({ onNext }) {
  const [fontsLoaded] = useFonts({ Orbitron_700Bold, Orbitron_400Regular, Oswald_700Bold });
  return (
    <View style={styles.slide}>
      <View pointerEvents="none" style={styles.welcomeSprout}>
        <Sprout size={210} tone="fresh" />
      </View>
      <View pointerEvents="none" style={styles.welcomeSprig}>
        <Sprig size={150} color={CLAY} opacity={0.055} flip />
      </View>
      <View style={styles.welcomeContent}>
        <Text style={[styles.welcomeLogo, fontsLoaded && { fontFamily: "Orbitron_700Bold" }]}>DRIFT</Text>
        <Text style={[styles.welcomeHeadline, fontsLoaded && { fontFamily: FF.display }]}>{"Your phone unlocks\nwhen you earn it."}</Text>
        <Text style={styles.welcomeSub}>
          Earn screen time before it starts.
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
        <View style={styles.stepBadge}>
          {(() => {
            const Icon = STEP_ICONS[step.id];
            return Icon ? <Icon size={24} color={ACCENT} /> : null;
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
const AUTH_ATTEMPT_LIMIT = 5;
const AUTH_ATTEMPT_WINDOW_MS = 15 * 60_000;

function isEmailVerified(user) {
  return !!(user?.email_confirmed_at || user?.confirmed_at);
}

function validatePassword(pw) {
  if (pw.length < 12) return "Password must be at least 12 characters.";
  if (pw.length > 72) return "Password too long (max 72 characters).";
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw) || !/[^A-Za-z0-9]/.test(pw))
    return "Use uppercase, lowercase, a number, and a symbol.";
  if (/^(password|qwerty|letmein|welcome|drift)/i.test(pw) || /123456|password/i.test(pw))
    return "Use a less common password.";
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

// ─── OAuth provider buttons (Apple + Google) ─────────────────────────────────
function OAuthButtons({ mode, loading, setLoading, setError, onDone }) {
  // Google sign-in hook — handles PKCE under the hood
  const google = useGoogleSignIn(async (res) => {
    if (!res || res.cancelled) return;
    if (res.error) {
      setLoading(false);
      setError(prettyAuthError(res.error.message) || "Google sign-in failed.");
      return;
    }
    // (Payments removed — everyone is Pro for free; no trial to claim.)
    setLoading(false);
    onDone?.(res.user);
  });

  const handleGoogle = async () => {
    setError("");
    if (loading) return;
    if (!google.isConfigured) {
      setError("Google sign-in isn't configured for this build.");
      return;
    }
    // Detect Expo Go — Google's OAuth no longer accepts exp:// redirect URIs.
    // Users must use a dev client / standalone build.
    const Constants = require("expo-constants").default;
    const isExpoGo = Constants?.appOwnership === "expo" ||
                     Constants?.executionEnvironment === "storeClient";
    if (isExpoGo) {
      setError("Google sign-in requires a dev client build (won't work in Expo Go).");
      return;
    }
    setLoading(true);
    try {
      await google.promptAsync();
      // setLoading(false) happens in the onSignedIn callback
    } catch (e) {
      setLoading(false);
      setError(e?.message || "Google sign-in failed.");
    }
  };

  // No providers available — render nothing
  if (!google.isConfigured) return null;

  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 16, marginBottom: 12, gap: 10 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: BORDER }} />
        <Text style={{ color: FAINT, fontFamily: FF.body, fontSize: 12 }}>or</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: BORDER }} />
      </View>

      {/* Google — Material-style button */}
      <TouchableOpacity
        onPress={handleGoogle}
        disabled={loading || !google.isReady}
        style={{
          height: 52, borderRadius: 14, backgroundColor: CARD_BG,
          borderWidth: 1, borderColor: BORDER,
          alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10,
          opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? (
          <ActivityIndicator color="#3c4043" />
        ) : (
          <>
            <GoogleGlyph />
            <Text style={{ color: TEXT, fontSize: 15, fontFamily: FF.bodyMed }}>
              {mode === "signup" ? "Sign up with Google" : "Sign in with Google"}
            </Text>
          </>
        )}
      </TouchableOpacity>
    </>
  );
}

// Tiny inline "G" logo so we don't ship a PNG
function GoogleGlyph() {
  return (
    <View style={{ width: 18, height: 18, alignItems: "center", justifyContent: "center" }}>
      <Text style={{
        fontSize: 16, fontWeight: "700", color: "#4285F4",
        fontFamily: Platform.OS === "ios" ? "Helvetica-Bold" : undefined,
      }}>
        G
      </Text>
    </View>
  );
}

function prettyAuthError(msg) {
  const raw = (msg || "").toLowerCase();
  if (raw.includes("invalid_grant") || raw.includes("nonce"))
    return "Sign-in token couldn't be verified. Try again.";
  if (raw.includes("network") || raw.includes("fetch"))
    return "Network error. Check your connection.";
  if (raw.includes("disabled") || raw.includes("provider not enabled"))
    return "This sign-in method isn't enabled yet. Contact support.";
  return msg || null;
}

function AuthSlide({ onDone, defaultMode = "signup" }) {
  const [mode,     setMode]     = useState(defaultMode); // "signup" | "login"
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [resending, setResending] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState("");
  const [error,    setError]    = useState("");
  const [notice,   setNotice]   = useState("");

  // Client-side rate limiting (anti-spam, not a security boundary)
  const resendAttemptsRef = useRef([]);

  async function handleOpenMail() {
    const url = Platform.OS === "ios" ? "message://" : "mailto:";
    const canOpen = await Linking.canOpenURL(url).catch(() => false);
    if (canOpen) {
      await Linking.openURL(url).catch(() => {});
    } else {
      Alert.alert("Open your email", "Open your email app and tap the latest Drift verification link.");
    }
  }

  async function handleResendVerification() {
    const cleanEmail = verificationEmail.trim().toLowerCase();
    const emailErr = validateEmail(cleanEmail);
    if (emailErr) { setError(emailErr); setNotice(""); return; }

    const now = Date.now();
    resendAttemptsRef.current = resendAttemptsRef.current.filter(t => now - t < 60_000);
    if (resendAttemptsRef.current.length >= 3) {
      setError("Too many resend attempts. Wait a minute and try again.");
      setNotice("");
      return;
    }
    resendAttemptsRef.current.push(now);

    setError("");
    setNotice("");
    setResending(true);
    try {
      const { error: resendErr } = await rateLimited("auth_resend_signup", { limit: 3, windowMs: 60_000 }, () =>
        supabase.auth.resend({
          type: "signup",
          email: cleanEmail,
          options: { emailRedirectTo: "drift://auth-callback" },
        })
      );
      if (resendErr) throw resendErr;
      setNotice("Verification email sent again.");
    } catch (e) {
      const raw = (e?.message || "").toLowerCase();
      if (raw.includes("rate") || raw.includes("too many")) {
        setError("Too many resend attempts. Try again in a few minutes.");
      } else if (raw.includes("network") || raw.includes("fetch")) {
        setError("Network error. Check your connection.");
      } else {
        setError("Could not resend the email. Try again.");
      }
      setNotice("");
    } finally {
      setResending(false);
    }
  }

  async function handleSubmit() {
    setError("");
    setNotice("");

    // Validate email
    const cleanEmail = email.trim().toLowerCase();
    const emailErr   = validateEmail(cleanEmail);
    if (emailErr) { setError(emailErr); return; }

    // Validate password. Strength rules apply to signup; existing users may
    // still have older passwords until Supabase policy forces a reset.
    if (!password) { setError("Password required."); return; }
    if (mode === "signup") {
      const pwErr = validatePassword(password);
      if (pwErr) { setError(pwErr); return; }
    }

    // Validate username (signup only) + availability check
    let cleanUsername = "";
    if (mode === "signup") {
      cleanUsername = normalizeUsername(username);
      const uErr = validateUsername(cleanUsername);
      if (uErr) { setError(uErr); return; }

      // Availability — case-insensitive
      try {
        const { data: taken, error: lookupErr } = await rateLimited("username_check", { limit: 40, windowMs: 60_000 }, () =>
          cached(`username_${cleanUsername}`, 30_000, () =>
            supabase.from("profiles").select("id").ilike("username", cleanUsername).maybeSingle()
          )
        );
        if (lookupErr) throw lookupErr;
        if (taken) { setError("That username is taken. Try another."); return; }
      } catch {
        setError("Could not check username availability. Try again.");
        return;
      }
    }

    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error: err } = await rateLimited(`auth_signup_${cleanEmail}`, { limit: AUTH_ATTEMPT_LIMIT, windowMs: AUTH_ATTEMPT_WINDOW_MS }, () =>
          supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              username:  cleanUsername,
              full_name: cleanUsername, // keep full_name for backwards-compat
            },
            emailRedirectTo: "drift://auth-callback",
          },
          })
        );
        if (err) throw err;

        // Profile row is created by the auth.users trigger (handle_new_user).
        // The trigger handles username collisions automatically by suffixing
        // _2, _3, etc. — so the user always ends up with SOME profile, even
        // if a race occurred. We surface the actual username they got.
        if (data.user) {
          const { data: prof } = await supabase
            .from("profiles").select("username").eq("id", data.user.id).maybeSingle();

          if (prof && prof.username !== cleanUsername) {
            // The trigger had to suffix because another user grabbed the name
            // in the same window. Don't sign them out — just inform them and
            // let them keep the suffixed name (they can change it later).
            setError(
              `That username was just taken. You've been assigned @${prof.username} for now — ` +
              `you can change it from your profile.`
            );
            // Continue with the rest of the flow — don't return early
          }
        }

        // Email confirmation flow (confirmed email setting ON)
        if (!data.session) {
          setVerificationEmail(cleanEmail);
          setError("");
          setNotice("");
          setLoading(false);
          return;
        }

        if (!isEmailVerified(data.user)) {
          await supabase.auth.signOut().catch(() => {});
          setVerificationEmail(cleanEmail);
          setError("");
          setNotice("Check your email to verify your account, then sign in again.");
          setLoading(false);
          return;
        }

        // (Payments removed — everyone is Pro for free; no trial to claim.)
        onDone(data.user);
      } else {
        const { data, error: err } = await rateLimited(`auth_signin_${cleanEmail}`, { limit: AUTH_ATTEMPT_LIMIT, windowMs: AUTH_ATTEMPT_WINDOW_MS }, () =>
          supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
          })
        );
        if (err) throw err;
        if (!isEmailVerified(data.user)) {
          await supabase.auth.signOut().catch(() => {});
          setVerificationEmail(cleanEmail);
          setError("");
          setNotice("Check your email to verify your account, then sign in again.");
          return;
        }
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
      } else if (raw.includes("email") && raw.includes("confirm")) {
        setError("Check your email to verify your account, then try signing in again.");
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

  if (verificationEmail) {
    return (
      <View style={styles.slide}>
        <View pointerEvents="none" style={styles.authSeeds}>
          <SeedDots size={170} color={ACCENT} opacity={0.045} />
        </View>
        <View pointerEvents="none" style={styles.authSprig}>
          <Sprig size={130} color={CLAY} opacity={0.052} />
        </View>

        <View style={styles.verifyContent}>
          <View style={styles.stepBadge}><WaveIcon size={24} color={ACCENT} /></View>
          <Text style={styles.question}>Check your email</Text>
          <Text style={styles.questionSub}>
            We sent a verification link to {verificationEmail}. Tap it on this device to finish creating your Drift account.
          </Text>

          <View style={styles.authForm}>
            <Text style={styles.verifyNote}>
              Once the link opens Drift, you will be signed in automatically.
            </Text>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            {notice ? <Text style={styles.noticeText}>{notice}</Text> : null}
          </View>
        </View>

        <TouchableOpacity
          style={styles.ctaBtn}
          onPress={handleOpenMail}
        >
          <Text style={styles.ctaBtnText}>Open email app</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.secondaryBtn, resending && styles.ctaBtnDisabled]}
          onPress={handleResendVerification}
          disabled={resending}
        >
          {resending ? (
            <ActivityIndicator color={ACCENT} />
          ) : (
            <Text style={styles.secondaryBtnText}>Resend email</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => { setVerificationEmail(""); setMode("login"); setError(""); setNotice(""); }}
          style={{ marginTop: 14, marginBottom: 32, alignItems: "center" }}
        >
          <Text style={styles.switchMode}>Back to sign in</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.slide}
      behavior={Platform.OS === "ios" ? "height" : undefined}
    >
      <View pointerEvents="none" style={styles.authSeeds}>
        <SeedDots size={170} color={ACCENT} opacity={0.045} />
      </View>
      <View pointerEvents="none" style={styles.authSprig}>
        <Sprig size={130} color={CLAY} opacity={0.052} />
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 20 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.stepBadge}><WaveIcon size={24} color={ACCENT} /></View>
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
              placeholder="12+ chars, number, symbol"
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

      {/* OAuth providers */}
      <OAuthButtons
        mode={mode}
        loading={loading}
        setLoading={setLoading}
        setError={setError}
        onDone={onDone}
      />

      {/* Terms + privacy disclosure shown to anyone creating an account */}
      {mode === "signup" && (
        <Text style={{ marginTop: 14, marginHorizontal: 24, textAlign: "center", color: MUTED, fontFamily: FF.body, fontSize: 11, lineHeight: 16 }}>
          By creating an account you agree to our{" "}
          <Text style={{ color: ACCENT, textDecorationLine: "underline" }}
            onPress={() => require("react-native").Linking.openURL("https://drift-landing-page-git-main-ridi-labs.vercel.app/terms")}>
            Terms of Use
          </Text>{" "}
          and{" "}
          <Text style={{ color: ACCENT, textDecorationLine: "underline" }}
            onPress={() => require("react-native").Linking.openURL("https://drift-landing-page-git-main-ridi-labs.vercel.app/privacy")}>
            Privacy Policy
          </Text>.
        </Text>
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
    paddingTop: Platform.OS === "ios" ? 56 : 34,
  },
  slide: {
    flex: 1,
    paddingHorizontal: 22,
    paddingBottom: Platform.OS === "ios" ? 72 : 52,
    overflow: "hidden",
  },

  // Welcome
  welcomeContent: { flex: 1, justifyContent: "center", paddingBottom: 36 },
  welcomeSprout: {
    position: "absolute",
    right: -58,
    bottom: 118,
    opacity: 0.13,
  },
  welcomeSprig: {
    position: "absolute",
    left: -32,
    top: 52,
  },
  welcomeLogo: {
    fontFamily: FF.kicker,
    fontSize: 12,
    color: ACCENT,
    letterSpacing: 4.2,
    textTransform: "uppercase",
    marginBottom: 34,
  },
  welcomeHeadline: {
    fontFamily: FF.display,
    fontSize: 42,
    color: TEXT,
    lineHeight: 48,
    letterSpacing: -0.2,
    marginBottom: 18,
  },
  welcomeSub: {
    fontFamily: FF.body,
    fontSize: 16,
    color: MUTED,
    lineHeight: 24,
  },

  // Question
  stepBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: SAGE_LO,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 22,
    marginTop: 6,
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
  question: {
    fontFamily: FF.display,
    fontSize: 33,
    color: TEXT,
    lineHeight: 39,
    letterSpacing: -0.2,
    marginBottom: 10,
  },
  questionSub: {
    fontFamily: FF.body,
    fontSize: 15,
    color: MUTED,
    marginBottom: 24,
    lineHeight: 22,
  },
  optionsScroll: { flex: 1 },
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 15,
    paddingHorizontal: 16,
    marginBottom: 9,
  },
  optionCardSelected: {
    borderColor: ACCENT,
    backgroundColor: SAGE_LO,
  },
  optionLabel: {
    fontFamily: FF.bodyMed,
    fontSize: 15,
    color: TEXT,
  },
  optionLabelSelected: { color: ACCENT },
  optionSub: {
    fontFamily: FF.body,
    fontSize: 13,
    color: MUTED,
    marginTop: 3,
  },
  optionSubSelected: { color: "#1A8050" },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },
  checkSelected: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },

  // Auth
  authSeeds: {
    position: "absolute",
    right: -28,
    top: 40,
  },
  authSprig: {
    position: "absolute",
    left: -28,
    bottom: 170,
  },
  verifyContent: {
    flex: 1,
    justifyContent: "center",
    paddingBottom: 24,
  },
  authForm: {
    marginTop: 8,
    padding: 14,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 1,
    borderColor: BORDER,
  },
  inputWrap: { marginBottom: 14 },
  inputLabel: {
    fontFamily: FF.kicker,
    fontSize: 13,
    color: FAINT,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 1.4,
  },
  input: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: FF.body,
    fontSize: 16,
    color: TEXT,
  },
  errorText: {
    color: "#E05050",
    fontFamily: FF.bodyMed,
    fontSize: 14,
    marginTop: 8,
    lineHeight: 20,
  },
  noticeText: {
    color: ACCENT,
    fontFamily: FF.bodyMed,
    fontSize: 14,
    marginTop: 8,
    lineHeight: 20,
  },
  verifyNote: {
    color: MUTED,
    fontFamily: FF.body,
    fontSize: 14,
    lineHeight: 21,
  },
  switchMode: {
    fontFamily: FF.bodyMed,
    color: MUTED,
    fontSize: 14,
  },

  // Buttons
  ctaBtn: {
    backgroundColor: "#1F3A2A",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 16,
  },
  ctaBtnDisabled: {
    backgroundColor: "#C7D5C9",
  },
  secondaryBtn: {
    backgroundColor: CARD_BG,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 10,
  },
  secondaryBtnText: {
    color: ACCENT,
    fontFamily: FF.bodyMed,
    fontSize: 15,
  },
  ctaBtnText: {
    color: "#FAF6EE",
    fontFamily: FF.bodyMed,
    fontSize: 15,
    letterSpacing: 0,
  },
  legal: {
    fontFamily: FF.body,
    color: MUTED,
    fontSize: 12,
    textAlign: "center",
    marginTop: 14,
  },

  // Progress
  progressWrap: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    paddingBottom: 18,
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
