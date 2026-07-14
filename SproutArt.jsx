/**
 * SproutArt.jsx
 * The seedling motif — the emotional center of the app's identity.
 * Drawn as inline SVG so it stays crisp at every density, theme-able,
 * and free of any image-loading flicker.
 *
 * <Sprout size={140} />          // hero version (Today card)
 * <Sprout size={28} mini />      // micro version (badges, empty states)
 */
import React from "react";
import Svg, { Path, Defs, RadialGradient, Stop, Ellipse, G } from "react-native-svg";

export default function Sprout({ size = 140, mini = false, tone = "fresh" }) {
  // Two color tones so dark mode + active states get their own
  const palette = tone === "fresh" ? {
    leafA: "#7FB58A",   // brighter young leaf
    leafB: "#5C9670",   // shadowed leaf
    stem:  "#3E6B4E",
    soil:  "#D8E2D2",
    halo:  "rgba(127,181,138,0.18)",
  } : {
    leafA: "#A5E39B",
    leafB: "#8BD489",
    stem:  "#7FBF92",
    soil:  "#24402C",
    halo:  "rgba(165,227,155,0.16)",
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 200 200" fill="none">
      <Defs>
        <RadialGradient id="haloG" cx="100" cy="125" rx="95" ry="80">
          <Stop offset="0" stopColor={palette.halo} stopOpacity={1} />
          <Stop offset="1" stopColor={palette.halo} stopOpacity={0} />
        </RadialGradient>
      </Defs>

      {/* soft halo — gives the sprout its glow */}
      {!mini && (
        <Ellipse cx="100" cy="130" rx="78" ry="62" fill="url(#haloG)" />
      )}

      {/* soil mound */}
      <Path
        d="M30 162 C 50 130, 150 130, 170 162 C 170 175, 30 175, 30 162 Z"
        fill={palette.soil}
      />
      {/* soil top highlight */}
      <Path
        d="M55 145 C 80 138, 120 138, 145 145"
        stroke="#FFFFFF"
        strokeOpacity={0.35}
        strokeWidth={1.2}
        strokeLinecap="round"
        fill="none"
      />

      {/* stem */}
      <Path
        d="M100 150 C 100 130, 100 110, 100 92"
        stroke={palette.stem}
        strokeWidth={3.2}
        strokeLinecap="round"
        fill="none"
      />

      {/* right leaf — primary */}
      <Path
        d="M100 105
           C 115 95, 145 80, 158 50
           C 150 78, 130 100, 112 110
           Z"
        fill={palette.leafA}
      />
      {/* right leaf vein */}
      <Path
        d="M104 105 C 125 92, 145 75, 156 56"
        stroke={palette.leafB}
        strokeWidth={1.4}
        strokeLinecap="round"
        opacity={0.55}
        fill="none"
      />

      {/* left leaf — secondary, slightly lower */}
      <Path
        d="M100 110
           C 86 102, 60 92, 48 70
           C 56 92, 76 108, 92 114
           Z"
        fill={palette.leafB}
      />
      <Path
        d="M96 110 C 80 100, 62 88, 50 72"
        stroke={palette.stem}
        strokeWidth={1.2}
        strokeLinecap="round"
        opacity={0.45}
        fill="none"
      />

      {/* tiny new bud at the top */}
      <Path
        d="M97 92 C 97 87, 103 87, 103 92 C 103 96, 97 96, 97 92 Z"
        fill={palette.leafA}
      />
    </Svg>
  );
}

/** Tiny leaf glyph for inline use in badges / chips. */
export function LeafGlyph({ size = 14, color = "#2D6B47" }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 21 C 12 12, 16 6, 22 4 C 22 13, 17 19, 12 21 Z"
        fill={color}
      />
      <Path
        d="M12 21 C 12 15, 9 11, 4 8 C 5 14, 8 19, 12 21 Z"
        fill={color}
        opacity={0.7}
      />
    </Svg>
  );
}

/**
 * Sprig — a faint decorative branch with a few leaves. Built to be dropped in
 * at very low opacity as a quiet watermark in card corners and section
 * backgrounds. Stroke-only so it reads as a delicate botanical line drawing.
 *
 * <Sprig size={120} color={clay} opacity={0.06} />
 */
export function Sprig({ size = 120, color = "#3E6B4E", opacity = 0.06, flip = false }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      style={{ opacity, transform: flip ? [{ scaleX: -1 }] : undefined }}
    >
      {/* main stem — a gentle arc */}
      <Path
        d="M18 104 C 34 86, 50 70, 62 48 C 70 34, 76 22, 80 12"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        fill="none"
      />
      {/* leaves alternating off the stem */}
      <Path d="M52 60 C 64 56, 76 56, 86 48 C 76 50, 64 54, 54 62 Z" fill={color} />
      <Path d="M44 74 C 34 72, 24 70, 16 62 C 24 66, 34 70, 46 72 Z" fill={color} />
      <Path d="M64 42 C 74 38, 82 36, 90 28 C 82 32, 74 36, 66 44 Z" fill={color} />
      <Path d="M36 88 C 28 88, 20 88, 12 82 C 20 84, 28 86, 38 86 Z" fill={color} />
      {/* tip bud */}
      <Path d="M77 12 C 77 8, 83 8, 83 12 C 83 16, 77 16, 77 12 Z" fill={color} />
    </Svg>
  );
}

/**
 * SeedDots — a scattering of tiny seeds/dots for faint background texture.
 * Deterministic layout (no randomness between renders).
 */
export function SeedDots({ size = 140, color = "#3E6B4E", opacity = 0.05 }) {
  const dots = [
    [18, 22, 2.5], [40, 14, 1.8], [64, 30, 2.2], [96, 18, 1.6],
    [120, 40, 2.4], [28, 54, 1.8], [78, 60, 2.0], [110, 72, 1.7],
    [22, 90, 2.2], [54, 104, 1.9], [90, 110, 2.3], [128, 96, 1.6],
  ];
  return (
    <Svg width={size} height={size} viewBox="0 0 140 140" fill="none" style={{ opacity }}>
      {dots.map(([cx, cy, r], i) => (
        <Path
          key={i}
          d={`M${cx} ${cy} m ${-r} 0 a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`}
          fill={color}
        />
      ))}
    </Svg>
  );
}
