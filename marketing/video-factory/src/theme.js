// Drift brand tokens adapted for video (mirrors ../../theme.js LIGHT palette).
// Organic-editorial: cream grounds, deep forest green, Playfair headlines, DM Sans body.
import { loadFont as loadPlayfair } from "@remotion/google-fonts/PlayfairDisplay";
import { loadFont as loadDMSans } from "@remotion/google-fonts/DMSans";
import { loadFont as loadOswald } from "@remotion/google-fonts/Oswald";

const playfair = loadPlayfair();
const dmsans = loadDMSans();
const oswald = loadOswald();

export const FF = {
  display: playfair.fontFamily,
  body: dmsans.fontFamily,
  mark: oswald.fontFamily,
};

export const C = {
  inkDeep: "#1A2820",
  inkMid: "#6B7A6E",
  inkFaint: "#A8B0A8",
  paper: "#F7F7F4",
  card: "#FFFFFF",
  sand: "#F1F2EE",
  deep: "#1F3A2A",
  deepHi: "#2A4D38",
  sage: "#3E6B4E",
  sageLo: "#E4ECE0",
  sageDot: "#5B8A6D",
  terra: "#2D7A52",
  terraLo: "#E8F0E5",
  clay: "#B0764E",
  clayLo: "#EEE0CF",
  bark: "#8A6F58",
  danger: "#C0392B",
};
