/**
 * PlantSlider.jsx
 * The length slider with leaves sprouting along the track. One component for
 * every duration/amount picker in the app (Drift In, add-task, Lockbox, the
 * action plan, sleep guard) so they all look and feel the same.
 */
import React, { useRef } from "react";
import { View, Text, Animated } from "react-native";
import Slider from "@react-native-community/slider";
import { FF } from "./theme";
import { selectionTick } from "./haptics";

export default function PlantSlider({
  value,
  onValueChange,
  minimumValue,
  maximumValue,
  step,
  accent,
  track,
  soil,
  textColor,
  leftLabel,
  rightLabel,
}) {
  const pct = Math.max(0, Math.min(1, (value - minimumValue) / (maximumValue - minimumValue)));
  const leaves = [0.2, 0.4, 0.6, 0.8];

  // Feedback on each step crossing: a haptic tick plus a quick swell of the
  // filled track. Fired only when the value actually changes step, so dragging
  // within one step stays silent instead of machine-gunning.
  const lastValRef = useRef(value);
  const pulse = useRef(new Animated.Value(0)).current;

  const handleChange = (v) => {
    if (v !== lastValRef.current) {
      lastValRef.current = v;
      selectionTick();
      pulse.setValue(1);
      Animated.timing(pulse, {
        toValue: 0, duration: 180, useNativeDriver: false,
      }).start();
    }
    onValueChange(v);
  };

  return (
    <View style={{ marginTop: 2 }}>
      <View style={{ height: 34, justifyContent: "center", marginHorizontal: 2 }}>
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 4,
            right: 4,
            height: 8,
            borderRadius: 8,
            backgroundColor: track,
            borderWidth: 1,
            borderColor: soil,
            overflow: "hidden",
          }}
        >
          <Animated.View style={{
            width: `${pct * 100}%`,
            height: "100%",
            backgroundColor: accent,
            borderRadius: 8,
            // Brief brightening on each step — visible feedback for anyone
            // with system haptics turned off.
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.62] }),
          }} />
        </View>
        {leaves.map((stop, i) => {
          const grown = pct >= stop;
          return (
            <View
              key={stop}
              pointerEvents="none"
              style={{
                position: "absolute",
                left: `${stop * 100}%`,
                top: i % 2 === 0 ? 6 : 18,
                width: 13,
                height: 7,
                borderTopLeftRadius: 9,
                borderBottomRightRadius: 9,
                backgroundColor: grown ? accent : soil,
                opacity: grown ? 0.74 : 0.4,
                transform: [
                  { translateX: -6 },
                  { rotate: i % 2 === 0 ? "-28deg" : "28deg" },
                ],
              }}
            />
          );
        })}
        <Slider
          minimumValue={minimumValue}
          maximumValue={maximumValue}
          step={step}
          value={value}
          onValueChange={handleChange}
          minimumTrackTintColor="transparent"
          maximumTrackTintColor="transparent"
          thumbTintColor={accent}
          style={{ width: "100%", height: 34 }}
        />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: -2 }}>
        <Text style={{ fontFamily: FF.body, fontSize: 10, color: textColor }}>{leftLabel}</Text>
        <Text style={{ fontFamily: FF.body, fontSize: 10, color: textColor }}>{rightLabel}</Text>
      </View>
    </View>
  );
}
