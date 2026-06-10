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

export const DARK = {
  ink: {
    void:   "#080F0B",
    deep:   "#E8EEDF",
    mid:    "#9DAE9A",
    faint:  "#566357",
    ghost:  "rgba(255,255,255,0.05)",
    border: "rgba(255,255,255,0.08)",
    hairline: "rgba(255,255,255,0.06)",
  },
  paper: {
    warm:   "#0F1611",
    card:   "#171F18",
    cream:  "#1A2320",
    sand:   "#19231C",    // neutral dark inset (NOT brown)
    dash:   "rgba(255,255,255,0.18)",
  },
  earn: {
    deep:    "#D8E8C5",
    deepHi:  "#E4F0D0",
    sage:    "#A8C99A",
    sageLo:  "rgba(168,201,154,0.13)",
    sageDot: "#8FB585",
    terra:   "#7FBE96",
    terraLo: "rgba(127,190,150,0.14)",
    green:   "#7FBE96",
    greenLo: "rgba(127,190,150,0.14)",
    greenD:  "#A8D9B5",
    blue:    "#9BC4D2",
    blueLo:  "rgba(155,196,210,0.13)",
    clay:    "#CCA07E",   // warm clay glow — graphic accents only
    clayLo:  "rgba(204,160,126,0.14)",
    bark:    "#A38C78",
    barkLo:  "rgba(163,140,120,0.13)",
    barkInk: "#C9B49E",
  },
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
