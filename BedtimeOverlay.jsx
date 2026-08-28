/**
 * BedtimeOverlay.jsx
 * The moment right after the tag is tapped.
 *
 * WHY THIS EXISTS
 * Arming a night is the single most consequential thing the sleep guard does —
 * it locks every blocked app until morning. Before this, that moment was
 * invisible: the NFC sheet closed and a card quietly changed state. The most
 * irreversible action in the app had the least presence.
 *
 * So this is a deliberate pause. It is not decoration and it is not a
 * celebration — the app is being put down for the night, so the motion is a
 * room going dark rather than confetti. Cream gives way to night green, a moon
 * rises, the copy states plainly what just happened, and it leaves on its own.
 *
 * It is skippable by tapping, honours Reduce Motion, and auto-dismisses. It
 * must never be something a tired person has to fight past to put their phone
 * down.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  Modal, View, Text, Animated, Easing, Pressable,
  AccessibilityInfo, Dimensions,
} from "react-native";
import { FF, LIGHT } from "./theme";
import { notify } from "./haptics";

const NIGHT   = "#0B1A11";           // ink.void — the ground goes to night
const MOONLIT = LIGHT.paper.sand;    // warm off-white, not clinical white
const HOLD_MS = 2600;                // long enough to read, short enough to leave

// A scatter that reads as sky rather than a grid. Offsets are from the centre
// of the moon block, so this survives any screen size.
const STARS = [
  { x: -104, y: -62, r: 2.0, delay:   0 },
  { x:   84, y: -78, r: 1.5, delay: 120 },
  { x:  118, y:  -8, r: 2.4, delay: 240 },
  { x:  -78, y:  26, r: 1.6, delay: 180 },
  { x:   62, y:  48, r: 1.9, delay: 320 },
  { x: -128, y: -12, r: 1.4, delay:  90 },
];

export default function BedtimeOverlay({ visible, rewardMinutes, onDone }) {
  const { width } = Dimensions.get("window");

  const wash    = useRef(new Animated.Value(0)).current;  // whole-screen fade
  const moon    = useRef(new Animated.Value(0)).current;  // moon rise + scale
  const title   = useRef(new Animated.Value(0)).current;
  const body    = useRef(new Animated.Value(0)).current;
  const reward  = useRef(new Animated.Value(0)).current;
  const starOps = useRef(STARS.map(() => new Animated.Value(0))).current;

  const [reduceMotion, setReduceMotion] = useState(false);
  const finished = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => {});
  }, []);

  // One shared exit, so tap-to-skip and the timer can't both fire.
  const leave = useRef(() => {});

  useEffect(() => {
    if (!visible) return;

    finished.current = false;
    [wash, moon, title, body, reward].forEach(v => v.setValue(0));
    starOps.forEach(v => v.setValue(0));

    const rise = (value, delay, duration = 620) =>
      Animated.timing(value, {
        toValue: 1, delay, duration,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });

    leave.current = () => {
      if (finished.current) return;
      finished.current = true;
      Animated.timing(wash, {
        toValue: 0, duration: reduceMotion ? 180 : 460,
        easing: Easing.in(Easing.quad), useNativeDriver: true,
      }).start(() => onDone?.());
    };

    // Reduce Motion still gets the moment, just without the choreography.
    if (reduceMotion) {
      [moon, title, body, reward].forEach(v => v.setValue(1));
      starOps.forEach(v => v.setValue(1));
      Animated.timing(wash, {
        toValue: 1, duration: 220, useNativeDriver: true,
      }).start();
      const t = setTimeout(() => leave.current(), 1800);
      return () => clearTimeout(t);
    }

    // A soft double tap, like a light switch — not a success chime.
    notify(true);

    Animated.parallel([
      Animated.timing(wash, {
        toValue: 1, duration: 620,
        easing: Easing.out(Easing.quad), useNativeDriver: true,
      }),
      rise(moon, 160, 900),
      ...starOps.map((v, i) =>
        Animated.timing(v, {
          toValue: 1, delay: 520 + STARS[i].delay, duration: 700,
          easing: Easing.out(Easing.quad), useNativeDriver: true,
        })),
      rise(title, 640),
      rise(body, 900),
      rise(reward, 1140),
    ]).start();

    const t = setTimeout(() => leave.current(), 1140 + 620 + HOLD_MS);
    return () => clearTimeout(t);
  }, [visible, reduceMotion, onDone, wash, moon, title, body, reward, starOps]);

  if (!visible) return null;

  const lift = (v, distance = 16) => ({
    opacity: v,
    transform: [{
      translateY: v.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }),
    }],
  });

  return (
    <Modal visible transparent animationType="none" onRequestClose={() => leave.current()}>
      <Animated.View style={{ flex: 1, backgroundColor: NIGHT, opacity: wash }}>
        <Pressable
          onPress={() => leave.current()}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 }}
        >
          {/* Sky */}
          <View style={{ height: 190, width, alignItems: "center", justifyContent: "center" }}>
            {STARS.map((s, i) => (
              <Animated.View
                key={i}
                style={{
                  position: "absolute",
                  left: width / 2 + s.x, top: 95 + s.y,
                  width: s.r * 2, height: s.r * 2, borderRadius: s.r,
                  backgroundColor: MOONLIT,
                  opacity: starOps[i].interpolate({
                    inputRange: [0, 1], outputRange: [0, 0.55],
                  }),
                }}
              />
            ))}

            {/* Crescent: a lit disc with the night bitten out of it. */}
            <Animated.View
              style={{
                width: 92, height: 92,
                opacity: moon,
                transform: [
                  { scale: moon.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) },
                  { translateY: moon.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) },
                ],
              }}
            >
              <View style={{
                position: "absolute", width: 92, height: 92, borderRadius: 46,
                backgroundColor: MOONLIT,
              }} />
              <View style={{
                position: "absolute", left: 26, top: -7,
                width: 92, height: 92, borderRadius: 46,
                backgroundColor: NIGHT,
              }} />
            </Animated.View>
          </View>

          <Animated.Text
            style={[{
              fontFamily: FF.display, fontSize: 34, color: LIGHT.paper.warm,
              letterSpacing: -0.4, textAlign: "center", marginTop: 8,
            }, lift(title)]}
          >
            Goodnight
          </Animated.Text>

          <Animated.Text
            style={[{
              fontFamily: FF.body, fontSize: 14.5, lineHeight: 22,
              color: "rgba(247,247,244,0.62)", textAlign: "center", marginTop: 12,
            }, lift(body)]}
          >
            Your apps are locked until morning.{"\n"}Leave your phone where it is.
          </Animated.Text>

          {rewardMinutes > 0 && (
            <Animated.View
              style={[{
                marginTop: 26, paddingVertical: 8, paddingHorizontal: 16,
                borderRadius: 999, borderWidth: 1,
                borderColor: "rgba(247,247,244,0.16)",
              }, lift(reward, 12)]}
            >
              <Text style={{
                fontFamily: FF.bodyMed, fontSize: 12.5,
                color: "rgba(247,247,244,0.72)",
              }}>
                {`+${rewardMinutes} min waiting if it stays put`}
              </Text>
            </Animated.View>
          )}
        </Pressable>
      </Animated.View>
    </Modal>
  );
}
