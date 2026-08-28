// TikTok-native script writer.
//
// The old brand-film scripts were 5 calm scenes of ~3.5s each with a serif
// headline. That structure is why they read as adverts. This writer targets
// the format that actually retains on a For You page: hook on frame 0, a
// visual change every ~2.5s, short spoken lines, no intro, no sign-off.

import { brandPrompt, lintScript, FACTS } from "./brand.mjs";
import { FORMATS } from "./ideas.mjs";
import { chat } from "./openai.mjs";

// Must stay in step with UI_MOCKS in src/Native.jsx.
export const UI_MOCKS = ["tasks", "shield", "earn"];

export const VISUAL_KINDS = {
  phone: "A real screenshot of the app shown inside a phone. The strongest way to show the product — prefer it over `ui` whenever a screenshot fits the beat.",
  capture: "Full-bleed screen recording of the real app. Use for anything the app actually does.",
  broll: "Full-bleed live-action or AI-generated footage. Use for feelings and real-world moments.",
  statement: "Bold full-screen text on a brand colour. Use for the hook and for hard turns.",
  ui: `Rendered app mock. Use when no capture fits. Pick "ui": ${UI_MOCKS.map((m) => `"${m}"`).join(" | ")} — ` +
      `tasks = the to-do list with earned-minute chips, shield = apps locked behind a lock screen, ` +
      `earn = the minutes-earned progress ring.`,
};

// There is no voiceover, so a beat lasts exactly as long as it takes to READ.
// That is far quicker than the old TTS pacing, where per-utterance overhead
// pinned every beat near 4 seconds regardless of length — so a 15s video now
// fits five or six beats instead of three.
const READ_WORDS_PER_SECOND = 3.0;   // large bold text, glanced at, not studied
const BEAT_DWELL_SECONDS = 0.8;      // floor, so a short line does not flash past

const TIMING = {
  targetSeconds: 15,
  minSeconds: 10,
  maxSeconds: 21,
  maxWordsPerBeat: 8,   // 6 beats x 8 words is ~21s, the ceiling
  minBeats: 4,
  maxBeats: 6,
};

function systemPrompt({ format, captures, brollClips, shots }) {
  const fmt = FORMATS[format];
  // Only offer kinds we can actually satisfy. Listing "broll" with an empty
  // folder just invites the model to invent clip names that then fail
  // validation — which it did, three attempts running.
  const available = ["statement", "ui"];
  if (shots.length) available.unshift("phone");
  if (captures.length) available.push("capture");
  if (brollClips.length) available.push("broll");
  const assetLines = [];
  if (captures.length) {
    assetLines.push(
      `Screen recordings available (use "kind":"capture" and set "src" to one of these EXACT filenames):`,
      ...captures.map((c) => `  - ${c.file}${c.describes ? ` — shows: ${c.describes}` : ""}`)
    );
  }
  if (brollClips.length) {
    assetLines.push(
      `B-roll clips available (use "kind":"broll", "src" must be one of these EXACT filenames):`,
      ...brollClips.map((c) => `  - ${c}`)
    );
  }
  if (shots.length) {
    assetLines.push(
      `Real app screenshots (use "kind":"phone" and set "src" to one of these EXACT filenames):`,
      ...shots.map((c) => `  - ${c.file} — ${c.describes}`)
    );
  }
  if (!assetLines.length) {
    assetLines.push(`No footage is available. Use only "statement" and "ui" visuals.`);
  }

  return `You write scripts for short vertical TikTok videos.

${brandPrompt()}

FORMAT FOR THIS VIDEO: ${format} — ${fmt?.beats || ""}

You are writing for the For You page. Judge every line by: would a real person
keep watching? Marketing cadence kills retention. Write how someone talks.

HARD RULES
- The FIRST beat is the hook. It must work with zero context and be SEVEN WORDS
  OR FEWER — it has to be readable at a glance. Never open with a greeting,
  "in this video", "let me show you", or the product name.
- THIS IS A ${TIMING.targetSeconds}-SECOND SILENT VIDEO — text on screen, no narration, no captions.
- ${TIMING.minBeats}-${TIMING.maxBeats} beats. Reading is quick, so FIVE is the shape to aim for:
  hook, the problem, the mechanism, the payoff, the CTA.
- Each beat is one line, max ${TIMING.maxWordsPerBeat} words. A beat lasts as long as its line
  takes to read, so a longer line is not free — but you have room for five.
- Every beat changes the visual. No two consecutive beats share the same "src".
- Every beat makes a NEW point. Do not restate an earlier beat in different
  words — with one line per shot, repetition is obvious and reads as padding.
- "onscreen" is the ONLY thing the viewer gets. There is NO voiceover and NO
  subtitles — this is a silent, text-on-screen video. Max ${TIMING.maxWordsPerBeat} words per beat.
  Every line must land on its own and carry that beat's point completely.
  Write them as a sequence someone reads straight through, like a thought
  unfolding — not as captions for narration that is not there.
- The last beat is the CTA and must use "statement" — never "ui" or "phone".
  NEVER mention money — no price, no cost, no trial, no subscription, and never
  the word "free". The CTA tells them exactly what to search: "${FACTS.appStoreSearch}"
  on the App Store. Searching "Drift" alone does not find it, so use the full
  name. Nothing about what it costs.
- No emoji in "onscreen" text. No hashtags inside spoken lines.
- Say NOTHING about money anywhere — not in the beats, not in the postCaption,
  not in the hashtags. No price, cost, trial, subscription, or the word "free".
  This is the most common reason a draft gets rejected.

VISUAL KINDS — these are the ONLY values allowed for "kind". Any other value,
or a filename not listed below, is rejected. Do not invent footage.
${available.map((k) => `  - ${k}: ${VISUAL_KINDS[k]}`).join("\n")}

${assetLines.join("\n")}

Return ONLY JSON:
{
  "title": "kebab-case-slug",
  "beats": [
    {"onscreen": "the line on screen", "kind": "capture|broll|statement|ui",
     "src": "filename if kind is capture/broll, else omit",
     "ui": "one of ${UI_MOCKS.join('|')} if kind is ui, else omit"}
  ],
  "postCaption": "TikTok caption, under 150 chars, conversational, no hashtags here",
  "hashtags": ["#screentime", "..."]
}
- 4-6 hashtags, lowercase, relevant, no banned or spammy tags.`;
}

/** Rough spoken-duration estimate at ~2.8 words/sec, before real TTS timing. */
export function countWords(beats) {
  return beats.reduce((n, b) => n + String(b.onscreen || "").split(/\s+/).filter(Boolean).length, 0);
}

/** How long one beat needs to be readable. */
export function beatSeconds(beat) {
  const words = String(beat.onscreen || "").split(/\s+/).filter(Boolean).length;
  return BEAT_DWELL_SECONDS + words / READ_WORDS_PER_SECOND;
}

/** Predicted finished length, from reading time. */
export function estimateSeconds(beats) {
  return beats.reduce((t, b) => t + beatSeconds(b), 0);
}

// Models are poor at estimating spoken duration but good at counting words, so
// the budget is expressed in words in the prompt and enforced in words here.
export const WORD_BUDGET = {
  min: TIMING.minBeats * 3,
  max: TIMING.maxBeats * TIMING.maxWordsPerBeat,
  target: 5 * 7,
};

/**
 * Write a script for an idea. Self-corrects: if the claim linter or the
 * structural checks fail, the specific complaints are fed back for a rewrite
 * rather than blindly re-rolling.
 */
export async function writeScript(idea, { captures = [], brollClips = [], shots = [], attempts = 3, qcFeedback = null } = {}) {
  const system = systemPrompt({ format: idea.format, captures, brollClips, shots });
  const captureNames = captures.map((c) => c.file);
  let feedback = "";

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const user = [
      `IDEA`,
      `  hook: ${idea.hook}`,
      `  angle: ${idea.angle}`,
      `  why it works: ${idea.why || "n/a"}`,
      ``,
      `Open the video on that hook (you may sharpen the wording).`,
      // Failures from a PREVIOUS rendered video that got rejected by the
      // quality gate. These persist across every attempt in this call.
      qcFeedback
        ? `\nA previous version of this video was RENDERED and then REJECTED by the ` +
          `quality review. Write a materially different script that avoids these:\n${qcFeedback}`
        : "",
      // Failures from this call's own previous attempt at writing valid JSON.
      feedback ? `\nYour previous attempt was REJECTED. Fix exactly these problems:\n${feedback}` : "",
    ].join("\n");

    const script = await chat({ system, user, json: true, temperature: attempt === 1 ? 0.9 : 0.7 });
    script.format = idea.format;
    script.idea = { hook: idea.hook, angle: idea.angle, ideaKey: idea.ideaKey };

    const problems = validateScript(script, { captureNames, brollClips, shotNames: shots.map((c) => c.file) });
    if (!problems.length) return { script, attempts: attempt };

    feedback = problems.map((p) => `  - ${p}`).join("\n");
    console.log(`[script] attempt ${attempt} rejected:\n${feedback}`);
  }
  throw new Error(`Script failed validation after ${attempts} attempts:\n${feedback}`);
}

/** Structural + claim validation. Returns human-readable problems for the model. */
export function validateScript(script, { captureNames = [], brollClips = [], shotNames = [] } = {}) {
  const problems = [];
  const beats = script.beats;

  if (!Array.isArray(beats) || beats.length < TIMING.minBeats) {
    problems.push(`Need at least ${TIMING.minBeats} beats, got ${beats?.length ?? 0}.`);
    return problems;
  }
  if (beats.length > TIMING.maxBeats) problems.push(`Too many beats (${beats.length}), max ${TIMING.maxBeats}.`);

  const predicted = estimateSeconds(beats);
  if (predicted > TIMING.maxSeconds) {
    problems.push(
      `${beats.length} beats predicts about ${predicted.toFixed(0)}s, over the ${TIMING.maxSeconds}s limit. ` +
      `Shorten the lines or drop a beat.`
    );
  }
  if (predicted < TIMING.minSeconds) {
    problems.push(`${beats.length} beats predicts only ${predicted.toFixed(0)}s, under the ${TIMING.minSeconds}s minimum. Add a beat.`);
  }


  beats.forEach((b, i) => {
    if (!b.onscreen) problems.push(`beat[${i}] has no "onscreen" text.`);
    const onWords = (b.onscreen || "").split(/\s+/).filter(Boolean).length;
    if (onWords > TIMING.maxWordsPerBeat) {
      problems.push(`beat[${i}].onscreen is ${onWords} words, max ${TIMING.maxWordsPerBeat}. Tighten it.`);
    }
    if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(b.onscreen || "")) {
      problems.push(`beat[${i}].onscreen contains an emoji — remove it.`);
    }
    if (!VISUAL_KINDS[b.kind]) problems.push(`beat[${i}].kind "${b.kind}" is not one of ${Object.keys(VISUAL_KINDS).join(", ")}.`);
    // Without this the renderer silently falls back to the tasks mock, so a
    // beat saying "it locks your apps" would show a to-do list instead.
    if (b.kind === "ui" && !UI_MOCKS.includes(b.ui)) {
      problems.push(`beat[${i}].ui "${b.ui}" is not a real mock. Use one of: ${UI_MOCKS.join(", ")}.`);
    }
    if (b.kind === "capture" && !captureNames.includes(b.src)) {
      problems.push(`beat[${i}].src "${b.src}" is not an available screen recording. Use one of: ${captureNames.join(", ") || "(none — switch kind)"}.`);
    }
    if (b.kind === "phone" && !shotNames.includes(b.src)) {
      problems.push(`beat[${i}].src "${b.src}" is not an available screenshot. Use one of: ${shotNames.join(", ") || "(none — switch kind)"}.`);
    }
    if (b.kind === "broll" && !brollClips.includes(b.src)) {
      problems.push(`beat[${i}].src "${b.src}" is not an available b-roll clip. Use one of: ${brollClips.join(", ") || "(none — switch kind)"}.`);
    }
    // "every beat changes the visual" has to cover the UI mocks too, not just
    // footage — two `ui:tasks` beats in a row replay an identical animation.
    const vis = (x) => x?.src || (x?.kind === "ui" ? `ui:${x.ui}` : null);
    if (i > 0 && vis(b) && vis(b) === vis(beats[i - 1])) {
      problems.push(`beat[${i}] reuses the same visual as beat[${i - 1}] (${vis(b)}) — every beat must change the visual.`);
    }
  });

  // With one line per beat, a repeated line makes the video feel padded — and
  // it is invisible to the visual QC pass, which only ever sees single frames.
  const tokenSet = (t) => new Set(String(t).toLowerCase().match(/[a-z']+/g) || []);
  const overlap = (a, b) => {
    const A = tokenSet(a), B = tokenSet(b);
    if (!A.size || !B.size) return 0;
    let shared = 0;
    for (const w of A) if (B.has(w)) shared++;
    return shared / Math.min(A.size, B.size);
  };
  for (let i = 1; i < beats.length; i++) {
    for (let j = 0; j < i; j++) {
      // The opening pair is what a scroller actually sees, so it gets the
      // strictest test — the quality gate has flagged "repetitive text on the
      // first two frames" as an editing error.
      const limit = i === 1 && j === 0 ? 0.4 : 0.5;
      if (overlap(beats[i].onscreen, beats[j].onscreen) >= limit) {
        problems.push(
          `beat[${i}].onscreen ("${beats[i].onscreen}") repeats beat[${j}] ("${beats[j].onscreen}"). ` +
          `Each beat must make a NEW point — merge them or cut one.`
        );
      }
    }
  }

  const hookWords = (beats[0].onscreen || "").split(/\s+/).filter(Boolean).length;
  if (hookWords > 7) problems.push(`The hook's onscreen text is ${hookWords} words — it must be 7 or fewer to read instantly.`);
  if (/^(hey|hi|hello|what'?s up|so |in this video|let me)/i.test(beats[0].onscreen || "")) {
    problems.push(`beat[0] opens with a greeting/preamble. Start on the hook itself.`);
  }

  // The last beat carries the big brand line and the CTA pill. Over a UI mock
  // those collide with the mock's own content, so the CTA gets a clean ground.
  const last = beats[beats.length - 1];
  if (last.kind === "ui" || last.kind === "phone") {
    problems.push(
      `The final beat is the CTA and carries the App Store pill — it must not use ` +
      `"${last.kind}", whose visual fills the frame the pill sits in. Use "statement".`
    );
  }

  if (!script.postCaption) problems.push(`Missing "postCaption".`);
  else if (script.postCaption.length > 150) problems.push(`postCaption is ${script.postCaption.length} chars, max 150.`);
  if (!Array.isArray(script.hashtags) || script.hashtags.length < 3) problems.push(`Need at least 3 hashtags.`);

  for (const issue of lintScript({
    scenes: beats.map((b) => ({ headline: b.onscreen, src: b.src })),
    postCaption: script.postCaption,
    hashtags: script.hashtags,
  })) {
    problems.push(`CLAIM VIOLATION in ${issue.label} ("${issue.matched}"): ${issue.why}`);
  }

  return problems;
}
