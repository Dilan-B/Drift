/**
 * PoseCameraLive.jsx
 * Real-time pose detection using MoveNet (TFLite) + VisionCamera.
 * Counts reps for each exercise based on joint angles / landmark positions.
 *
 * DO NOT import this file directly — import ./PoseCamera instead. This module
 * requires native modules (VisionCamera, fast-tflite, resize plugin) that only
 * exist in a custom dev/standalone build; PoseCamera.jsx gates the require so
 * Expo Go falls back gracefully.
 *
 * Pipeline (per frame, throttled to ~12 fps):
 *   camera frame (yuv) → resize to 192×192 rgb uint8 → MoveNet → 17 keypoints
 *   → joint-angle rep detection on the JS thread.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Camera, useCameraDevice, useCameraPermission, useFrameProcessor, runAtTargetFps } from "react-native-vision-camera";
import { useTensorflowModel } from "react-native-fast-tflite";
import { useResizePlugin } from "vision-camera-resize-plugin";
import { Worklets } from "react-native-worklets-core";
import Svg, { Circle, Line } from "react-native-svg";
import { CameraIcon } from "./Icons";
import { FF } from "./theme";

// ── MoveNet keypoint indices ─────────────────────────────────
const KP = {
  NOSE: 0, LEFT_EYE: 1, RIGHT_EYE: 2, LEFT_EAR: 3, RIGHT_EAR: 4,
  LEFT_SHOULDER: 5,  RIGHT_SHOULDER: 6,
  LEFT_ELBOW: 7,     RIGHT_ELBOW: 8,
  LEFT_WRIST: 9,     RIGHT_WRIST: 10,
  LEFT_HIP: 11,      RIGHT_HIP: 12,
  LEFT_KNEE: 13,     RIGHT_KNEE: 14,
  LEFT_ANKLE: 15,    RIGHT_ANKLE: 16,
};

// Pairs to draw as skeleton lines
const SKELETON_PAIRS = [
  [KP.LEFT_SHOULDER,  KP.RIGHT_SHOULDER],
  [KP.LEFT_SHOULDER,  KP.LEFT_ELBOW],   [KP.LEFT_ELBOW,  KP.LEFT_WRIST],
  [KP.RIGHT_SHOULDER, KP.RIGHT_ELBOW],  [KP.RIGHT_ELBOW, KP.RIGHT_WRIST],
  [KP.LEFT_SHOULDER,  KP.LEFT_HIP],     [KP.RIGHT_SHOULDER, KP.RIGHT_HIP],
  [KP.LEFT_HIP,       KP.RIGHT_HIP],
  [KP.LEFT_HIP,       KP.LEFT_KNEE],    [KP.LEFT_KNEE,  KP.LEFT_ANKLE],
  [KP.RIGHT_HIP,      KP.RIGHT_KNEE],   [KP.RIGHT_KNEE, KP.RIGHT_ANKLE],
];

// ── Helpers ──────────────────────────────────────────────────

// Angle (degrees) at joint B, formed by the lines A→B and C→B
function jointAngle(kps, a, b, c) {
  const ax = kps[a * 3 + 1], ay = kps[a * 3];
  const bx = kps[b * 3 + 1], by = kps[b * 3];
  const cx = kps[c * 3 + 1], cy = kps[c * 3];
  const r = Math.atan2(cy - by, cx - bx) - Math.atan2(ay - by, ax - bx);
  let d = Math.abs(r * (180 / Math.PI));
  if (d > 180) d = 360 - d;
  return d;
}

// Averaged Y position of two keypoints (0=top, 1=bottom of frame)
function avgY(kps, a, b) {
  return (kps[a * 3] + kps[b * 3]) / 2;
}

// ── Per-exercise rep detection configs ───────────────────────
//
// getMetric(kps) → number    value to threshold
// isDown(v)      → bool      "active / down" phase entered
// isUp(v)        → bool      "rest / up"   phase = rep completed
// cue            string      tip shown during tracking
// metricLabel    string      shown in the live HUD

const EXERCISE_CONFIGS = {
  pushups: {
    getMetric: (kps) => jointAngle(kps, KP.LEFT_SHOULDER, KP.LEFT_ELBOW, KP.LEFT_WRIST),
    isDown: (v) => v < 90,
    isUp:   (v) => v > 150,
    cue: "Lower chest to floor · full range of motion counts",
    metricLabel: "Elbow",
    unit: "°",
  },
  dips: {
    getMetric: (kps) => jointAngle(kps, KP.LEFT_SHOULDER, KP.LEFT_ELBOW, KP.LEFT_WRIST),
    isDown: (v) => v < 90,
    isUp:   (v) => v > 150,
    cue: "Elbows at 90° down · lock out at the top",
    metricLabel: "Elbow",
    unit: "°",
  },
  squats: {
    getMetric: (kps) => jointAngle(kps, KP.LEFT_HIP, KP.LEFT_KNEE, KP.LEFT_ANKLE),
    isDown: (v) => v < 90,
    isUp:   (v) => v > 160,
    cue: "Hips below knees · drive through heels",
    metricLabel: "Knee",
    unit: "°",
  },
  lunges: {
    getMetric: (kps) => jointAngle(kps, KP.LEFT_HIP, KP.LEFT_KNEE, KP.LEFT_ANKLE),
    isDown: (v) => v < 95,
    isUp:   (v) => v > 155,
    cue: "Front knee at 90° · back knee brushes floor",
    metricLabel: "Knee",
    unit: "°",
  },
  situps: {
    // Lying flat = large hip angle; crunched = small hip angle
    getMetric: (kps) => jointAngle(kps, KP.LEFT_SHOULDER, KP.LEFT_HIP, KP.LEFT_KNEE),
    isDown: (v) => v < 80,   // crunched up
    isUp:   (v) => v > 140,  // lying back down
    cue: "Start flat · curl until elbows reach knees",
    metricLabel: "Hip",
    unit: "°",
  },
  burpees: {
    // Shoulder height: low Y value = shoulders near top of frame (standing/jumping)
    // high Y value = shoulders low (pushup position)
    getMetric: (kps) => avgY(kps, KP.LEFT_SHOULDER, KP.RIGHT_SHOULDER),
    isDown: (v) => v > 0.55,  // shoulders low = pushup position
    isUp:   (v) => v < 0.35,  // shoulders high = standing / jumped
    cue: "Drop to floor · jump up and clap overhead",
    metricLabel: "Height",
    unit: "%",
    displayFn: (v) => `${Math.round(v * 100)}`,
  },
  jacks: {
    // wristY - shoulderY: positive = arms down, negative = arms overhead
    getMetric: (kps) => avgY(kps, KP.LEFT_WRIST, KP.RIGHT_WRIST) - avgY(kps, KP.LEFT_SHOULDER, KP.RIGHT_SHOULDER),
    isDown: (v) => v > 0.08,   // arms at sides / below shoulders
    isUp:   (v) => v < -0.05,  // arms overhead
    cue: "Jump feet wide · raise arms fully overhead",
    metricLabel: "Arms",
    unit: "",
    displayFn: (v) => v < 0 ? "up" : "down",
  },
};

export const POSE_EXERCISE_IDS = new Set(Object.keys(EXERCISE_CONFIGS));

// ── Main component ───────────────────────────────────────────
// width/height: rendered size of the camera view (skeleton overlay scales).
export default function PoseCameraLive({ exerciseId, onRepCounted, width = 220, height = 160, style }) {
  const device = useCameraDevice("front");
  const { hasPermission, requestPermission } = useCameraPermission();
  const model  = useTensorflowModel(require("./assets/movenet.tflite"));
  const { resize } = useResizePlugin();

  const [keypoints,  setKeypoints]  = useState(null);    // 51-value array
  const [phase,      setPhase]      = useState("up");    // 'up' | 'down'
  const [liveMetric, setLiveMetric] = useState(null);
  const [ready,      setReady]      = useState(false);

  const phaseRef    = useRef("up");
  const lastRepRef  = useRef(0);
  useEffect(() => { if (model.state === "loaded") setReady(true); }, [model.state]);
  useEffect(() => { if (!hasPermission) requestPermission(); }, []);

  const cfg = EXERCISE_CONFIGS[exerciseId];

  // Called from the worklet — receives the 51-element keypoint array.
  const handleKps = useCallback((kpsArr) => {
    if (!cfg || kpsArr.length < 51) return;
    setKeypoints(kpsArr);

    const v = cfg.getMetric(kpsArr);
    setLiveMetric(v);

    const now = Date.now();
    if (cfg.isDown(v) && phaseRef.current === "up") {
      phaseRef.current = "down";
      setPhase("down");
    } else if (cfg.isUp(v) && phaseRef.current === "down" && now - lastRepRef.current > 600) {
      phaseRef.current  = "up";
      setPhase("up");
      lastRepRef.current = now;
      onRepCounted?.();
    }
  }, [cfg, onRepCounted]);

  // Bridge from the VisionCamera worklet runtime to the JS thread.
  // (react-native-worklets-core, NOT reanimated's runOnJS — frame processors
  // run on the worklets-core runtime.)
  const handleKpsOnJS = useMemo(() => Worklets.createRunOnJS(handleKps), [handleKps]);

  // Frame processor — runs on a background worklet thread. MoveNet expects a
  // 192×192 rgb uint8 tensor, so resize before inference; throttle to ~12 fps
  // so the phone doesn't cook.
  const frameProcessor = useFrameProcessor((frame) => {
    "worklet";
    if (model.state !== "loaded") return;
    runAtTargetFps(12, () => {
      "worklet";
      const resized = resize(frame, {
        scale: { width: 192, height: 192 },
        pixelFormat: "rgb",
        dataType: "uint8",
      });
      const out = model.model.runSync([resized]);
      if (!out[0] || out[0].length < 51) return;
      handleKpsOnJS(Array.from(out[0]));
    });
  }, [model.state, model.model, handleKpsOnJS, resize]);

  const box = { width, height };

  // ── No permission ──
  if (!hasPermission) return (
    <TouchableOpacity onPress={requestPermission} style={[s.permBox, box, style]}>
      <View style={{ marginBottom: 8 }}><CameraIcon size={36} color="#A5E39B" /></View>
      <Text style={{ color: "#F0F7EA", fontFamily: FF.bodyMed, fontSize: 13 }}>Enable camera</Text>
      <Text style={{ color: "#A9C4AB", fontFamily: FF.body, fontSize: 11, marginTop: 4, textAlign: "center" }}>
        Needed to count your reps live
      </Text>
    </TouchableOpacity>
  );

  if (!device) return (
    <View style={[s.permBox, box, style]}>
      <Text style={{ color: "#A9C4AB", fontFamily: FF.body, fontSize: 12 }}>No camera found</Text>
    </View>
  );

  // ── Live metric display ──
  const displayMetric = () => {
    if (liveMetric === null) return "—";
    if (cfg?.displayFn) return cfg.displayFn(liveMetric);
    return `${Math.round(liveMetric)}${cfg?.unit ?? ""}`;
  };

  const phaseColor = phase === "down" ? "#F0B984" : "#A5E39B";

  return (
    <View style={[s.container, box, style]}>
      {/* Camera feed */}
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive
        frameProcessor={frameProcessor}
        pixelFormat="yuv"
      />

      {/* Skeleton overlay */}
      {keypoints && <SkeletonOverlay kps={keypoints} width={width} height={height} />}

      {/* Loading indicator */}
      {!ready && (
        <View style={s.loadingOverlay}>
          <Text style={s.loadingText}>Loading model…</Text>
        </View>
      )}

      {/* Phase indicator dot + metric */}
      <View style={s.hud}>
        <View style={[s.dot, { backgroundColor: phaseColor }]} />
        <Text style={s.hudText}>
          {cfg?.metricLabel ?? ""} {displayMetric()}
        </Text>
      </View>

      {/* Coaching cue */}
      {ready && cfg?.cue ? (
        <View style={s.cueBar}>
          <Text style={s.cueText}>{cfg.cue}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ── Skeleton overlay ─────────────────────────────────────────
function SkeletonOverlay({ kps, width, height }) {
  const pt = (i) => ({
    x: kps[i * 3 + 1] * width,
    y: kps[i * 3]     * height,
    s: kps[i * 3 + 2],
  });
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
      {SKELETON_PAIRS.map(([a, b], i) => {
        const A = pt(a), B = pt(b);
        if (A.s < 0.3 || B.s < 0.3) return null;
        return <Line key={i} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="#A5E39B" strokeWidth={2} opacity={0.8} />;
      })}
      {Array.from({ length: 17 }, (_, i) => {
        const p = pt(i);
        if (p.s < 0.3) return null;
        return <Circle key={i} cx={p.x} cy={p.y} r={4} fill="#DDFBBC" />;
      })}
    </Svg>
  );
}

// ── Styles ───────────────────────────────────────────────────
const s = StyleSheet.create({
  container: {
    borderRadius: 22, overflow: "hidden", backgroundColor: "#081209",
  },
  permBox: {
    borderRadius: 22,
    backgroundColor: "rgba(160,230,170,0.07)",
    borderWidth: 1, borderColor: "rgba(160,230,170,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center", justifyContent: "center",
  },
  loadingText: { color: "#F0F7EA", fontFamily: FF.body, fontSize: 12 },
  hud: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingVertical: 5, paddingHorizontal: 10,
  },
  dot:     { width: 8, height: 8, borderRadius: 4 },
  hudText: { color: "#F0F7EA", fontFamily: FF.bodyMed, fontSize: 10 },
  cueBar: {
    position: "absolute", top: 0, left: 0, right: 0,
    backgroundColor: "rgba(0,0,0,0.45)",
    paddingVertical: 4, paddingHorizontal: 8,
  },
  cueText: { color: "rgba(240,247,234,0.75)", fontFamily: FF.body, fontSize: 9 },
});
