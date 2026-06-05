/**
 * Skeleton.jsx
 * Lightweight skeleton + spinner loaders.
 *
 *   <Skeleton w={200} h={20} />
 *   <SkeletonCard />        // task card placeholder
 *   <SkeletonList n={3} />  // 3 stacked task cards
 *   <Spinner size={28} />   // clean circular loader fallback
 */
import React, { useEffect, useRef } from "react";
import { View, Animated, Easing } from "react-native";
import Svg, { Circle as SvgCircle } from "react-native-svg";
import { getTheme } from "./theme";

const AnimatedCircle = Animated.createAnimatedComponent(SvgCircle);

// ── Base shimmer block ───────────────────────────────────────
export function Skeleton({ w = "100%", h = 14, r = 8, style, dark }) {
  const theme = getTheme(dark);
  const base    = dark ? "rgba(255,255,255,0.05)" : "rgba(26,43,31,0.05)";
  const shimmer = dark ? "rgba(255,255,255,0.09)" : "rgba(26,43,31,0.09)";
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.4, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <View style={[{ width: w, height: h, borderRadius: r, backgroundColor: base, overflow: "hidden" }, style]}>
      <Animated.View style={{ flex: 1, backgroundColor: shimmer, opacity }} />
    </View>
  );
}

// ── Single task card placeholder ─────────────────────────────
export function SkeletonCard({ dark }) {
  const theme = getTheme(dark);
  return (
    <View style={{
      flexDirection: "row", alignItems: "center",
      backgroundColor: theme.paper.card, borderRadius: 16,
      padding: 14, marginBottom: 8,
      borderWidth: 0.5, borderColor: theme.ink.border,
    }}>
      <Skeleton w={3} h={36} r={2} dark={dark} style={{ marginRight: 12 }} />
      <View style={{ flex: 1, gap: 8 }}>
        <Skeleton w="70%" h={14} dark={dark} />
        <Skeleton w="40%" h={10} dark={dark} />
      </View>
      <Skeleton w={28} h={28} r={14} dark={dark} style={{ marginLeft: 14 }} />
    </View>
  );
}

export function SkeletonList({ n = 3, dark }) {
  return (
    <View>
      {Array.from({ length: n }).map((_, i) => <SkeletonCard key={i} dark={dark} />)}
    </View>
  );
}

// ── Big credit-bank placeholder ──────────────────────────────
export function SkeletonBank({ dark }) {
  const theme = getTheme(dark);
  return (
    <View style={{
      borderRadius: 20, padding: 20, marginBottom: 12,
      backgroundColor: theme.paper.card,
      borderWidth: 1, borderColor: theme.ink.border,
    }}>
      <Skeleton w="40%" h={10} dark={dark} style={{ marginBottom: 12 }} />
      <Skeleton w={180} h={36} dark={dark} style={{ marginBottom: 10 }} />
      <Skeleton w="30%" h={10} dark={dark} />
    </View>
  );
}

// ── Clean circular spinner ───────────────────────────────────
export function Spinner({ size = 28, color, dark }) {
  const theme = getTheme(dark);
  const c     = color || theme.earn.green;
  const rot   = useRef(new Animated.Value(0)).current;
  const r     = (size - 4) / 2;
  const circumference = 2 * Math.PI * r;

  useEffect(() => {
    const loop = Animated.loop(Animated.timing(rot, {
      toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true,
    }));
    loop.start();
    return () => loop.stop();
  }, []);

  const spin = rot.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <Animated.View style={{ width: size, height: size, transform: [{ rotate: spin }] }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <SvgCircle cx={size / 2} cy={size / 2} r={r}
          stroke={c} strokeWidth={2.5} fill="none"
          strokeDasharray={`${circumference * 0.3} ${circumference}`}
          strokeLinecap="round"
        />
      </Svg>
    </Animated.View>
  );
}
