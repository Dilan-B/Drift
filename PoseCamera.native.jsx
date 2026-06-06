/**
 * PoseCamera.native.jsx — stub for Expo Go.
 * Full pose detection requires a custom dev build with VisionCamera + TFLite.
 * Use manual rep counting below for now.
 */
import React from "react";
import { View, Text } from "react-native";
import { CameraIcon } from "./Icons";

export const POSE_EXERCISE_IDS = new Set([
  "pushups", "dips", "squats", "lunges", "situps", "burpees", "jacks",
]);

export default function PoseCamera({ exerciseId, repsLeft, onRepCounted }) {
  return (
    <View style={{
      width: 220, height: 160, borderRadius: 14, marginBottom: 16,
      backgroundColor: "rgba(255,255,255,0.04)",
      borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
      alignItems: "center", justifyContent: "center", padding: 12,
    }}>
      <View style={{ marginBottom: 8 }}><CameraIcon size={28} color="#D4622A" /></View>
      <Text style={{ color: "#D4622A", fontWeight: "600", fontSize: 12, textAlign: "center" }}>
        Pose detection needs a dev build
      </Text>
      <Text style={{ color: "#4A3020", fontSize: 10, marginTop: 4, textAlign: "center" }}>
        Use manual count below for now
      </Text>
    </View>
  );
}
