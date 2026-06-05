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
    void: "#060D09", deep: "#DFF2E7", mid: "#6B9A7A",
    faint: "#3D6650", ghost: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.09)",
  },
  paper: { warm: "#0A1810", card: "#0F2218" },
  earn: {
    terra: "#2FAB72", terraLo: "rgba(47,171,114,0.18)",
    green: "#3DC98A", greenLo: "rgba(47,171,114,0.14)", greenD: "#7DDBA8",
    blue: "#5AB4D4", blueLo: "rgba(90,180,212,0.14)",
  },
};

export const getTheme = (dark) => dark ? DARK : LIGHT;
