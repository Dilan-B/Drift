/**
 * AICheckModal.jsx
 * AI task verification via the Supabase Edge Function proxy.
 * The OpenAI key never touches this client — it lives in Supabase secrets.
 * Rate limits (5/hour, 20/day) are enforced server-side.
 *
 * Three proof channels: a written account, a photo, or a short video. Video is
 * the strong one — the server will accept a video as evidence of a COUNT
 * ("10 push-ups") and will not accept a single photo for the same claim, since
 * a still can show someone in position but never how many times.
 *
 * The countdown below is a courtesy, not a control. The real gate lives in
 * verify-task, which reads created_at off the database row; this just spares
 * the user a round-trip to be told to wait.
 */
import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, TouchableOpacity, TextInput, StyleSheet,
  ScrollView, Modal, ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform,
} from "react-native";
import { supabase } from "./supabase";
import { FF, getTheme } from "./theme";
import { Spinner } from "./Skeleton";
import { CloseIcon, CameraIcon, ImageIcon, SparkleIcon, CheckIcon, VideoIcon, ClockIcon } from "./Icons";
import { rateLimited } from "./apiGuards";
import {
  preparePhoto, prepareVideo, videoSupported, photoSupported,
  VIDEO_MAX_SECONDS,
} from "./proofMedia";

// Remapped onto the organic-editorial system — see theme.js FF.
const FO  = FF.bodyBold;
const FOM = FF.kicker;
const FK  = FF.bodyMed;
const FB  = FF.body;

// ── Attempt to import expo-image-picker ───────────────────────
let ImagePicker = null;
try { ImagePicker = require("expo-image-picker"); } catch {}

// Public Wi-Fi (gyms, cafés, campuses) is the single most common cause of this
// failing while the phone insists it's online: the captive portal accepts the
// association, shows full bars, and then silently drops or hijacks HTTPS to
// hosts it hasn't whitelisted. iOS keeps routing over Wi-Fi because it looks
// connected, so cellular never takes over. Naming that beats "check your
// connection", which is the one thing the user has already verified.
const NO_REACH_MSG =
  "Couldn't reach the AI service. If you're on public Wi-Fi (a gym, café or campus network), it may be blocking Drift — turn Wi-Fi off to use cellular and try again.";

// How long we'll wait for the edge function before giving up. The server aims
// to answer within ~45s; past 55s the request is not going to land, and
// without this the platform default leaves the spinner up indefinitely on a
// half-open connection — which is what a captive portal produces.
//
// Raised from 50s because verification is now three model calls (transcribe,
// then judge, plus the capturability pre-flight) instead of two, and a video
// bundle is five images to read rather than one.
const INVOKE_TIMEOUT_MS = 58_000;

// Must match requiredWaitMs() in supabase/functions/verify-task/index.ts. If
// these drift apart the countdown lies, so they are stated in both places
// deliberately rather than shipped from the server per-task.
const GATE_FRACTION = 0.5;
const GATE_MIN_MS   = 60_000;
const GATE_MAX_MS   = 120 * 60_000;
const requiredWaitMs = (minutes) =>
  Math.min(GATE_MAX_MS, Math.max(GATE_MIN_MS, (Number(minutes) || 0) * 60_000 * GATE_FRACTION));

const mmss = (ms) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
           : `${m}:${String(s).padStart(2, "0")}`;
};

/**
 * Reject if `promise` hasn't settled in `ms`.
 *
 * supabase-js has no per-invoke timeout, and React Native's underlying fetch
 * will happily sit on a connection that was accepted but never answered — the
 * exact failure a captive portal produces. Without this the user watches a
 * spinner until they force-quit, which is what "restarting didn't help" looks
 * like from the inside.
 */
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      const e = new Error("Request timed out");
      e.name = "AbortError";
      reject(e);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ── Main Modal Component ──────────────────────────────────────
export default function AICheckModal({ visible, task, onVerified, onCancel, dark = false }) {
  const theme = getTheme(dark);
  const BG   = theme.paper.card;
  const SURF = theme.paper.warm;
  const TXT  = theme.ink.deep;
  const MID  = theme.ink.mid;
  const BRD  = theme.ink.border;
  const GRN  = theme.earn.green;
  const RED  = "#B5564B";

  const [proofText, setProofText] = useState("");
  const [photo,     setPhoto]     = useState(null); // { uri, base64 } | null
  const [video,     setVideo]     = useState(null); // { uri, frames, durationSec } | null
  const [preparing, setPreparing] = useState("");   // progress label while encoding
  const [loading,   setLoading]   = useState(false);
  const [result,    setResult]    = useState(null); // { verified, confidence, message } | null
  const [rateLimitMsg, setRateLimitMsg] = useState("");
  const [nowMs,     setNowMs]     = useState(() => Date.now());
  // The verifier asked for one clarification instead of rejecting. Holding a
  // question here means an ambiguous-but-honest submission gets a way through
  // rather than a flat no — which is the failure mode that actually costs a
  // real user their credits.
  const [question,  setQuestion]  = useState("");
  const [answer,    setAnswer]    = useState("");

  // ── The unlock countdown ───────────────────────────────────
  // A task can't be proven the instant it's created. Anchored on createdAt,
  // which the server also holds — if the local field is missing (a task
  // created before this shipped, or one not yet round-tripped), we treat the
  // gate as open here and let the server be the one to say no. Guessing
  // "locked" locally on missing data would strand old tasks permanently.
  const createdMs = task?.createdAt ? Date.parse(task.createdAt) : NaN;
  const gateMs    = requiredWaitMs(task?.minutes);
  // Tasks logged after the fact have nothing to wait for — the work predates
  // the row. The server agrees (it reads logged_retroactively off the task),
  // so showing a countdown here would be a lie the server wouldn't enforce.
  const retro     = !!task?.loggedRetroactively;
  const unlocksAt = !retro && Number.isFinite(createdMs) ? createdMs + gateMs : null;
  const remaining = unlocksAt ? Math.max(0, unlocksAt - nowMs) : 0;
  const locked    = remaining > 0;

  useEffect(() => {
    if (!visible || !locked) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [visible, locked]);

  useEffect(() => {
    if (!visible) {
      setProofText(""); setPhoto(null); setVideo(null); setResult(null);
      setLoading(false); setPreparing(""); setRateLimitMsg("");
      setQuestion(""); setAnswer("");
    } else {
      setNowMs(Date.now());
    }
  }, [visible]);

  // ── Media capture ────────────────────────────────────────────
  const needPicker = () => {
    if (!ImagePicker) {
      Alert.alert("Not available", "Run: npx expo install expo-image-picker");
      return true;
    }
    return false;
  };

  const acceptPhoto = async (asset) => {
    setPreparing("Preparing photo…");
    try {
      const out = await preparePhoto(asset.uri);
      if (out.error === "unsupported") {
        Alert.alert("Not available", "Image processing isn't installed in this build. Use text or video proof.");
        return;
      }
      if (out.error) {
        Alert.alert("Photo too large", "Couldn't compress that photo enough. Try another shot.");
        return;
      }
      setVideo(null);
      setPhoto({ uri: asset.uri, base64: out.base64 });
    } finally {
      setPreparing("");
    }
  };

  const pickPhoto = async () => {
    if (needPicker()) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") { Alert.alert("Permission denied", "Allow photo access in Settings."); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.6,
      base64: false,
      exif: false,
    });
    if (!res.canceled && res.assets?.[0]) await acceptPhoto(res.assets[0]);
  };

  const takePhoto = async () => {
    if (needPicker()) return;
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") { Alert.alert("Permission denied", "Allow camera in Settings."); return; }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.6, base64: false });
    if (!res.canceled && res.assets?.[0]) await acceptPhoto(res.assets[0]);
  };

  const recordVideo = async () => {
    if (needPicker()) return;
    if (!videoSupported()) {
      Alert.alert(
        "Video proof needs a new build",
        "Run: npx expo install expo-video-thumbnails, then rebuild the app. Photo and written proof still work."
      );
      return;
    }
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") { Alert.alert("Permission denied", "Allow camera in Settings."); return; }

    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ["videos"],
      videoMaxDuration: VIDEO_MAX_SECONDS,
      // Low quality on purpose. We only ever send sampled stills, so recording
      // at 4K costs the user storage and us extraction time for pixels that
      // get thrown away.
      videoQuality: ImagePicker.UIImagePickerControllerQualityType?.Low ?? 2,
      quality: 0.5,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];

    setPreparing("Reading your clip…");
    try {
      const out = await prepareVideo(asset.uri, asset.duration, (done, total) =>
        setPreparing(`Reading your clip… ${done}/${total}`)
      );
      if (out.error === "unsupported") {
        Alert.alert("Video proof needs a new build", "Rebuild with expo-video-thumbnails installed.");
        return;
      }
      if (out.error === "too_long") {
        Alert.alert("Clip too long", `Keep it under ${VIDEO_MAX_SECONDS} seconds — that's plenty to show the work.`);
        return;
      }
      if (out.error === "file_too_large") {
        Alert.alert("Clip too heavy", "That recording is enormous. Record a shorter clip and try again.");
        return;
      }
      if (out.error === "no_frames") {
        Alert.alert("Couldn't read that clip", "No frames came out of it. Try recording again.");
        return;
      }
      if (out.error) {
        Alert.alert("Clip too heavy", "Couldn't compress that clip down far enough. Record a shorter one.");
        return;
      }
      setPhoto(null);
      setVideo({ uri: asset.uri, frames: out.frames, durationSec: out.durationSec });
    } finally {
      setPreparing("");
    }
  };

  // ── Submit to Supabase Edge Function ─────────────────────────
  // All AI calls happen server-side in the verify-task edge function.
  // There is no client-side OpenAI path in any build.

  const submit = async ({ answering = false } = {}) => {
    if (locked) return;
    if (answering && !answer.trim()) {
      Alert.alert("Add an answer", "Answer the question to finish verifying.");
      return;
    }
    if (!answering && !proofText.trim() && !photo && !video) {
      Alert.alert("Add proof", "Write what you did, or capture a photo or video.");
      return;
    }
    setLoading(true);
    setRateLimitMsg("");
    try {
      // Try the Supabase Edge Function. Read the JSON body even on non-2xx so
      // we can distinguish 402 (paywall) from 425 (too early) from 429 (rate
      // limit) from 500 (broken).
      let body = null;
      let status = 0;
      let invokeErr = null;
      try {
        const res = await rateLimited("ai_verify", { limit: 8, windowMs: 60 * 60_000 }, () =>
          withTimeout(
            supabase.functions.invoke("verify-task", {
              body: {
                // taskId is the real contract: the server reads the title,
                // duration and creation time off the row, because anything sent
                // from here is a field it would have to distrust.
                taskId:      task.id,
                // taskTitle/durationMins are ONLY here for the deploy window.
                // The old verify-task reads them and 400s without them, so a
                // build that shipped before the function was deployed would
                // break AI Check for everyone who updated — the mirror image of
                // deploying the function before the build ships. Sending both
                // shapes means the two can be released in either order.
                //
                // The new function ignores these entirely, so they weaken
                // nothing. Delete them once the new function is live everywhere.
                taskTitle:    task.title,
                durationMins: task.minutes,
                proofText:   proofText.trim() || undefined,
                // Answering a question resends NO media: the server rehydrates
                // its own earlier reading of the image from proof_summary, so
                // the round trip is one cheap text call instead of a second
                // vision pass over a photo it already described.
                imageBase64: answering ? undefined : (photo?.base64 || undefined),
                frames:      answering ? undefined : (video?.frames || undefined),
                videoMeta:   !answering && video
                  ? { durationSec: video.durationSec, frameCount: video.frames.length }
                  : undefined,
                followUpAnswer: answering ? answer.trim() : undefined,
              },
            }),
            INVOKE_TIMEOUT_MS
          )
        );
        body = res.data;
        invokeErr = res.error;
        // FunctionsHttpError exposes status on its context
        status = res.error?.context?.status || (body && !res.error ? 200 : 0);

        // If the SDK got a non-2xx, parse the body it received.
        //
        // FunctionsHttpError is constructed as `new FunctionsHttpError(response)`,
        // so `context` IS the Response — there is no `context.response`. Reading
        // that nested property always came back undefined, so the server's real
        // reason ("image_too_large", "proof_required", ...) was silently dropped
        // and EVERY failure collapsed to the generic "error 400" message. The
        // status kept working only because Response happens to have `.status`.
        const ctx = res.error?.context;
        if (ctx && typeof ctx.json === "function") {
          try { body = await ctx.clone().json(); }
          catch {
            try { const t = await ctx.clone().text(); if (t) body = { error: "server_error", message: t.slice(0, 200) }; }
            catch {}
          }
        }
      } catch (e) {
        invokeErr = e;
      }

      // Subscription required → bounce to paywall, do NOT fall back to direct OpenAI
      if (body?.error === "subscription_required" || status === 402) {
        Alert.alert(
          "Pro feature",
          body?.message || "AI Check requires an active Pro subscription.",
          [{ text: "OK", onPress: onCancel }]
        );
        return;
      }

      // Too early. The server's clock is the one that counts — if it says wait,
      // resynchronise the local countdown to its number rather than arguing.
      if (body?.error === "too_early" || status === 425) {
        const secs = Number(body?.secondsRemaining) || 0;
        if (secs > 0) setNowMs(Date.now() - Math.max(0, gateMs - secs * 1000));
        Alert.alert("Not yet", body?.message || "Give this task a bit more time before proving it.");
        return;
      }

      // Already done, or burned through the per-task attempts.
      if (body?.error === "already_verified" || body?.error === "too_many_attempts" ||
          body?.error === "task_not_found" || body?.error === "task_untimed") {
        Alert.alert("Can't verify this", body?.message || "This task can't be verified right now.", [
          { text: "OK", onPress: onCancel },
        ]);
        return;
      }

      // Client predates the taskId contract (shouldn't happen — the force
      // update gate should have caught it — but say something useful if it does).
      if (body?.error === "question_expired") {
        setQuestion(""); setAnswer("");
        Alert.alert("That timed out", body?.message || "Submit your proof again.");
        return;
      }

      if (body?.error === "task_id_required") {
        Alert.alert("Update needed", body?.message || "Update Drift to use AI Check.");
        return;
      }

      // Rate limit. Also keyed on the raw 429 — when supabase-js has already
      // consumed the error body we get a status and no body, and reporting
      // that as a connection failure is what made a plain rate-limit look
      // like being offline.
      if (body?.error === "rate_limit" || status === 429) {
        setRateLimitMsg(body?.message || "You've hit the AI Check limit for now. Try again a bit later.");
        return;
      }

      // OpenAI-side error (network, model down, image rejected)
      if (body?.error === "ai_error" || body?.error === "ai_unreachable" || body?.error === "task_lookup_failed") {
        Alert.alert("Verification failed", body.message || "The AI service is having trouble. Please try again.");
        return;
      }

      // The verifier wants one more thing before deciding. Deliberately NOT
      // rendered as a rejection: it doesn't burn an attempt server-side, and
      // showing a red "NOT VERIFIED" for what is really a follow-up would
      // teach people the check is hostile.
      if (body && !body.error && body.question) {
        setQuestion(body.question);
        setAnswer("");
        return;
      }

      // Success
      if (body && !body.error && (body.verified !== undefined)) {
        setQuestion("");
        setResult(body);
        return;
      }

      // Edge function returned an unexpected response — surface it
      if (body?.error) {
        Alert.alert("Verification failed", `Server: ${body.error}${body.message ? ` — ${body.message}` : ""}`);
        return;
      }
      if (invokeErr) {
        // Dev-only: log the bare minimum (no body, no PII)
        if (__DEV__) console.warn("[AI Check] edge failure status", status);
        // A status means the request REACHED the server and it answered — so
        // never blame the user's connection here. Saying "check your
        // connection" for a 500 sends people to reboot their router over a
        // server-side fault, which is exactly the wrong place to look.
        Alert.alert(
          "Verification failed",
          status >= 500
            ? "The AI service is having trouble right now. Try again in a moment."
            : status > 0
              ? `The AI service rejected the request (error ${status}). Try again, or use text-only proof.`
              : NO_REACH_MSG
        );
        return;
      }

      // Truly empty response — surface a generic error (no direct call)
      Alert.alert("Verification failed", "Unexpected response from the AI service.");
    } catch (e) {
      const raw = (e?.message || "").toLowerCase();
      // The client-side rate limiter throws with code "rate_limited" — surface
      // that as a rate limit, not a bogus "check your connection".
      if (e?.code === "rate_limited" || raw.includes("too many attempts")) {
        setRateLimitMsg(e?.message || "You've done a lot of AI Checks. Try again in a little while.");
        return;
      }
      let msg = NO_REACH_MSG;
      if (e?.name === "AbortError" || raw.includes("aborted") || raw.includes("timeout")) {
        msg = "The AI check timed out. This often means the Wi-Fi you're on is blocking Drift — try turning Wi-Fi off to use cellular, then retry.";
      } else if (raw.includes("network") || raw.includes("fetch") || raw.includes("failed to send")) {
        msg = NO_REACH_MSG;
      }
      Alert.alert("Verification failed", msg);
    } finally {
      setLoading(false);
    }
  };

  if (!task) return null;

  const busy = loading || !!preparing;

  const captureBtn = (label, Icon, onPress, disabled) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={{
        flex: 1, paddingVertical: 12, borderRadius: 12,
        borderWidth: 1, borderColor: BRD, backgroundColor: SURF,
        alignItems: "center", opacity: disabled ? 0.45 : 1,
      }}
    >
      <View style={{ marginBottom: 4 }}><Icon size={22} color={MID} /></View>
      <Text style={{ fontFamily: FOM, fontSize: 9, color: MID, letterSpacing: 1 }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: BG }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 24, paddingTop: 36, paddingBottom: 48 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 24 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: FOM, fontSize: 9, color: GRN, letterSpacing: 2.5, marginBottom: 4 }}>
                AI CHECK
              </Text>
              <Text style={{ fontFamily: FK, fontSize: 20, color: TXT }}>{task.title}</Text>
              <Text style={{ fontFamily: FB, fontSize: 12, color: MID, marginTop: 2 }}>
                {task.minutes} min · {task.credits} credits at stake
              </Text>
            </View>
            <TouchableOpacity
              onPress={onCancel}
              style={{
                width: 32, height: 32, borderRadius: 16,
                backgroundColor: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                alignItems: "center", justifyContent: "center",
              }}
            >
              <CloseIcon size={14} color={MID} />
            </TouchableOpacity>
          </View>

          {/* Rate limit message */}
          {!!rateLimitMsg && (
            <View style={{
              backgroundColor: "rgba(224,80,80,0.1)", borderRadius: 12, padding: 14, marginBottom: 16,
              borderWidth: 1, borderColor: "rgba(224,80,80,0.2)",
            }}>
              <Text style={{ fontFamily: FB, fontSize: 13, color: RED, textAlign: "center" }}>{rateLimitMsg}</Text>
            </View>
          )}

          {/* Unlock countdown. Shown instead of the proof form — there is
              nothing useful to do until it expires, and letting people fill the
              form out first only to be refused would be worse. */}
          {!result && locked && (
            <View style={{
              backgroundColor: SURF, borderRadius: 16, padding: 22, alignItems: "center",
              borderWidth: 1, borderColor: BRD,
            }}>
              <ClockIcon size={34} color={MID} />
              <Text style={{
                fontFamily: FO, fontSize: 12, color: TXT, letterSpacing: 2,
                marginTop: 14, marginBottom: 6,
              }}>
                UNLOCKS IN {mmss(remaining)}
              </Text>
              <Text style={{ fontFamily: FB, fontSize: 13, color: MID, textAlign: "center", lineHeight: 20 }}>
                This is a {task.minutes}-minute task, so proof opens {mmss(gateMs)} after you add it.
                Go do it — we'll be here.
              </Text>
              <TouchableOpacity onPress={onCancel} style={{ paddingVertical: 16, paddingHorizontal: 24 }}>
                <Text style={{ fontFamily: FOM, fontSize: 10, color: MID, letterSpacing: 1.5 }}>CLOSE</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* One clarifying question, in place of a rejection. */}
          {!result && !locked && !!question && (
            <>
              <Text style={{ fontFamily: FOM, fontSize: 9, color: GRN, letterSpacing: 2, marginBottom: 10 }}>
                ONE QUICK CHECK
              </Text>
              <View style={{
                backgroundColor: SURF, borderRadius: 14, padding: 16, marginBottom: 14,
                borderWidth: 1, borderColor: BRD,
              }}>
                <Text style={{ fontFamily: FK, fontSize: 15, color: TXT, lineHeight: 22 }}>
                  {question}
                </Text>
              </View>

              <TextInput
                value={answer}
                onChangeText={setAnswer}
                placeholder="Your answer…"
                placeholderTextColor={dark ? "#5C7263" : "#A8BFB5"}
                multiline
                maxLength={1000}
                autoFocus
                style={{
                  backgroundColor: SURF, borderRadius: 12, padding: 14,
                  borderWidth: 1, borderColor: BRD,
                  color: TXT, fontFamily: FB, fontSize: 14,
                  minHeight: 80, textAlignVertical: "top", marginBottom: 14,
                }}
              />

              <TouchableOpacity
                onPress={() => submit({ answering: true })}
                disabled={busy}
                style={{
                  paddingVertical: 15, borderRadius: 14,
                  backgroundColor: busy ? "rgba(47,171,114,0.4)" : GRN,
                  alignItems: "center", justifyContent: "center",
                  ...(busy ? null : theme.fx.glow),
                }}
              >
                {loading
                  ? <Spinner size={22} color={dark ? "#16261C" : "#fff"} />
                  : <Text style={{ fontFamily: FO, fontSize: 12, color: dark ? "#16261C" : "#fff", letterSpacing: 2 }}>
                      SEND ANSWER
                    </Text>
                }
              </TouchableOpacity>

              <Text style={{ fontFamily: FB, fontSize: 11, color: MID, textAlign: "center", marginTop: 10, lineHeight: 16 }}>
                This doesn't count as an attempt — we just need one detail to be sure.
              </Text>
            </>
          )}

          {/* Proof input */}
          {!result && !locked && !question && (
            <>
              <Text style={{ fontFamily: FOM, fontSize: 9, color: MID, letterSpacing: 2, marginBottom: 10 }}>
                YOUR PROOF
              </Text>

              <TextInput
                value={proofText}
                onChangeText={setProofText}
                placeholder={`Describe how you completed "${task.title}"...`}
                placeholderTextColor={dark ? "#5C7263" : "#A8BFB5"}
                multiline
                maxLength={1000}
                style={{
                  backgroundColor: SURF, borderRadius: 12, padding: 14,
                  borderWidth: 1, borderColor: BRD,
                  color: TXT, fontFamily: FB, fontSize: 14,
                  minHeight: 100, textAlignVertical: "top", marginBottom: 14,
                }}
              />

              {/* Media area */}
              {photo ? (
                <View style={{ marginBottom: 14 }}>
                  <Image
                    source={{ uri: photo.uri }}
                    style={{ width: "100%", height: 180, borderRadius: 12, marginBottom: 8 }}
                  />
                  <TouchableOpacity onPress={() => setPhoto(null)} style={{ alignItems: "center" }}>
                    <Text style={{ fontFamily: FOM, fontSize: 10, color: MID, letterSpacing: 1 }}>
                      REMOVE PHOTO
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : video ? (
                <View style={{ marginBottom: 14 }}>
                  <View style={{ flexDirection: "row", gap: 6, marginBottom: 8 }}>
                    {video.frames.slice(0, 5).map((_, i) => (
                      <View
                        key={i}
                        style={{
                          flex: 1, height: 62, borderRadius: 8,
                          backgroundColor: SURF, borderWidth: 1, borderColor: BRD,
                          alignItems: "center", justifyContent: "center",
                        }}
                      >
                        <Text style={{ fontFamily: FOM, fontSize: 9, color: MID }}>{i + 1}</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={{ fontFamily: FB, fontSize: 12, color: MID, textAlign: "center" }}>
                    {video.durationSec}s clip · {video.frames.length} frames sent for review
                  </Text>
                  <TouchableOpacity onPress={() => setVideo(null)} style={{ alignItems: "center", paddingTop: 8 }}>
                    <Text style={{ fontFamily: FOM, fontSize: 10, color: MID, letterSpacing: 1 }}>
                      REMOVE VIDEO
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
                    {captureBtn("TAKE PHOTO", CameraIcon, takePhoto, busy)}
                    {captureBtn("RECORD VIDEO", VideoIcon, recordVideo, busy)}
                    {captureBtn("UPLOAD", ImageIcon, pickPhoto, busy)}
                  </View>
                  <Text style={{
                    fontFamily: FB, fontSize: 11, color: MID,
                    textAlign: "center", marginBottom: 18, lineHeight: 16,
                  }}>
                    {/* Said plainly, because it changes what people capture:
                        a still can't count reps, and users otherwise submit one
                        and feel cheated by the rejection. */}
                    Counting something — reps, laps, pages? Record a video. A single
                    photo can't show a number.
                  </Text>
                </>
              )}

              {!!preparing && (
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 14 }}>
                  <Spinner size={16} color={MID} />
                  <Text style={{ fontFamily: FB, fontSize: 12, color: MID }}>{preparing}</Text>
                </View>
              )}

              {/* Submit */}
              <TouchableOpacity
                onPress={() => submit()}
                disabled={busy}
                style={{
                  paddingVertical: 15, borderRadius: 14,
                  backgroundColor: busy ? "rgba(47,171,114,0.4)" : GRN,
                  alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8,
                  ...(busy ? null : theme.fx.glow),
                }}
              >
                {loading
                  ? <Spinner size={22} color={dark ? "#16261C" : "#fff"} />
                  : <Text style={{ fontFamily: FO, fontSize: 12, color: dark ? "#16261C" : "#fff", letterSpacing: 2 }}>
                      SUBMIT FOR VERIFICATION
                    </Text>
                }
              </TouchableOpacity>

              <Text style={{ fontFamily: FOM, fontSize: 9, color: MID, textAlign: "center", marginTop: 10, letterSpacing: 1 }}>
                5/HOUR · 20/DAY LIMIT
              </Text>
            </>
          )}

          {/* Result */}
          {result && (
            <>
              <View style={{
                borderRadius: 16, padding: 20,
                backgroundColor: result.verified ? "rgba(47,171,114,0.12)" : "rgba(224,80,80,0.1)",
                borderWidth: 1,
                borderColor: result.verified ? "rgba(47,171,114,0.3)" : "rgba(224,80,80,0.2)",
                marginBottom: 20,
              }}>
                <View style={{ alignItems: "center", marginBottom: 12 }}>
                  {result.verified
                    ? <SparkleIcon size={44} color={GRN} />
                    : <CloseIcon size={40} color={RED} />}
                </View>
                <Text style={{
                  fontFamily: FO, fontSize: 14, letterSpacing: 1.5,
                  textAlign: "center", marginBottom: 10,
                  color: result.verified ? GRN : RED,
                }}>
                  {result.verified ? "VERIFIED" : "NOT VERIFIED"}
                </Text>
                <Text style={{
                  fontFamily: FB, fontSize: 14, color: TXT,
                  textAlign: "center", lineHeight: 21,
                }}>
                  {result.message}
                </Text>
                {/* The specific gap, not just the verdict. "Not verified" with
                    no reason is what makes an honest rejection feel arbitrary. */}
                {!result.verified && !!result.shortfall && (
                  <View style={{
                    marginTop: 14, paddingTop: 12,
                    borderTopWidth: 1, borderTopColor: "rgba(181,86,75,0.18)",
                  }}>
                    <Text style={{ fontFamily: FOM, fontSize: 9, color: MID, letterSpacing: 1.5, marginBottom: 4 }}>
                      WHAT WAS MISSING
                    </Text>
                    <Text style={{ fontFamily: FB, fontSize: 13, color: TXT, lineHeight: 19 }}>
                      {result.shortfall}
                    </Text>
                  </View>
                )}
                <Text style={{
                  fontFamily: FOM, fontSize: 9, color: MID,
                  letterSpacing: 1.5, textAlign: "center", marginTop: 8,
                }}>
                  CONFIDENCE: {result.confidence?.toUpperCase()}
                </Text>
                {/* On a rejection, tell them how many tries are left. Finding
                    out you're locked out only when it happens reads as a bug. */}
                {!result.verified && typeof result.attemptsLeft === "number" && (
                  <Text style={{
                    fontFamily: FOM, fontSize: 9, color: MID,
                    letterSpacing: 1.5, textAlign: "center", marginTop: 4,
                  }}>
                    {result.attemptsLeft > 0
                      ? `${result.attemptsLeft} ATTEMPT${result.attemptsLeft === 1 ? "" : "S"} LEFT`
                      : "NO ATTEMPTS LEFT ON THIS TASK"}
                  </Text>
                )}
              </View>

              {result.verified ? (
                <TouchableOpacity
                  onPress={onVerified}
                  style={{ paddingVertical: 15, borderRadius: 14, backgroundColor: GRN, alignItems: "center" }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ fontFamily: FO, fontSize: 12, color: dark ? "#16261C" : "#fff", letterSpacing: 2 }}>
                      CLAIM {task.credits}m CREDITS
                    </Text>
                    <CheckIcon size={14} color="#fff" />
                  </View>
                </TouchableOpacity>
              ) : result.attemptsLeft === 0 ? null : (
                <TouchableOpacity
                  onPress={() => setResult(null)}
                  style={{
                    paddingVertical: 15, borderRadius: 14,
                    backgroundColor: SURF, borderWidth: 1, borderColor: BRD, alignItems: "center",
                  }}
                >
                  <Text style={{ fontFamily: FO, fontSize: 11, color: MID, letterSpacing: 1.5 }}>
                    TRY AGAIN
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity onPress={onCancel} style={{ paddingVertical: 12, alignItems: "center" }}>
                <Text style={{ fontFamily: FB, fontSize: 13, color: MID }}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
