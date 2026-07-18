/**
 * RepChallengeModal.jsx
 * Live challenge verification — the camera counts your reps in real time
 * (MoveNet pose detection via PoseCamera). When the target count is reached
 * the challenge auto-verifies; no photo needed.
 *
 * Rendered from SocialScreen for exercise challenges whose movement has a
 * pose config (POSE_EXERCISE_IDS). Everything else keeps the AI photo check.
 * If pose detection dies at runtime (missing native module, model failure),
 * the error boundary flips to a photo-fallback panel instead of crashing.
 *
 * Styling: the night greenhouse — always dark, same room as an active
 * Drift In session. You're here to work, not to browse.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Dimensions, Modal, Platform, StatusBar, StyleSheet, Text, TouchableOpacity,
  Vibration, View,
} from "react-native";
import PoseCamera, { poseCameraAvailable } from "./PoseCamera";
import { FF, getTheme } from "./theme";
import { CheckIcon, CameraIcon } from "./Icons";
import { LeafGlyph } from "./SproutArt";

// Sensible rep targets when a legacy challenge row has no reps column.
const DEFAULT_REPS = {
  pushups: 20, squats: 30, jacks: 30, situps: 20, burpees: 10, lunges: 20, dips: 15,
};

export function repTargetFor(challenge) {
  if (challenge?.reps > 0) return challenge.reps;
  const fromTitle = parseInt(String(challenge?.title || ""), 10);
  if (fromTitle > 0 && fromTitle <= 500) return fromTitle;
  return DEFAULT_REPS[challenge?.exercise] || 20;
}

// If pose detection blows up at runtime, show the fallback panel instead of
// taking the whole app down.
class PoseErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() {}
  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

export default function RepChallengeModal({ challenge, onVerified, onUsePhoto, onClose }) {
  // Always the night room, regardless of app theme.
  const focus = getTheme(true);
  const { ink, earn, fx } = focus;

  const target = useMemo(() => repTargetFor(challenge), [challenge]);
  const [reps, setReps] = useState(0);
  const [done, setDone] = useState(false);
  const doneRef = useRef(false);

  const label = challenge?.title || String(challenge?.exercise || "").replace(/_/g, " ");
  const available = poseCameraAvailable();

  const winW = Dimensions.get("window").width;
  const camW = Math.min(winW - 44, 420);
  const camH = Math.round(camW * 1.15);

  const countRep = () => {
    if (doneRef.current) return;
    Vibration.vibrate(14);
    setReps(r => {
      const next = r + 1;
      if (next >= target && !doneRef.current) {
        doneRef.current = true;
        Vibration.vibrate([0, 30, 60, 30]);
        setDone(true);
      }
      return next;
    });
  };

  // Short success beat, then hand the verified challenge back.
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => onVerified?.(), 1100);
    return () => clearTimeout(t);
  }, [done, onVerified]);

  if (!challenge) return null;

  const progress = Math.min(1, reps / target);

  const photoFallback = (
    <View style={{
      width: camW, height: camH, borderRadius: 26,
      backgroundColor: ink.ghost,
      borderWidth: 1, borderColor: ink.border,
      alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <CameraIcon size={34} color={earn.sage} />
      <Text style={{
        fontFamily: FF.bodyMed, fontSize: 14, color: ink.deep,
        textAlign: "center", marginTop: 12,
      }}>
        Live tracking isn't available
      </Text>
      <Text style={{
        fontFamily: FF.body, fontSize: 12, color: ink.mid,
        textAlign: "center", marginTop: 6, lineHeight: 18,
      }}>
        Your build or camera can't run pose detection right now. You can still
        verify with a photo.
      </Text>
      <TouchableOpacity
        onPress={onUsePhoto}
        activeOpacity={0.85}
        style={[{
          marginTop: 18, paddingVertical: 13, paddingHorizontal: 22,
          borderRadius: 16, backgroundColor: earn.deep,
        }, fx.glow]}
      >
        <Text style={{ fontFamily: FF.bodyMed, fontSize: 14, color: ink.void }}>
          Verify with photo
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: ink.void }}>
        <StatusBar barStyle="light-content" />

        {/* Aurora — same night-greenhouse air as Drift In */}
        <View pointerEvents="none" style={{
          position: "absolute", top: -110, right: -80,
          width: 280, height: 280, borderRadius: 140,
          backgroundColor: fx.auroraMint,
        }} />
        <View pointerEvents="none" style={{
          position: "absolute", bottom: -120, left: -90,
          width: 260, height: 260, borderRadius: 130,
          backgroundColor: fx.auroraClay,
        }} />

        {/* Header */}
        <View style={{
          paddingTop: Platform.OS === "ios" ? 58 : 36,
          paddingHorizontal: 24,
          alignItems: "center",
        }}>
          <Text style={{ fontFamily: FF.kicker, fontSize: 10, letterSpacing: 2.4, color: ink.faint, marginBottom: 8 }}>
            LIVE CHECK
          </Text>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: FF.display, fontSize: 28, color: ink.deep,
              letterSpacing: -0.4, textTransform: "capitalize",
            }}
          >
            {label}
          </Text>
          <View style={{
            flexDirection: "row", alignItems: "center", gap: 8,
            marginTop: 10,
            backgroundColor: earn.sageLo,
            borderWidth: StyleSheet.hairlineWidth, borderColor: ink.border,
            borderRadius: 18, paddingVertical: 9, paddingHorizontal: 14,
          }}>
            <LeafGlyph size={14} color={earn.sage} />
            <Text style={{ fontFamily: FF.bodyMed, fontSize: 13, color: ink.deep }}>
              The camera counts your reps — no photo needed
            </Text>
          </View>
        </View>

        {/* Camera + counter */}
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 22 }}>
          {done ? (
            <View style={{
              width: camW, height: camH, borderRadius: 26,
              backgroundColor: earn.sageLo,
              borderWidth: 1, borderColor: ink.border,
              alignItems: "center", justifyContent: "center",
            }}>
              <View style={{
                width: 84, height: 84, borderRadius: 42,
                backgroundColor: earn.deep,
                alignItems: "center", justifyContent: "center",
                marginBottom: 16,
              }}>
                <CheckIcon size={36} color={ink.void} />
              </View>
              <Text style={{ fontFamily: FF.display, fontSize: 30, color: ink.deep, letterSpacing: -0.4 }}>
                Verified
              </Text>
              <Text style={{ fontFamily: FF.body, fontSize: 13, color: ink.mid, marginTop: 6 }}>
                {target} of {target} counted
              </Text>
            </View>
          ) : available ? (
            <PoseErrorBoundary fallback={photoFallback}>
              <PoseCamera
                exerciseId={challenge.exercise}
                onRepCounted={countRep}
                width={camW}
                height={camH}
              />
            </PoseErrorBoundary>
          ) : (
            photoFallback
          )}

          {/* Counter + progress */}
          <View style={{ alignItems: "center", marginTop: 18, width: camW }}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
              <Text style={{ fontFamily: FF.display, fontSize: 54, color: ink.deep, letterSpacing: -1 }}>
                {Math.min(reps, target)}
              </Text>
              <Text style={{ fontFamily: FF.display, fontSize: 22, color: ink.faint }}>
                / {target}
              </Text>
            </View>
            <View style={{
              width: "100%", height: 5, borderRadius: 3,
              backgroundColor: ink.ghost, overflow: "hidden", marginTop: 10,
            }}>
              <View style={{
                width: `${progress * 100}%`, height: "100%",
                borderRadius: 3, backgroundColor: earn.sage,
              }} />
            </View>
          </View>
        </View>

        {/* Actions */}
        <View style={{ paddingHorizontal: 24, paddingBottom: Platform.OS === "ios" ? 46 : 26, gap: 4 }}>
          {available && !done && (
            <TouchableOpacity onPress={onUsePhoto} style={{ height: 42, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontFamily: FF.body, fontSize: 13, color: ink.mid }}>
                Trouble tracking? Verify with a photo instead
              </Text>
            </TouchableOpacity>
          )}
          {!done && (
            <TouchableOpacity onPress={onClose} style={{ height: 42, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontFamily: FF.body, fontSize: 13, color: ink.faint }}>
                Not now
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}
