// ── Drift theme tokens ────────────────────────────────────────
// Both themes keep the same green/blue accent system.
// Only backgrounds, surfaces, and text flip between light/dark.

export const LIGHT = {
  ink: {
    void: "#0B1A11", deep: "#1A2B1F", mid: "#6B8A78",
    faint: "#A8BFB5", ghost: "rgba(26,43,31,0.07)", border: "rgba(26,43,31,0.09)",
  },
  paper: { warm: "#F4F9F6", card: "#FFFFFF" },
  earn: {
    terra: "#2FAB72", terraLo: "#E4F5EE",
    green: "#1A8050", greenLo: "#DDF2EA", greenD: "#0E5434",
    blue: "#5AB4D4", blueLo: "#E6F4FB",
  },
};

export const DARK = {
  ink: {
    void: "#091310", deep: "#E8F5EC", mid: "#7BAA8C",
    faint: "#4F7868", ghost: "rgba(255,255,255,0.07)", border: "rgba(255,255,255,0.1)",
  },
  // Slightly cooler + brighter — less swampy, more "night forest"
  paper: { warm: "#0E1B17", card: "#15251F" },
  earn: {
    terra: "#3DC98A", terraLo: "rgba(61,201,138,0.2)",
    green: "#3DC98A", greenLo: "rgba(61,201,138,0.16)", greenD: "#8FE5B8",
    blue: "#6DC3DF", blueLo: "rgba(109,195,223,0.16)",
  },
};

export const getTheme = (dark) => dark ? DARK : LIGHT;
