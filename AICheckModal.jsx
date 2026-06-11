/**
 * AICheckModal.jsx
 * AI task verification via the Supabase Edge Function proxy.
 * The OpenAI key never touches this client — it lives in Supabase secrets.
 * Rate limits (5/hour, 20/day) are enforced server-side.
 */
import React, { useState, useEffect } from "react";
import {
  View, Text, TouchableOpacity, TextInput, StyleSheet,
  ScrollView, Modal, ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform,
} from "react-native";
import { supabase } from "./supabase";
import { getTheme } from "./theme";
import { Spinner } from "./Skeleton";
import { CloseIcon, CameraIcon, ImageIcon, SparkleIcon, CheckIcon } from "./Icons";
import { rateLimited } from "./apiGuards";

const FO  = "Orbitron_700Bold";
const FOM = "Orbitron_400Regular";
const FK  = "Oswald_700Bold";
const FB  = undefined;

// ── Attempt to import expo-image-picker + image manipulator ───
let ImagePicker = null;
let ImageManipulator = null;
try { ImagePicker = require("expo-image-picker"); } catch {}
try { ImageManipulator = require("expo-image-manipulator"); } catch {}

// Force-shrink to at most ~600px on the long edge with JPEG 0.5 — keeps
// the image under ~150 KB so OpenAI doesn't choke and we don't hit the
// Edge Function WallClockTime limit.
async function shrinkImage(uri) {
  if (!ImageManipulator?.manipulateAsync) {
    // Manipulator not installed yet — return original. Submission may still work
    // for small photos but big ones will timeout. Tell user to install.
    return null;
  }
  try {
    const out = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 600 } }],
      { compress: 0.5, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );
    return out.base64;
  } catch {
    return null;
  }
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
  const RED  = "#E05050";

  const [proofText, setProofText] = useState("");
  const [photo,     setPhoto]     = useState(null); // { uri, base64 } | null
  const [loading,   setLoading]   = useState(false);
  const [result,    setResult]    = useState(null); // { verified, confidence, message } | null
  const [rateLimitMsg, setRateLimitMsg] = useState("");

  useEffect(() => {
    if (!visible) {
      setProofText(""); setPhoto(null); setResult(null);
      setLoading(false); setRateLimitMsg("");
    }
  }, [visible]);

  // ── Photo picker ─────────────────────────────────────────────
  const pickPhoto = async () => {
    if (!ImagePicker) {
      Alert.alert("Not available", "Run: npx expo install expo-image-picker");
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") { Alert.alert("Permission denied", "Allow photo access in Settings."); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.4,
      base64: false,
      exif: false,
    });
    if (!res.canceled && res.assets?.[0]) {
      const shrunk = await shrinkImage(res.assets[0].uri);
      if (!shrunk) {
        Alert.alert("Photo too large", "Image processing is not available. Try text proof or restart the app.");
        return;
      }
      setPhoto({ uri: res.assets[0].uri, base64: shrunk });
    }
  };

  const takePhoto = async () => {
    if (!ImagePicker) {
      Alert.alert("Not available", "Run: npx expo install expo-image-picker");
      return;
    }
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") { Alert.alert("Permission denied", "Allow camera in Settings."); return; }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.5, base64: false });
    if (!res.canceled && res.assets?.[0]) {
      const shrunk = await shrinkImage(res.assets[0].uri);
      if (!shrunk) {
        Alert.alert("Photo too large", "Image processing is not available. Try text proof or restart the app.");
        return;
      }
      setPhoto({ uri: res.assets[0].uri, base64: shrunk });
    }
  };

  // ── Submit to Supabase Edge Function ─────────────────────────
  // All AI calls happen server-side in the verify-task edge function.
  // There is no client-side OpenAI path in any build.

  const submit = async () => {
    if (!proofText.trim() && !photo) {
      Alert.alert("Add proof", "Write a description or take a photo to verify.");
      return;
    }
    setLoading(true);
    setRateLimitMsg("");
    try {
      // Try the Supabase Edge Function. Read the JSON body even on non-2xx so
      // we can distinguish 402 (paywall) from 429 (rate limit) from 500 (broken).
      let body = null;
      let status = 0;
      let invokeErr = null;
      try {
        const res = await rateLimited("ai_verify", { limit: 8, windowMs: 60 * 60_000 }, () =>
          supabase.functions.invoke("verify-task", {
          body: {
            taskTitle:    task.title,
            durationMins: task.minutes,
            proofText:    proofText.trim() || undefined,
            imageBase64:  photo?.base64 || undefined,
          },
          })
        );
        body = res.data;
        invokeErr = res.error;
        // FunctionsHttpError exposes status on its context
        status = res.error?.context?.status || (body && !res.error ? 200 : 0);

        // If the SDK got a non-2xx, try to parse the body it received
        if (res.error?.context?.response) {
          try { body = await res.error.context.response.json(); } catch {}
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

      // Rate limit
      if (body?.error === "rate_limit") {
        setRateLimitMsg(body.message || "Rate limit exceeded. Try again later.");
        return;
      }

      // OpenAI-side error (network, model down, image rejected)
      if (body?.error === "ai_error" || body?.error === "ai_unreachable") {
        Alert.alert("Verification failed", body.message || "The AI service is having trouble. Please try again.");
        return;
      }

      // Success
      if (body && !body.error && (body.verified !== undefined)) {
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
        Alert.alert(
          "Verification failed",
          "We couldn't reach the AI service. Please try again in a moment."
        );
        return;
      }

      // Truly empty response — surface a generic error (no direct call)
      Alert.alert("Verification failed", "Unexpected response from the AI service.");
    } catch (e) {
      const raw = (e?.message || "").toLowerCase();
      let msg = "Could not reach the AI. Check your connection and try again.";
      if (raw.includes("aborted") || raw.includes("timeout")) {
        msg = "AI took too long. Try a smaller photo.";
      } else if (raw.includes("network") || raw.includes("fetch")) {
        msg = "Network error. Check your connection.";
      }
      Alert.alert("Verification failed", msg);
    } finally {
      setLoading(false);
    }
  };

  if (!task) return null;

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

          {/* Proof input */}
          {!result && (
            <>
              <Text style={{ fontFamily: FOM, fontSize: 9, color: MID, letterSpacing: 2, marginBottom: 10 }}>
                YOUR PROOF
              </Text>

              <TextInput
                value={proofText}
                onChangeText={setProofText}
                placeholder={`Describe how you completed "${task.title}"...`}
                placeholderTextColor={dark ? "#3D6650" : "#A8BFB5"}
                multiline
                maxLength={1000}
                style={{
                  backgroundColor: SURF, borderRadius: 12, padding: 14,
                  borderWidth: 1, borderColor: BRD,
                  color: TXT, fontFamily: FB, fontSize: 14,
                  minHeight: 100, textAlignVertical: "top", marginBottom: 14,
                }}
              />

              {/* Photo area */}
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
              ) : (
                <View style={{ flexDirection: "row", gap: 10, marginBottom: 20 }}>
                  <TouchableOpacity
                    onPress={takePhoto}
                    style={{
                      flex: 1, padding: 12, borderRadius: 12,
                      borderWidth: 1, borderColor: BRD, backgroundColor: SURF, alignItems: "center",
                    }}
                  >
                    <View style={{ marginBottom: 4 }}><CameraIcon size={22} color={MID} /></View>
                    <Text style={{ fontFamily: FOM, fontSize: 9, color: MID, letterSpacing: 1 }}>
                      TAKE PHOTO
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={pickPhoto}
                    style={{
                      flex: 1, padding: 12, borderRadius: 12,
                      borderWidth: 1, borderColor: BRD, backgroundColor: SURF, alignItems: "center",
                    }}
                  >
                    <View style={{ marginBottom: 4 }}><ImageIcon size={22} color={MID} /></View>
                    <Text style={{ fontFamily: FOM, fontSize: 9, color: MID, letterSpacing: 1 }}>
                      UPLOAD
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Submit */}
              <TouchableOpacity
                onPress={submit}
                disabled={loading}
                style={{
                  paddingVertical: 15, borderRadius: 14,
                  backgroundColor: loading ? "rgba(47,171,114,0.4)" : GRN,
                  alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8,
                }}
              >
                {loading
                  ? <Spinner size={22} color="#fff" />
                  : <Text style={{ fontFamily: FO, fontSize: 12, color: "#fff", letterSpacing: 2 }}>
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
                <Text style={{
                  fontFamily: FOM, fontSize: 9, color: MID,
                  letterSpacing: 1.5, textAlign: "center", marginTop: 8,
                }}>
                  CONFIDENCE: {result.confidence?.toUpperCase()}
                </Text>
              </View>

              {result.verified ? (
                <TouchableOpacity
                  onPress={onVerified}
                  style={{ paddingVertical: 15, borderRadius: 14, backgroundColor: GRN, alignItems: "center" }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ fontFamily: FO, fontSize: 12, color: "#fff", letterSpacing: 2 }}>
                      CLAIM {task.credits}m CREDITS
                    </Text>
                    <CheckIcon size={14} color="#fff" />
                  </View>
                </TouchableOpacity>
              ) : (
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
