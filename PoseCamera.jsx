/**
 * PoseCamera.jsx — safe entry point for live pose detection.
 *
 * The real implementation (PoseCameraLive.jsx) depends on native modules that
 * only exist in a custom dev/standalone build: VisionCamera, fast-tflite and
 * the resize plugin. VisionCamera throws at require-time when its native side
 * is missing (Expo Go), so we gate the require here and expose
 * poseCameraAvailable() — callers fall back to the AI photo check when false.
 *
 * NOTE: there must be NO PoseCamera.native.jsx next to this file — a .native
 * variant would silently shadow this module on iOS/Android and disable live
 * tracking everywhere (that was the old setup: the stub won on every native
 * build, so the live path was dead code).
 */
import React from "react";
import { View, Text } from "react-native";
import { CameraIcon } from "./Icons";
import { FF } from "./theme";

// Exercises with a live rep-detection config (mirror of EXERCISE_CONFIGS in
// PoseCameraLive — kept literal here so this module stays import-safe).
export const POSE_EXERCISE_IDS = new Set([
  "pushups", "dips", "squats", "lunges", "situps", "burpees", "jacks",
]);

let Live = null;
try {
  // Probe the native deps first — each throws in Expo Go.
  require("react-native-vision-camera");
  require("react-native-fast-tflite");
  require("vision-camera-resize-plugin");
  Live = require("./PoseCameraLive").default;
} catch {
  Live = null;
}

export function poseCameraAvailable() {
  return !!Live;
}

export default function PoseCamera(props) {
  if (Live) return <Live {...props} />;
  const { width = 220, height = 160, style } = props;
  return (
    <View style={[{
      width, height, borderRadius: 22,
      backgroundColor: "rgba(160,230,170,0.07)",
      borderWidth: 1, borderColor: "rgba(160,230,170,0.15)",
      alignItems: "center", justifyContent: "center", padding: 12,
    }, style]}>
      <View style={{ marginBottom: 8 }}><CameraIcon size={28} color="#A5E39B" /></View>
      <Text style={{ color: "#F0F7EA", fontFamily: FF.bodyMed, fontSize: 12, textAlign: "center" }}>
        Live tracking needs a full build
      </Text>
      <Text style={{ color: "#A9C4AB", fontFamily: FF.body, fontSize: 10, marginTop: 4, textAlign: "center" }}>
        Verify with a photo instead
      </Text>
    </View>
  );
}
