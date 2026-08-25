// Idea generation with memory. The pipeline runs unattended, so the biggest
// long-run failure is not a bad video — it is posting the same video with new
// words for six weeks. Everything here exists to keep the output varied and
// grounded in angles that actually work for this product.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { brandPrompt, lintClaims } from "./brand.mjs";
import { chat } from "./openai.mjs";

// TikTok-native formats. Each maps to a real editing pattern, not a vibe —
// the script writer and the renderer both branch on `format`.
export const FORMATS = {
  "screen-demo": {
    label: "Screen demo",
    beats: "Show the actual app doing the thing. Narrate what's happening as it happens.",
    needsCapture: true,
  },
  "pov": {
    label: "POV",
    beats: "Second-person scenario the viewer recognises. 'POV: you can't open TikTok until…'",
    needsCapture: true,
  },
  "before-after": {
    label: "Before / after",
    beats: "State the old behaviour, hard cut, state the new one. Numbers land best.",
    needsCapture: true,
  },
  "build-in-public": {
    label: "Build in public",
    beats: "Founder voice. 'I built X because Y.' Teen-founder story is the differentiator.",
    needsCapture: false,
  },
  "problem-agitate": {
    label: "Problem agitate",
    beats: "Name the feeling precisely, sit in it, then reveal the mechanism as relief.",
    needsCapture: false,
  },
  "myth-bust": {
    label: "Myth bust",
    beats: "'Screen time apps don't work because…' then the specific reason Drift differs.",
    needsCapture: false,
  },
};

const HISTORY_PATH = "content/state/history.json";

export function loadHistory(root) {
  const p = join(root, HISTORY_PATH);
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return [];
  }
}

export function saveHistory(root, history) {
  const p = join(root, HISTORY_PATH);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(history, null, 2));
}

export function recordRun(root, entry) {
  const history = loadHistory(root);
  history.push({ ...entry, at: new Date().toISOString() });
  saveHistory(root, history);
  return history;
}

/** Stable fingerprint of an idea's substance, used for dedupe. */
export function ideaKey(idea) {
  const norm = `${idea.format}|${idea.hook}`
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha1").update(norm).digest("hex").slice(0, 12);
}

/** Cheap lexical similarity so near-duplicate hooks get caught too. */
function similarity(a, b) {
  const words = (s) => new Set(s.toLowerCase().match(/[a-z']+/g) || []);
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / Math.min(A.size, B.size);
}

export function isTooSimilar(idea, history, threshold = 0.6) {
  const key = ideaKey(idea);
  for (const h of history) {
    if (h.ideaKey === key) return { dup: true, reason: "exact repeat", against: h.hook };
    if (h.hook && similarity(idea.hook, h.hook) >= threshold) {
      return { dup: true, reason: "near-duplicate hook", against: h.hook };
    }
  }
  return { dup: false };
}

/**
 * Ask the model for a batch of ideas, then filter against history locally.
 * Over-generating and filtering beats asking for one idea and hoping.
 */
export async function generateIdeas(root, { count = 6, seed, availableFormats } = {}) {
  const history = loadHistory(root);
  const recent = history.slice(-25);
  const formats = availableFormats?.length ? availableFormats : Object.keys(FORMATS);

  const system = `You generate ideas for short vertical TikTok videos for a product.

${brandPrompt()}

You are writing for TikTok's For You page, not for a brand campaign. The bar is:
would a 16-24 year old stop scrolling in the first 0.8 seconds? Ideas that sound
like an advert are worthless. Ideas that sound like a person talking are good.

Available formats (pick the one that genuinely fits each idea):
${formats.map((f) => `  - ${f}: ${FORMATS[f]?.beats || ""}`).join("\n")}

Return ONLY JSON: {"ideas":[{"format":string,"hook":string,"angle":string,"why":string}]}
  - "hook": the literal first line said/shown on screen. Max 12 words. It must
    create an information gap or a recognisable feeling. No greetings, no "in this video".
  - "angle": one sentence on what the video argues or shows.
  - "why": one sentence on why this stops the scroll for this audience.`;

  const avoid = recent.length
    ? `Do NOT repeat or lightly reword any of these already-used hooks:\n${recent.map((h) => `  - ${h.hook}`).join("\n")}`
    : "No videos have been made yet.";

  const res = await chat({
    system,
    user: `${avoid}\n\nGenerate ${count} genuinely distinct ideas.${seed ? `\n\nSteer toward this theme: ${seed}` : ""}`,
    json: true,
  });

  const raw = Array.isArray(res.ideas) ? res.ideas : [];
  const accepted = [];
  const rejected = [];

  for (const idea of raw) {
    if (!idea?.hook || !idea?.format) continue;
    if (!FORMATS[idea.format]) idea.format = "problem-agitate";

    const claims = lintClaims(`${idea.hook} ${idea.angle}`, { label: "idea", scope: "script" });
    if (claims.length) {
      rejected.push({ idea, reason: `claim: ${claims[0].why}` });
      continue;
    }
    const dup = isTooSimilar(idea, [...history, ...accepted]);
    if (dup.dup) {
      rejected.push({ idea, reason: `${dup.reason} (vs "${dup.against}")` });
      continue;
    }
    idea.ideaKey = ideaKey(idea);
    accepted.push(idea);
  }

  return { accepted, rejected, historyCount: history.length };
}
