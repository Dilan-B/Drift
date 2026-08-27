/**
 * OnboardingScreen.jsx
 * Opal-style onboarding: stats → goals → login
 */
import React, { useState, useRef, useEffect } from "react";
import { useFonts, Orbitron_700Bold, Orbitron_400Regular } from "@expo-google-fonts/orbitron";
import { Oswald_700Bold } from "@expo-google-fonts/oswald";
import {
  View, Text, TouchableOpacity, StyleSheet, Dimensions,
  ScrollView, Animated, StatusBar, TextInput, KeyboardAvoidingView,
  Platform, ActivityIndicator, Alert, Linking, Keyboard, PanResponder,
} from "react-native";
import { supabase } from "./supabase";
import { useGoogleSignIn } from "./oauthSignIn";
import { AppleSignInButton } from "./appleSignIn";
import { joinFamily, normalizeFamilyCode } from "./family";
import { cached, rateLimited } from "./apiGuards";
import { PhoneIcon, HoleIcon, CakeIcon, TargetIcon, WaveIcon, CheckIcon, LockIcon, ClipboardIcon, SparkleIcon, UsersIcon, BellIcon, LeafIcon, MicIcon } from "./Icons";
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
// Welcome "cover" — the first screen is a deep-forest moment with light type,
// like a book cover; the rest of the flow opens up into the cream interior.
const COVER_BG = "#16301F";
const COVER_INK = "#F0F7EA";
const COVER_MID = "#AFC7AF";
const COVER_MINT = "#C6F2A0";

// ─── Dev tools ──────────────────────────────────────────────────────────────
// TEMPORARY. Jump straight into either onboarding flow without wiping the app
// or making a new account. Gated on __DEV__ so it can never reach the App
// Store — flip this to `true` if you need it in a TestFlight/preview build,
// but flip it back before submitting.
export const SHOW_DEV_TOOLS = __DEV__;

function DevButton({ label, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={{
        borderWidth: 1, borderStyle: "dashed", borderColor: CLAY,
        borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12,
      }}
    >
      <Text style={{ fontFamily: FF.kicker, fontSize: 9, color: CLAY, letterSpacing: 1.4 }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Step data ──────────────────────────────────────────────────────────────

const STEPS = [
  { id: "welcome" },
  { id: "how1" },
  { id: "how2" },
  { id: "how3" },
  { id: "how4" },
  { id: "how5" },
  // Account type is chosen here — PERMANENTLY — before auth. It decides the
  // whole downstream flow: personal → normal signup + questionnaire; parent →
  // signup only (management account); child → passwordless join by family code.
  { id: "account_type" },
  // Auth now comes BEFORE the questionnaire. Users create their account first,
  // then answer the two questions that actually configure the app (which daily
  // tasks to seed, and how strict the Take button is). The old pre-signup
  // profiling questions (usage / wakeup / distractions / age / goals) were
  // dropped — too many questions before signup was driving people away.
  { id: "auth" },
  {
    id: "tasks",
    question: "Pick your daily\ntasks",
    subtitle: "Select tasks you'd do regularly. You can always add more later.",
    type: "multi",
    options: [
      { id: "make_bed", label: "Make your bed", sub: "2 min · Start the day right" },
      { id: "workout", label: "Work out", sub: "30 min · Exercise or gym" },
      { id: "read", label: "Read", sub: "20 min · Books or articles" },
      { id: "meditate", label: "Meditate", sub: "10 min · Breathe and reset" },
      { id: "journal", label: "Journal", sub: "10 min · Write your thoughts" },
      { id: "walk", label: "Go for a walk", sub: "15 min · Fresh air" },
      { id: "clean", label: "Clean / tidy up", sub: "15 min · Organize your space" },
      { id: "study", label: "Study", sub: "30 min · Homework or learning" },
      { id: "cook", label: "Cook a meal", sub: "20 min · Eat something real" },
      { id: "stretch", label: "Stretch", sub: "5 min · Loosen up" },
      { id: "no_phone_morning", label: "No phone for 1 hour", sub: "60 min · Morning detox" },
      { id: "practice", label: "Practice a skill", sub: "20 min · Music, art, code, etc." },
    ],
  },
  // NOTE: the old "How strict should Drift be?" step (1/3/7/15 min per tap) was
  // removed, and so is the "Take 15m" button it configured — unearned screen
  // time on a tap was working against the entire premise. Nothing in
  // onboarding sets a grant size any more because nothing grants.
  //
  // Last stop: offer the hands-off sources. One decision, skippable, and it's
  // the only place in onboarding that asks for a system permission.
  { id: "auto_tasks" },
];

// ─── Welcome Screen ──────────────────────────────────────────────────────────

function WelcomeSlide({ onNext, onDevPre, onDevPost }) {
  const [fontsLoaded] = useFonts({ Orbitron_700Bold, Orbitron_400Regular, Oswald_700Bold });
  const heroAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(heroAnim, { toValue: 1, useNativeDriver: true, tension: 50, friction: 9 }).start();
  }, []);
  return (
    <View style={styles.slide}>
      {/* aurora pools — soft light in the forest */}
      <View pointerEvents="none" style={styles.welcomeAuroraA} />
      <View pointerEvents="none" style={styles.welcomeAuroraB} />
      <View pointerEvents="none" style={styles.welcomeSprig}>
        <Sprig size={150} color={COVER_MINT} opacity={0.09} flip />
      </View>
      <View pointerEvents="none" style={styles.welcomeSeeds}>
        <SeedDots size={160} color={COVER_MINT} opacity={0.09} />
      </View>
      <View style={styles.welcomeContent}>
        <Text style={[styles.welcomeLogo, { fontFamily: "Orbitron_700Bold" }]}>DRIFT</Text>
        <Animated.View style={[styles.welcomeHero, {
          opacity: heroAnim,
          transform: [{ scale: heroAnim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
        }]}>
          <View style={styles.welcomeHeroRing}>
            <Sprout size={150} tone="fresh" />
          </View>
        </Animated.View>
        <Text style={[styles.welcomeHeadline, { fontFamily: FF.display }]}>{"Welcome to\nDrift"}</Text>
        <Text style={styles.welcomeSub}>
          Earn your screen time by getting real things done. Your phone unlocks when you do.
        </Text>
      </View>
      <TouchableOpacity style={[styles.ctaBtn, styles.ctaBtnCover]} onPress={onNext} activeOpacity={0.85}>
        <Text style={[styles.ctaBtnText, { color: "#16261C" }]}>Get Started</Text>
      </TouchableOpacity>
      <Text style={[styles.legal, { color: COVER_MID }]}>Takes 60 seconds</Text>

      {SHOW_DEV_TOOLS && (
        <View style={styles.devRow}>
          <DevButton label="DEV · PRE-SIGNUP" onPress={onDevPre} />
          <DevButton label="DEV · POST-SIGNUP" onPress={onDevPost} />
        </View>
      )}
    </View>
  );
}

// ─── How It Works Walkthrough ────────────────────────────────────────────────

const HOW_SLIDES = [
  {
    id: "how1",
    Icon: ClipboardIcon,
    headline: "Add real tasks",
    body: "Reading, working out, studying, cooking.\nAnything productive you'd actually do.",
    detail: "Each task has a time estimate and earns you screen time when you complete it.",
  },
  {
    id: "how2",
    Icon: SparkleIcon,
    headline: "Earn your time",
    body: "Complete a task, earn minutes.\nThe harder the task, the more you earn.",
    detail: "Your balance ticks down while you use blocked apps. Run out and they lock.",
  },
  {
    id: "how3",
    Icon: LockIcon,
    headline: "Apps lock when\nyou're out",
    body: "Choose which apps to block.\nDrift enforces it even when closed.",
    detail: "No willpower needed. The system does the hard part.",
  },
  {
    id: "how4",
    Icon: BellIcon,
    headline: "Tasks can add\nthemselves",
    body: "Save places like your gym, and Drift offers\nthe task when you arrive. It can pull in\ntoday's calendar events too.",
    detail: "Both are optional, off until you turn them on, and stay on your device. Find them in Profile → Automatic tasks.",
  },
  {
    id: "how5",
    Icon: MicIcon,
    headline: "Just ask Siri",
    body: "“Hey Siri, check my Drift balance”\n“Hey Siri, create a task in Drift”\n“Hey Siri, start a Drift In session”",
    detail: "Nothing to set up — the commands work as soon as Drift is installed. They show up in Shortcuts too.",
  },
];

function HowItWorksSlide({ slideData, stepNum, onNext }) {
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const opAnim = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    scaleAnim.setValue(0.9);
    opAnim.setValue(0);
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 80, friction: 10 }),
      Animated.timing(opAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
  }, [slideData.id]);

  return (
    <View style={styles.slide}>
      <View style={{ flex: 1, justifyContent: "center", paddingBottom: 40 }}>
        <Animated.View style={{
          opacity: opAnim,
          transform: [{ scale: scaleAnim }],
          alignItems: "center",
          marginBottom: 32,
        }}>
          <View style={styles.howIconRing}>
            <View style={styles.howIconDisc}>
              <slideData.Icon size={30} color={ACCENT} strokeWidth={1.8} />
            </View>
          </View>

          <Text style={styles.howKicker}>STEP {stepNum + 1} OF {HOW_SLIDES.length}</Text>

          <Text style={{
            fontFamily: FF.display,
            fontSize: 30,
            color: TEXT,
            textAlign: "center",
            lineHeight: 37,
            letterSpacing: -0.3,
            marginBottom: 14,
          }}>
            {slideData.headline}
          </Text>

          <Text style={{
            fontFamily: FF.body,
            fontSize: 16,
            color: MUTED,
            textAlign: "center",
            lineHeight: 24,
            marginBottom: 22,
            paddingHorizontal: 12,
          }}>
            {slideData.body}
          </Text>

          <View style={styles.howDetail}>
            <Text style={{
              fontFamily: FF.bodyMed,
              fontSize: 14,
              color: "#2D5A3E",
              textAlign: "center",
              lineHeight: 20,
            }}>
              {slideData.detail}
            </Text>
          </View>
        </Animated.View>

        <View style={{
          flexDirection: "row",
          justifyContent: "center",
          gap: 7,
          marginBottom: 8,
        }}>
          {HOW_SLIDES.map((s, i) => (
            <View key={s.id} style={{
              width: i === stepNum ? 22 : 7,
              height: 7, borderRadius: 4,
              backgroundColor: i === stepNum ? ACCENT : "#DCE5DC",
            }} />
          ))}
        </View>
      </View>

      <TouchableOpacity style={styles.ctaBtn} onPress={onNext}>
        <Text style={styles.ctaBtnText}>
          {stepNum === HOW_SLIDES.length - 1 ? "Let's set you up" : "Next"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Automatic tasks opt-in ──────────────────────────────────────────────────
// Deliberately a single yes/no. Turning it on requests the two permissions in
// sequence; declining either one just leaves that half off, and the app is
// fully functional either way.
/**
 * The little "two sources → one task" diagram that sits between the copy and
 * the buttons. Purely decorative, but it shows the shape of the feature faster
 * than another paragraph would.
 */
function AutoTasksDiagram() {
  const chip = {
    flexDirection: "row", alignItems: "center", gap: 7,
    backgroundColor: CARD_BG, borderRadius: 12,
    borderWidth: 1, borderColor: BORDER,
    paddingVertical: 9, paddingHorizontal: 12,
  };
  const chipText = { fontFamily: FF.bodyMed, fontSize: 12, color: TEXT };

  return (
    <View style={{ alignItems: "center", width: "100%" }}>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={chip}>
          <ClipboardIcon size={13} color={ACCENT} strokeWidth={1.8} />
          <Text style={chipText}>9:00 Standup</Text>
        </View>
        <View style={chip}>
          <LeafIcon size={13} color={CLAY} strokeWidth={1.8} />
          <Text style={chipText}>At the gym</Text>
        </View>
      </View>

      {/* Converging arms down into the single task card. */}
      <View style={{ flexDirection: "row", alignItems: "flex-start", height: 22 }}>
        <View style={{ width: 70, height: 11, borderRightWidth: 1.5, borderBottomWidth: 1.5, borderColor: "#CFDCD0", borderBottomRightRadius: 10 }} />
        <View style={{ width: 70, height: 11, borderLeftWidth: 1.5, borderBottomWidth: 1.5, borderColor: "#CFDCD0", borderBottomLeftRadius: 10 }} />
      </View>
      <View style={{ width: 1.5, height: 10, backgroundColor: "#CFDCD0", marginTop: -11 }} />

      <View style={{
        flexDirection: "row", alignItems: "center", gap: 9, marginTop: 10,
        backgroundColor: SAGE_LO, borderRadius: 14,
        borderWidth: 1, borderColor: "rgba(62,107,78,0.18)",
        paddingVertical: 11, paddingHorizontal: 16,
      }}>
        <CheckIcon size={14} color={ACCENT} strokeWidth={2} />
        <Text style={{ fontFamily: FF.bodyMed, fontSize: 13, color: "#2D5A3E" }}>
          Added to today — if you confirm
        </Text>
      </View>
    </View>
  );
}

function AutoTasksSlide({ onNext }) {
  // "idle" → "working" → "done". The done beat is held briefly on purpose:
  // permission dialogs resolve instantly once granted, and dropping straight
  // to Today made it feel like the tap did nothing.
  const [phase, setPhase] = useState("idle");
  const doneOp = useRef(new Animated.Value(0)).current;

  const enable = async () => {
    if (phase !== "idle") return;
    setPhase("working");
    try {
      // Calendar first: it's the less intrusive prompt, so a user who bails
      // after the first dialog still gets the more likely-useful half.
      try {
        const { setCalendarSyncEnabled, requestCalendarPermission, applyDefaultCalendarSelection } = require("./calendarSync");
        const ok = await requestCalendarPermission();
        if (ok) {
          await setCalendarSyncEnabled(true);
          await applyDefaultCalendarSelection();
        }
      } catch {}
      try {
        const { setSuggestionsEnabled } = require("./places");
        await setSuggestionsEnabled(true);
      } catch {}
    } finally {
      setPhase("done");
    }
  };

  // Hold the confirmation ~1.6s, then hand off.
  useEffect(() => {
    if (phase !== "done") return;
    Animated.timing(doneOp, { toValue: 1, duration: 320, useNativeDriver: true }).start();
    const t = setTimeout(onNext, 1600);
    return () => clearTimeout(t);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === "done") {
    return (
      <View style={[styles.slide, { alignItems: "center", justifyContent: "center" }]}>
        <Animated.View style={{ opacity: doneOp, alignItems: "center" }}>
          <View style={styles.howIconRing}>
            <View style={styles.howIconDisc}>
              <CheckIcon size={30} color={ACCENT} strokeWidth={2} />
            </View>
          </View>
          <Text style={{
            fontFamily: FF.display, fontSize: 27, color: TEXT,
            textAlign: "center", lineHeight: 34, letterSpacing: -0.3,
          }}>
            {"Getting it all\nset up for you"}
          </Text>
          <ActivityIndicator color={ACCENT} style={{ marginTop: 20 }} />
        </Animated.View>
      </View>
    );
  }

  return (
    <View style={styles.slide}>
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", paddingBottom: 16 }}>
        {/* Kicker sits above the icon on its own line — it used to collide
            with the bell disc. */}
        <Text style={[styles.howKicker, { marginBottom: 16 }]}>OPTIONAL</Text>

        <View style={styles.howIconRing}>
          <View style={styles.howIconDisc}>
            <BellIcon size={30} color={ACCENT} strokeWidth={1.8} />
          </View>
        </View>

        <Text style={{
          fontFamily: FF.display, fontSize: 30, color: TEXT,
          textAlign: "center", lineHeight: 37, letterSpacing: -0.3, marginBottom: 12,
        }}>
          {"Let tasks add\nthemselves?"}
        </Text>

        <Text style={{
          fontFamily: FF.body, fontSize: 16, color: MUTED,
          textAlign: "center", lineHeight: 23, marginBottom: 26, paddingHorizontal: 18,
        }}>
          Your calendar and your places, turned into tasks.
        </Text>

        <AutoTasksDiagram />
      </View>

      <TouchableOpacity style={styles.ctaBtn} onPress={enable} disabled={phase !== "idle"}>
        <Text style={styles.ctaBtnText}>
          {phase === "working" ? "Setting up…" : "Yes, set it up"}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onNext} disabled={phase !== "idle"} style={{ paddingVertical: 14, alignItems: "center" }}>
        <Text style={{ fontFamily: FF.body, fontSize: 14, color: MUTED }}>
          Not now
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Question Slide ──────────────────────────────────────────────────────────

function QuestionSlide({ step, answers, onToggle, onNext, canContinue, onSkip }) {
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

      {onSkip && (
        <TouchableOpacity onPress={onSkip} style={styles.skipBtn} activeOpacity={0.6}>
          <Text style={styles.skipText}>Skip for now</Text>
        </TouchableOpacity>
      )}
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

// ─── Form field with focus ring ──────────────────────────────────────────────
// Inputs sit slightly inset on the white form card; focusing lifts them to
// white with a green ring so it's always obvious where you're typing.
function Field({ label, inputRef, style, ...props }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.inputWrap}>
      {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
      <TextInput
        ref={inputRef}
        style={[styles.input, focused && styles.inputFocused, style]}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholderTextColor={FAINT}
        {...props}
      />
    </View>
  );
}

// ─── Social auth provider buttons (Apple + Google) ───────────────────────────
//
// NOT RENDERED. Drift is email-only. Kept intact rather than deleted so
// re-enabling is a one-line change at the (single) call site in AuthSlide, and
// so oauthSignIn.js / appleSignIn.js don't become orphaned dead code.
//
// If you DO re-enable it, two things travel with it:
//   1. Guideline 4.8 requires an equivalent privacy-preserving login alongside
//      Google. That is what the Apple button below is for — ship both or
//      neither, never Google alone.
//   2. EXPO_PUBLIC_GOOGLE_*_CLIENT_ID must reach the BUILD, not just your
//      local .env. Xcode Cloud clones the repo and .env is gitignored, so the
//      IDs have to be injected in ci_post_clone.sh or the block renders null.
function OAuthButtons({ mode, loading, setLoading, setError, onDone, dark = false }) {
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

  const handleApple = async (user) => {
    setError("");
    setLoading(false);
    onDone?.(user);
  };
  const handleAppleError = (err) => {
    setLoading(false);
    setError(prettyAuthError(err?.message) || "Apple sign-in failed.");
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

      {/* Apple — required equivalent login alongside Google (Guideline 4.8) */}
      <AppleSignInButton
        mode={mode}
        dark={dark}
        onDone={handleApple}
        onError={handleAppleError}
        style={{ marginBottom: 10 }}
      />

      {/* Google — Material-style button */}
      <TouchableOpacity
        onPress={handleGoogle}
        disabled={loading || !google.isReady}
        style={{
          height: 54, borderRadius: 16, backgroundColor: CARD_BG,
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

function AuthSlide({ onDone, defaultMode = "signup", accountType = "personal", onNewAccount }) {
  const [mode,     setMode]     = useState(defaultMode); // "signup" | "login"
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [resending, setResending] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error,    setError]    = useState("");
  const [notice,   setNotice]   = useState("");
  // When the keyboard is up we hide the social buttons / terms / switch link so
  // they don't crowd the form the user is typing into.
  const [keyboardUp, setKeyboardUp] = useState(false);
  const emailRef    = useRef(null);
  const passwordRef = useRef(null);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboardUp(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardUp(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Client-side rate limiting (anti-spam, not a security boundary)
  const resendAttemptsRef = useRef([]);

  async function handleOpenMail() {
    const url = Platform.OS === "ios" ? "message://" : "mailto:";
    const canOpen = await Linking.canOpenURL(url).catch(() => false);
    if (canOpen) {
      await Linking.openURL(url).catch(() => {});
    } else {
      Alert.alert("Open your email", "Open your email app and find your 6-digit Drift code.");
    }
  }

  async function handleVerifyOtp() {
    const cleanEmail = verificationEmail.trim().toLowerCase();
    const code = (verifyCode || "").replace(/\D/g, "").slice(0, 8);
    if (code.length !== 8) { setError("Enter the 8-digit code from your email."); setNotice(""); return; }
    setError(""); setNotice(""); setVerifying(true);
    try {
      const { data, error: vErr } = await rateLimited(`auth_verify_otp_${cleanEmail}`, { limit: 10, windowMs: 10 * 60_000 }, () =>
        supabase.auth.verifyOtp({ email: cleanEmail, token: code, type: "signup" })
      );
      if (vErr) throw vErr;
      const user = data?.user || data?.session?.user;
      if (!user) throw new Error("Verification failed. Try again.");
      setVerifyCode("");
      onDone(user);
    } catch (e) {
      const raw = (e?.message || "").toLowerCase();
      // Supabase returns a single combined message ("Token has expired or is
      // invalid") for both a wrong code AND an expired one — it doesn't tell us
      // which — so the message must cover both cases.
      if (raw.includes("expired") || raw.includes("invalid") || raw.includes("token") || raw.includes("otp")) {
        setError("That code is incorrect or expired. Double-check it, or tap Resend code for a new one.");
      } else if (raw.includes("network") || raw.includes("fetch")) {
        setError("Network error. Check your connection.");
      } else {
        setError(e?.message || "Could not verify. Try again.");
      }
      setNotice("");
    } finally {
      setVerifying(false);
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
              account_type: accountType, // 'personal' | 'parent' — read by handle_new_user
            },
            emailRedirectTo: "drift://auth-callback",
          },
          })
        );
        if (err) throw err;

        // Supabase does NOT error when the email already has an account (to
        // prevent enumeration). Instead it returns a "success" with a user whose
        // `identities` array is EMPTY. Detect that and block the signup with a
        // clear message instead of silently sending nothing.
        if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          setError("An account with that email already exists — switch to Sign in to log in.");
          setNotice("");
          setLoading(false);
          return;
        }

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
          <Text style={styles.question}>Enter your code</Text>
          <Text style={styles.questionSub}>
            We sent an 8-digit code to {verificationEmail}. Enter it below to finish creating your Drift account.
          </Text>

          <View style={styles.authForm}>
            <Field
              style={{ textAlign: "center", letterSpacing: 8, fontSize: 24, paddingVertical: 16 }}
              placeholder="00000000"
              value={verifyCode}
              onChangeText={(t) => setVerifyCode(t.replace(/\D/g, "").slice(0, 8))}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={8}
              returnKeyType="done"
              onSubmitEditing={handleVerifyOtp}
            />
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            {notice ? <Text style={styles.noticeText}>{notice}</Text> : null}
            <TouchableOpacity onPress={handleOpenMail} style={{ alignSelf: "center", marginTop: 2, padding: 6 }}>
              <Text style={styles.linkText}>Open my email app</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.ctaBtn, (verifying || verifyCode.length !== 8) && styles.ctaBtnDisabled]}
          onPress={handleVerifyOtp}
          disabled={verifying || verifyCode.length !== 8}
        >
          {verifying ? <ActivityIndicator color="#FAF6EE" /> : <Text style={styles.ctaBtnText}>Verify</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.secondaryBtn, resending && styles.ctaBtnDisabled]}
          onPress={handleResendVerification}
          disabled={resending}
        >
          {resending ? (
            <ActivityIndicator color={ACCENT} />
          ) : (
            <Text style={styles.secondaryBtnText}>Resend code</Text>
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
            <Field
              label="Username"
              placeholder="3–20 chars, letters/numbers/_"
              value={username}
              onChangeText={(t) => setUsername(normalizeUsername(t))}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              onSubmitEditing={() => emailRef.current?.focus()}
              blurOnSubmit={false}
              maxLength={20}
            />
          )}

          <Field
            label="Email"
            inputRef={emailRef}
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            blurOnSubmit={false}
            maxLength={100}
          />

          <Field
            label="Password"
            inputRef={passwordRef}
            placeholder="12+ chars, number, symbol"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            returnKeyType={mode === "signup" ? "done" : "go"}
            onSubmitEditing={handleSubmit}
            maxLength={72}
          />

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {mode === "signup" ? (
            <Text style={styles.authHint}>
              Email accounts must be verified before Drift unlocks.
            </Text>
          ) : null}
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

      {/* Auth is EMAIL ONLY. OAuthButtons (Apple + Google) is deliberately not
          rendered — see the note on the component itself for why and for how to
          turn it back on. Leaving it out explicitly beats the previous state,
          where the buttons happened to disappear in shipped builds only because
          the EXPO_PUBLIC_GOOGLE_* client IDs were missing from CI. That made
          behaviour depend on whether a gitignored .env existed at build time:
          visible-but-broken in Expo Go, absent in TestFlight, and silently back
          the moment anyone wired those vars into Xcode Cloud. */}

      {/* Terms + privacy disclosure shown to anyone creating an account */}
      {!keyboardUp && mode === "signup" && (
        <Text style={{ marginTop: 14, marginHorizontal: 24, textAlign: "center", color: MUTED, fontFamily: FF.body, fontSize: 11, lineHeight: 16 }}>
          By creating an account you agree to our{" "}
          <Text style={{ color: ACCENT, textDecorationLine: "underline" }}
            onPress={() => require("react-native").Linking.openURL("https://driftproductivity.com/terms/")}>
            Terms of Use
          </Text>{" "}
          and{" "}
          <Text style={{ color: ACCENT, textDecorationLine: "underline" }}
            onPress={() => require("react-native").Linking.openURL("https://driftproductivity.com/privacy/")}>
            Privacy Policy
          </Text>.
        </Text>
      )}

      {!keyboardUp && (
      <TouchableOpacity
        onPress={() => {
          setError("");
          if (mode === "signup") { setMode("login"); return; }
          // Switching to "create account": go pick an account type first (so a
          // returning device isn't locked into a personal-only signup).
          if (onNewAccount) onNewAccount(); else setMode("signup");
        }}
        style={{ marginTop: 14, marginBottom: 32, alignItems: "center" }}
      >
        <Text style={styles.switchMode}>
          {mode === "signup"
            ? "Already have an account? Sign in"
            : "No account yet? Sign up"}
        </Text>
      </TouchableOpacity>
      )}
    </KeyboardAvoidingView>
  );
}

// ─── Account-type selection ──────────────────────────────────────────────────

const ACCOUNT_TYPES = [
  { id: "personal", label: "Just me", sub: "Earn your own screen time by completing tasks." },
  { id: "parent",   label: "I'm a parent", sub: "Set tasks for your kids and approve their screen time." },
  { id: "child",    label: "I'm a kid", sub: "Join your family with a code from your parent." },
];

function AccountTypeSlide({ selected, onSelect, onNext }) {
  return (
    <View style={styles.slide}>
      <View style={{ flex: 1 }}>
        <View style={styles.stepBadge}><UsersIcon size={24} color={ACCENT} /></View>
        <Text style={styles.question}>Who's using{"\n"}Drift?</Text>
        <Text style={styles.questionSub}>Pick the one that fits — this can't be changed later.</Text>
        <ScrollView style={styles.optionsScroll} showsVerticalScrollIndicator={false}>
          {ACCOUNT_TYPES.map((opt) => {
            const sel = selected === opt.id;
            return (
              <TouchableOpacity
                key={opt.id}
                style={[styles.optionCard, sel && styles.optionCardSelected]}
                onPress={() => onSelect(opt.id)}
                activeOpacity={0.75}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.optionLabel, sel && styles.optionLabelSelected]}>{opt.label}</Text>
                  <Text style={[styles.optionSub, sel && styles.optionSubSelected]}>{opt.sub}</Text>
                </View>
                <View style={[styles.check, sel && styles.checkSelected]}>
                  {sel && <CheckIcon size={14} color="#fff" />}
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <Text style={styles.authHint}>You can't switch account types after your account is created.</Text>
      </View>
      <TouchableOpacity
        style={[styles.ctaBtn, !selected && styles.ctaBtnDisabled]}
        onPress={selected ? onNext : null}
        activeOpacity={selected ? 0.8 : 1}
      >
        <Text style={styles.ctaBtnText}>Continue</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Child join (name + family code, no email/password) ──────────────────────

function ChildJoinSlide({ onDone }) {
  const [name,    setName]    = useState("");
  const [code,    setCode]    = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  async function submit() {
    setError("");
    const n = name.trim();
    const c = normalizeFamilyCode(code);
    if (n.length < 1) { setError("Enter your name."); return; }
    if (c.length < 4) { setError("Enter the family code from your parent."); return; }
    setLoading(true);
    const res = await joinFamily(c, n);
    setLoading(false);
    if (!res.ok) {
      const map = {
        invalid_code: "That family code doesn't exist. Double-check it with your parent.",
        inactive:     "That family code isn't active anymore.",
        family_full:  "This family already has the maximum number of kids.",
        // Distinct from family_full on purpose: this one is fixable, and only
        // the parent can fix it. Saying "full" would send the kid to try again
        // forever.
        no_seats:     "Every seat in this family is taken. Ask your parent to add one in Drift, then try again.",
        bad_name:     "Enter your name.",
        network:      "Network error. Check your connection.",
        session:      "Couldn't finish signing in. Try again.",
      };
      setError(map[res.reason] || "Couldn't join the family. Try again.");
      return;
    }
    onDone(res.user);
  }

  return (
    <KeyboardAvoidingView style={styles.slide} behavior={Platform.OS === "ios" ? "height" : undefined}>
      <View pointerEvents="none" style={styles.authSeeds}>
        <SeedDots size={170} color={ACCENT} opacity={0.045} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.stepBadge}><WaveIcon size={24} color={ACCENT} /></View>
        <Text style={styles.question}>Join your{"\n"}family</Text>
        <Text style={styles.questionSub}>
          Type your name and the family code your parent gives you. No email needed.
        </Text>
        <View style={styles.authForm}>
          <Field
            label="Your name"
            placeholder="Alex"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="next"
            maxLength={40}
          />
          <Field
            label="Family code"
            style={{ letterSpacing: 4, textAlign: "center", fontSize: 20 }}
            placeholder="ABC123"
            value={code}
            onChangeText={(t) => setCode(normalizeFamilyCode(t))}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={submit}
            maxLength={12}
          />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
      </View>
      <TouchableOpacity
        style={[styles.ctaBtn, loading && styles.ctaBtnDisabled]}
        onPress={submit}
        disabled={loading}
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaBtnText}>Join family</Text>}
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
  // Chosen at the account_type step (personal | parent | child). Drives auth
  // rendering and whether the post-signup questionnaire runs. Returning sign-ins
  // skip selection and inherit their real type from the profile server-side.
  const [accountType, setAccountType] = useState("personal");
  // A returning device opens on the sign-in slide (signInOnly). If that user
  // chooses to CREATE a new account, we flip this so they run the real signup
  // flow — account-type picker included — instead of being stuck on sign-in.
  const [forceSignup, setForceSignup] = useState(false);
  const isNewSignup = !signInOnly || forceSignup;
  // The authenticated user is captured at the auth step, then carried through
  // the post-signup questionnaire until we finish and hand it to onComplete.
  const authedUserRef = useRef(null);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  function goToAccountType() {
    setForceSignup(true);
    setStepIndex(STEPS.findIndex((s) => s.id === "account_type"));
  }

  const step = STEPS[stepIndex];

  // Back navigation. Auth (during signup) returns to the account-type picker so
  // a wrong pick is easy to undo; the picker itself returns to sign-in if the
  // user came from there, otherwise to the previous slide.
  //
  // "tasks" is deliberately excluded: it's the first post-signup step, and the
  // slide before it is auth — the account already exists by then, so going back
  // there would offer to sign up again.
  const canGoBack =
    step.id?.startsWith("how") ||
    step.id === "account_type" ||
    (step.id === "auth" && isNewSignup) ||
    step.id === "auto_tasks";

  function goBack() {
    if (!canGoBack) return;
    Keyboard.dismiss();
    if (step.id === "auth") {
      setStepIndex(STEPS.findIndex((s) => s.id === "account_type"));
      return;
    }
    if (step.id === "account_type" && forceSignup) {
      setForceSignup(false);
      setStepIndex(STEPS.findIndex((s) => s.id === "auth"));
      return;
    }
    setStepIndex((i) => Math.max(0, i - 1));
  }

  // Swipe right anywhere on the slide to go back — the same affordance as the
  // button, for people who never look at the top-left corner. Only claims the
  // gesture on a decisive mostly-horizontal drag so it can't steal scrolling
  // from the option lists or the keyboard-avoiding auth form.
  const backSwipe = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        g.dx > 18 && Math.abs(g.dx) > Math.abs(g.dy) * 2.2,
      onPanResponderRelease: (_e, g) => {
        if (g.dx > 60) goBackRef.current?.();
      },
    })
  ).current;
  // The responder is created once, so point it at the latest goBack.
  const goBackRef = useRef(goBack);
  goBackRef.current = goBack;
  // TEMPORARY dev jumps. Pre-signup restarts at the welcome cover; post-signup
  // lands on the first questionnaire step, the same place a real signup arrives
  // at. Post-signup normally requires an authed user — when there isn't one,
  // finishing just completes with whatever answers were given, which is enough
  // to eyeball the slides.
  function devGoPreSignup() {
    setAnswers({});
    setStepIndex(0);
  }
  function devGoPostSignup() {
    // Jumps past the auth step, so handleAuthDone never runs and
    // authedUserRef stays nil. If there is also no Supabase session on the
    // device, finish() then calls onComplete with no user and onboarding
    // cannot complete — which looks like the last slide hanging forever.
    // Say so up front instead of letting it look like a real bug.
    if (!authedUserRef.current) {
      supabase.auth.getSession().then(({ data }) => {
        if (!data?.session?.user?.id) {
          Alert.alert(
            "DEV skip — no session",
            "This jumps past sign-in, so onboarding won't be able to finish. Sign in normally to test the full flow.",
          );
        }
      }).catch(() => {});
    }
    setStepIndex(STEPS.findIndex((s) => s.id === "tasks"));
  }

  // Progress reflects only the real questions (tasks + difficulty), not the
  // welcome / how-it-works / auth slides.
  const totalQuestions = STEPS.filter((s) => s.options).length;
  const questionIndex = STEPS.slice(0, stepIndex).filter((s) => s.options).length;

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

  function finish() {
    onComplete({ user: authedUserRef.current, answers: { ...answers, account_type: accountType } });
  }

  function goNext() {
    const nextIndex = stepIndex + 1;
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
    setTimeout(() => {
      if (nextIndex >= STEPS.length) { finish(); return; }
      setStepIndex(nextIndex);
    }, 150);
  }

  function handleAuthDone(user) {
    authedUserRef.current = user;
    // Pure sign-in (returning user, not creating a new account) — finish now.
    // Their real account type is resolved from the profile server-side.
    if (!isNewSignup) { onComplete({ user, answers: {} }); return; }
    // Parents and children are management/child accounts — they skip the
    // personal task/difficulty questionnaire entirely.
    if (accountType === "parent" || accountType === "child") {
      onComplete({ user, answers: { account_type: accountType } });
      return;
    }
    // Personal signups continue into the shortened post-signup questionnaire.
    goNext();
  }

  const onCover = step.id === "welcome";

  return (
    <View style={[styles.container, onCover && { backgroundColor: COVER_BG }]}>
      <StatusBar barStyle={onCover ? "light-content" : "dark-content"} />

      {/* Quiet aurora pools behind the cream interior — same language as the
          forest cover and the in-app hero card. */}
      {!onCover && (
        <>
          <View pointerEvents="none" style={styles.interiorAuroraA} />
          <View pointerEvents="none" style={styles.interiorAuroraB} />
        </>
      )}

      {/* Back button — lets users undo a step (e.g. change account type). */}
      <View style={styles.backRow}>
        {canGoBack && (
          <TouchableOpacity onPress={goBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={styles.backBtn}>
            <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
              <SvgPath d="M15 5l-7 7 7 7" stroke={TEXT} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>
        )}
      </View>

      {/* Progress bar (hidden on welcome/account-type/auth/how slides) */}
      {step.id !== "welcome" && step.id !== "auth" && step.id !== "account_type" && step.id !== "auto_tasks" && !step.id?.startsWith("how") && (
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

      <Animated.View style={{ flex: 1, opacity: fadeAnim }} {...(canGoBack ? backSwipe.panHandlers : {})}>
        {step.id === "welcome" && (
          <WelcomeSlide
            onNext={goNext}
            onDevPre={devGoPreSignup}
            onDevPost={devGoPostSignup}
          />
        )}
        {step.id?.startsWith("how") && (
          <HowItWorksSlide
            slideData={HOW_SLIDES.find(s => s.id === step.id)}
            stepNum={HOW_SLIDES.findIndex(s => s.id === step.id)}
            onNext={goNext}
          />
        )}
        {step.id === "account_type" && (
          <AccountTypeSlide
            selected={accountType}
            onSelect={setAccountType}
            onNext={goNext}
          />
        )}
        {step.id === "auto_tasks" && <AutoTasksSlide onNext={goNext} />}
        {step.id === "auth" && accountType === "child" && isNewSignup && (
          <ChildJoinSlide onDone={handleAuthDone} />
        )}
        {step.id === "auth" && !(accountType === "child" && isNewSignup) && (
          <AuthSlide
            onDone={handleAuthDone}
            defaultMode={isNewSignup ? "signup" : "login"}
            accountType={accountType}
            onNewAccount={goToAccountType}
          />
        )}
        {step.options && (
          <QuestionSlide
            step={step}
            answers={answers}
            onToggle={toggleAnswer}
            onNext={goNext}
            canContinue={canContinue()}
            // Task seeding is genuinely optional — you can add tasks any time.
            // Skipping clears the step so no tasks get seeded from a stale pick.
            onSkip={step.id === "tasks" ? () => {
              setAnswers(prev => ({ ...prev, tasks: [] }));
              goNext();
            } : null}
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
  backRow: { height: 34, justifyContent: "center", paddingHorizontal: 12 },
  backBtn: { width: 40, height: 34, justifyContent: "center" },
  slide: {
    flex: 1,
    paddingHorizontal: 22,
    paddingBottom: Platform.OS === "ios" ? 72 : 52,
    overflow: "hidden",
  },

  // Interior aurora (all non-cover slides)
  interiorAuroraA: {
    position: "absolute",
    top: -120,
    right: -100,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: "rgba(62,107,78,0.05)",
  },
  interiorAuroraB: {
    position: "absolute",
    bottom: -100,
    left: -120,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: "rgba(176,118,78,0.04)",
  },

  // Welcome (forest cover)
  welcomeContent: { flex: 1, justifyContent: "center", alignItems: "center", paddingBottom: 28 },
  welcomeAuroraA: {
    position: "absolute",
    top: -110,
    right: -90,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: "rgba(127,227,165,0.10)",
  },
  welcomeAuroraB: {
    position: "absolute",
    bottom: -70,
    left: -110,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: "rgba(240,185,132,0.07)",
  },
  welcomeSprig: {
    position: "absolute",
    left: -32,
    top: 52,
  },
  welcomeSeeds: {
    position: "absolute",
    right: -30,
    bottom: 130,
  },
  welcomeLogo: {
    fontFamily: FF.kicker,
    fontSize: 12,
    color: COVER_MINT,
    letterSpacing: 4.2,
    textTransform: "uppercase",
    marginBottom: 30,
  },
  welcomeHero: {
    marginBottom: 30,
  },
  welcomeHeroRing: {
    width: 186,
    height: 186,
    borderRadius: 93,
    backgroundColor: "rgba(240,247,234,0.07)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(198,242,160,0.24)",
  },
  welcomeHeadline: {
    fontFamily: FF.display,
    fontSize: 40,
    color: COVER_INK,
    lineHeight: 47,
    letterSpacing: -0.2,
    marginBottom: 14,
    textAlign: "center",
  },
  welcomeSub: {
    fontFamily: FF.body,
    fontSize: 16,
    color: COVER_MID,
    lineHeight: 24,
    textAlign: "center",
    paddingHorizontal: 14,
  },

  // How-it-works
  howIconRing: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: SAGE_LO,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  howIconDisc: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: CARD_BG,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: HAIRLINE,
    shadowColor: "#1F3A2A",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  howKicker: {
    fontFamily: FF.kicker,
    fontSize: 11,
    color: ACCENT,
    letterSpacing: 3,
    marginBottom: 12,
  },
  howDetail: {
    backgroundColor: SAGE_LO,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginHorizontal: 8,
  },

  // Question
  stepBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: CARD_BG,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
    marginTop: 6,
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: "#1F3A2A",
    shadowOpacity: 0.07,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
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
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 16,
    paddingHorizontal: 18,
    marginBottom: 10,
    shadowColor: "#1F3A2A",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  optionCardSelected: {
    borderColor: ACCENT,
    backgroundColor: SAGE_LO,
    shadowOpacity: 0.09,
  },
  optionLabel: {
    fontFamily: FF.bodyMed,
    fontSize: 15,
    color: TEXT,
  },
  optionLabelSelected: { color: "#1F3A2A" },
  optionSub: {
    fontFamily: FF.body,
    fontSize: 13,
    color: MUTED,
    marginTop: 3,
  },
  optionSubSelected: { color: "#2D5A3E" },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: "#D3DCD3",
    backgroundColor: CARD_BG,
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
    padding: 18,
    borderRadius: 22,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: HAIRLINE,
    shadowColor: "#1F3A2A",
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  inputWrap: { marginBottom: 14 },
  inputLabel: {
    fontFamily: FF.bodyMed,
    fontSize: 13,
    color: MUTED,
    marginBottom: 7,
    letterSpacing: 0.2,
  },
  input: {
    backgroundColor: BG,
    borderWidth: 1.5,
    borderColor: "transparent",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: FF.body,
    fontSize: 16,
    color: TEXT,
  },
  inputFocused: {
    borderColor: ACCENT,
    backgroundColor: CARD_BG,
  },
  errorText: {
    color: "#B5564B",
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
  authHint: {
    color: MUTED,
    fontFamily: FF.body,
    fontSize: 12,
    marginTop: 10,
    lineHeight: 17,
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
  linkText: {
    fontFamily: FF.bodyMed,
    color: ACCENT,
    fontSize: 14,
  },

  // Buttons
  ctaBtn: {
    backgroundColor: "#3A6B4F",   // lifted from #1F3A2A — see theme.js earn.deep
    borderRadius: 16,
    paddingVertical: 17,
    alignItems: "center",
    marginTop: 16,
    shadowColor: "#1F3A2A",
    shadowOpacity: 0.24,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  ctaBtnDisabled: {
    backgroundColor: "#C7D5C9",
    shadowOpacity: 0,
    elevation: 0,
  },
  // Deliberately quiet: an escape hatch, not a second call to action.
  skipBtn: { paddingVertical: 12, alignItems: "center" },
  skipText: { fontFamily: FF.body, fontSize: 13, color: FAINT },
  // TEMPORARY dev-tool row — see SHOW_DEV_TOOLS.
  devRow: { flexDirection: "row", justifyContent: "center", gap: 8, marginTop: 12 },
  // Cover variant — a light source against the forest
  ctaBtnCover: {
    backgroundColor: COVER_MINT,
    shadowColor: COVER_MINT,
    shadowOpacity: 0.3,
  },
  secondaryBtn: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
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
    fontSize: 16,
    letterSpacing: 0.2,
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
    height: 4,
    borderRadius: 2,
    backgroundColor: "#E2E9E1",
  },
  progressDotDone: { backgroundColor: "#5B8A6D" },
  progressDotActive: { backgroundColor: ACCENT },
});
