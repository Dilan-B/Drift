// levels.js
// Shared level thresholds + helpers so the Grove (SocialScreen) and the main
// shell (Drift.jsx) agree on what tier a given XP total maps to. Keep the LEVELS
// array in sync with the one in Drift.jsx.
export const LEVELS = [
  { name: "Seedling",   min: 0 },
  { name: "Sprout",     min: 150 },
  { name: "Sapling",    min: 400 },
  { name: "Grove",      min: 900 },
  { name: "Canopy",     min: 2000 },
  { name: "Forest",     min: 4000 },
  { name: "Old Growth", min: 8000 },
];

export function getLevelIdx(xp) {
  const x = Number(xp) || 0;
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) if (x >= LEVELS[i].min) idx = i;
  return idx;
}

export function getLevel(xp) {
  return LEVELS[getLevelIdx(xp)] || LEVELS[0];
}
