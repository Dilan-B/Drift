// ── Drift theme tokens ────────────────────────────────────────
// Aesthetic direction: organic-editorial.
// Cream parchment grounds, deep forest green accents, generous whitespace,
// editorial serif headlines paired with refined sans body. The seedling
// motif is the soul. Soft clay/bark browns exist ONLY as subtle accents on
// graphic elements (watermarks, dots, decorative strokes) — never in the
// background surfaces, which stay cream + green-neutral.

export const LIGHT = {
  ink: {
    void:   "#0B1A11",
    deep:   "#1A2820",    // primary text / wordmark
    mid:    "#6B7A6E",    // secondary text
    faint:  "#A8B0A8",    // tertiary / dashed borders
    ghost:  "rgba(26,40,32,0.05)",
    border: "rgba(26,40,32,0.08)",
    hairline: "rgba(26,40,32,0.06)",
  },
  paper: {
    warm:   "#F7F7F4",    // canvas — clean white/off-white (no beige)
    card:   "#FFFFFF",    // raised surfaces
    cream:  "#FBFBF9",    // near-white soft variant
    sand:   "#F1F2EE",    // neutral light inset (cards/insets — NOT brown)
    dash:   "rgba(26,40,32,0.16)", // dashed empty-state outlines
  },
  earn: {
    // Deep forest = primary CTAs (the "+ Add task" button in the image)
    deep:    "#1F3A2A",
    deepHi:  "#2A4D38",
    // Sage = soft pill backgrounds (the "Seedling" badge, active tab pill)
    sage:    "#3E6B4E",
    sageLo:  "#E4ECE0",
    sageDot: "#5B8A6D",
    // Mint accent for stat dots, progress fills
    terra:   "#2D7A52",
    terraLo: "#E8F0E5",
    green:   "#2D6B47",
    greenLo: "#E4ECE0",
    greenD:  "#1F3A2A",
    blue:    "#5A8FA4",   // calm slate-blue for AI tags
    blueLo:  "#E8EFF1",
    // Warm earth accents — homey browns, used ONLY on graphic elements
    // (low-opacity watermarks, small accent dots, decorative strokes).
    clay:    "#B0764E",   // terracotta clay
    clayLo:  "#EEE0CF",
    bark:    "#8A6F58",   // soft brown — graphic accents
    barkLo:  "rgba(138,111,88,0.10)",
    barkInk: "#6E5849",   // brown ink for occasional warm labels
  },
};

// Dark mode: "the greenhouse at night". Deliberately NOT light-mode-dimmed —
// the ground is a visibly GREEN botanical dark (you should be able to tell
// the canvas is forest, not charcoal), borders are mint-tinted glass lines
// instead of white hairlines, and the accents run vivid: chartreuse-mint
// CTAs, glowing mint progress, apricot warmth. Surfaces step clearly:
// inset well → canvas → card → top layer.
export const DARK = {
  ink: {
    void:   "#081209",
    deep:   "#F0F7EA",    // warm paper-white — crisp primary text
    mid:    "#A9C4AB",    // secondary — soft green-white, clearly readable
    faint:  "#6E8A74",    // tertiary — muted but never invisible
    ghost:  "rgba(160,230,170,0.07)",
    border: "rgba(160,230,170,0.15)",   // mint glass line — visible on cards
    hairline: "rgba(160,230,170,0.09)",
  },
  paper: {
    warm:   "#0E1A13",    // canvas — deep forest green, unmistakably green
    card:   "#17291D",    // raised surfaces — botanical, not gray
    cream:  "#1E3325",    // top layer (inputs on cards, hovers)
    sand:   "#122117",    // inset wells — sit BELOW the canvas
    dash:   "rgba(160,230,170,0.26)",
  },
  earn: {
    // Vivid chartreuse-mint = primary CTAs (dark text sits on these)
    deep:    "#C6F2A0",
    deepHi:  "#DDFBBC",
    // Living sage — the pale gray-sage is gone
    sage:    "#A5E39B",
    sageLo:  "rgba(165,227,155,0.17)",
    sageDot: "#8BD489",
    // Glowing mint for stat dots, progress fills
    terra:   "#7FE3A5",
    terraLo: "rgba(127,227,165,0.16)",
    green:   "#7FE3A5",
    greenLo: "rgba(127,227,165,0.16)",
    greenD:  "#B4F0C4",
    blue:    "#9FD8EC",
    blueLo:  "rgba(159,216,236,0.15)",
    clay:    "#F0B984",   // glowing apricot — graphic accents only
    clayLo:  "rgba(240,185,132,0.16)",
    bark:    "#C2A184",
    barkLo:  "rgba(194,161,132,0.15)",
    barkInk: "#E5CDB0",
  },
};

// ── Shared effects ───────────────────────────────────────────
// The same visual language in both modes: primary CTAs are light sources
// (soft colored glow, not gray drop shadows), and hero surfaces get quiet
// "aurora" pools — mint + clay — behind their content.
LIGHT.fx = {
  glow: {
    shadowColor: "#1F3A2A",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 5,
  },
  auroraMint: "rgba(62,107,78,0.06)",
  auroraClay: "rgba(176,118,78,0.05)",
};
DARK.fx = {
  glow: {
    shadowColor: "#C6F2A0",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  auroraMint: "rgba(127,227,165,0.10)",
  auroraClay: "rgba(240,185,132,0.055)",
};

export const getTheme = (dark) => dark ? DARK : LIGHT;

// ── Typography tokens ────────────────────────────────────────
// FF.display = Playfair Display (italic for editorial headlines)
// FF.serif   = Playfair Display (regular)
// FF.body    = DM Sans (refined neo-grotesque body)
// FF.bodyMed = DM Sans 500
// FF.bodyBold = DM Sans 700
// FF.mark    = Oswald (condensed sans — wordmark only)
// FF.kicker  = Orbitron (geometric — small-caps labels only)
export const FF = {
  // Display: Playfair Display Medium — upright, lighter weight than Bold.
  // Same family/proportions as the original Bold-Italic, just lighter and straight.
  display:  "PlayfairDisplay_500Medium",
  serif:    "PlayfairDisplay_500Medium",
  serifReg: "PlayfairDisplay_400Regular",
  body:     "DMSans_400Regular",
  bodyMed:  "DMSans_500Medium",
  bodyBold: "DMSans_700Bold",
  mark:     "Oswald_700Bold",
  kicker:   "Orbitron_400Regular",
};
