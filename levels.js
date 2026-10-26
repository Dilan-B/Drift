import { tr } from "./i18n";
// levels.js
// Shared level thresholds + helpers so the Grove (SocialScreen) and the main
// shell (Drift.jsx) agree on what tier a given XP total maps to. Keep the LEVELS
// array in sync with the one in Drift.jsx.
export const LEVELS = [
  { get name() { return tr("Seedling"); },   min: 0     },
  { get name() { return tr("Sprout"); },     min: 150   },
  { get name() { return tr("Sapling"); },    min: 400   },
  { get name() { return tr("Grove"); },      min: 900   },
  { get name() { return tr("Canopy"); },     min: 2000  },
  { get name() { return tr("Forest"); },     min: 4000  },
  { get name() { return tr("Old Growth"); }, min: 8000  },
  { get name() { return tr("Redwood"); },    min: 15000 },
  { get name() { return tr("Ancient"); },    min: 25000 },
  { get name() { return tr("Eternal"); },    min: 50000 },
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
