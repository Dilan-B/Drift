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

// Dark mode: "evening greenhouse". Not light-mode-inverted, but its own
// place — deep pine-black ground with REAL elevation steps (canvas → inset →
// card → cream each visibly lighter), warm paper-white ink, and accents that
// glow like plants under moonlight: luminous spring green, fresh sage, and a
// candlelight clay. Washes run slightly stronger than light mode so tinted
// chips/pills stay visible against the dark ground.
export const DARK = {
  ink: {
    void:   "#060B08",
    deep:   "#F1F5E9",    // warm paper-white — crisp primary text
    mid:    "#AFC0AA",    // secondary text — readable, still soft
    faint:  "#71836F",    // tertiary — lifted well off the ground
    ghost:  "rgba(222,240,216,0.06)",
    border: "rgba(222,240,216,0.11)",
    hairline: "rgba(222,240,216,0.07)",
  },
  paper: {
    warm:   "#0C1310",    // canvas — deep pine, a breath of blue-green
    card:   "#1A241C",    // raised surfaces — clearly lifted off canvas
    cream:  "#212D24",    // soft top layer (inputs on cards, hovers)
    sand:   "#121B15",    // inset wells — sit BELOW the canvas
    dash:   "rgba(222,240,216,0.22)",
  },
  earn: {
    // Luminous spring green = primary CTAs (dark text sits on these)
    deep:    "#D9EFAD",
    deepHi:  "#E7F8C6",
    // Sage — fresher and more saturated than before
    sage:    "#B5D9A0",
    sageLo:  "rgba(181,217,160,0.16)",
    sageDot: "#98C687",
    // Mint accent for stat dots, progress fills
    terra:   "#8CD4A4",
    terraLo: "rgba(140,212,164,0.16)",
    green:   "#8CD4A4",
    greenLo: "rgba(140,212,164,0.16)",
    greenD:  "#BFE9C9",
    blue:    "#A6D2E2",
    blueLo:  "rgba(166,210,226,0.15)",
    clay:    "#E2B084",   // candlelight clay — graphic accents only
    clayLo:  "rgba(226,176,132,0.16)",
    bark:    "#B69C83",
    barkLo:  "rgba(182,156,131,0.15)",
    barkInk: "#DCC6AC",
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
