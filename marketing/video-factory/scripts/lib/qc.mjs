// The quality gate.
//
// This pipeline posts without a human looking first, so this file is the only
// thing standing between a bad render and the brand account. It fails CLOSED:
// anything it cannot verify is treated as a failure, and a video only ships
// when every hard check passes and the model reviewer clears the rubric.

import { join } from "node:path";
import { existsSync } from "node:fs";
import { SAFE_AREA } from "./brand.mjs";
import { UI_TEXT_Y } from "../../src/safeArea.js";
import { lintScript, FACTS } from "./brand.mjs";
import { probe, extractFrames, asBase64, silenceSeconds } from "./media.mjs";
import { chat, KEYS } from "./openai.mjs";

export const LIMITS = {
  // Target is a 15s video. These are the outer bounds the render must land in;
  // the script's word budget aims at the middle. TikTok allows far more, but
  // short retains better and that is the whole point of the format.
  minSeconds: 10,
  maxSeconds: 19,
  maxSilenceRatio: 0.3, // >30% dead air means the voiceover probably failed.
  maxBytes: 250 * 1024 * 1024,
  // Split by what the dimension measures. legibility/polish are DEFECT checks —
  // a failure there means something is visibly broken, so the bar is high.
  // native/hook are EFFECTIVENESS judgements: a correct-but-unremarkable video
  // is still worth posting, a broken one never is. Without real screen
  // recordings "native" honestly sits at 3, and the fix for that is footage,
  // not a lower bar.
  scoreFloors: { legibility: 4, polish: 4, hook: 3, native: 3 },
  minOverall: 3.5,
};

const fail = (check, detail) => ({ ok: false, check, detail });
const pass = (check, detail) => ({ ok: true, check, detail });

/** Checks that need no model and no network. These are absolute. */
export function hardChecks({ videoPath, script, beats, ttsProvider }) {
  const results = [...layoutInvariants()];

  if (!existsSync(videoPath)) return [fail("file-exists", `${videoPath} was not produced`)];

  const info = probe(videoPath);
  results.push(
    info.width === 1080 && info.height === 1920
      ? pass("dimensions", "1080x1920")
      : fail("dimensions", `expected 1080x1920, got ${info.width}x${info.height}`)
  );
  results.push(
    info.videoCodec === "h264"
      ? pass("codec", "h264")
      : fail("codec", `TikTok requires H.264 MP4, got ${info.videoCodec}`)
  );
  results.push(
    info.seconds >= LIMITS.minSeconds && info.seconds <= LIMITS.maxSeconds
      ? pass("duration", `${info.seconds.toFixed(1)}s`)
      : fail("duration", `${info.seconds.toFixed(1)}s outside ${LIMITS.minSeconds}-${LIMITS.maxSeconds}s`)
  );
  results.push(
    info.bytes > 0 && info.bytes < LIMITS.maxBytes
      ? pass("filesize", `${(info.bytes / 1e6).toFixed(1)}MB`)
      : fail("filesize", `${info.bytes} bytes`)
  );
  results.push(info.hasAudio ? pass("audio-track", info.audioCodec) : fail("audio-track", "no audio stream"));

  if (info.hasAudio) {
    const silent = silenceSeconds(videoPath);
    const ratio = silent / info.seconds;
    results.push(
      ratio <= LIMITS.maxSilenceRatio
        ? pass("audio-content", `${(ratio * 100).toFixed(0)}% silent`)
        : fail("audio-content", `${(ratio * 100).toFixed(0)}% of the video is silent — voiceover likely failed`)
    );
  }

  // The macOS `say` voice is fine for a local preview and not fine to publish.
  results.push(
    ttsProvider !== "say"
      ? pass("voice-quality", ttsProvider)
      : fail("voice-quality", "macOS 'say' voice — set ELEVENLABS_API_KEY or OPENAI_API_KEY before posting")
  );

  // Claims are re-linted against the FINAL script, not just the draft, so a
  // late edit can't slip a bad claim past the writer's own validation.
  const claimIssues = lintScript({
    scenes: (script.beats || []).map((b) => ({ headline: b.onscreen, voiceover: b.say, src: b.src })),
    postCaption: script.postCaption,
    hashtags: script.hashtags,
  });
  results.push(
    claimIssues.length === 0
      ? pass("claims", "no banned claims")
      : fail("claims", claimIssues.map((i) => `${i.label}: "${i.matched}" — ${i.why}`).join("; "))
  );

  // There are no subtitles, so the burned-in line is the only thing a muted
  // viewer reads. A beat without one is a blank beat.
  const missing = (beats || []).filter((b) => !b.onscreen).length;
  results.push(
    missing === 0
      ? pass("onscreen-text", `${beats?.length ?? 0} beats have on-screen text`)
      : fail("onscreen-text", `${missing} beat(s) have no on-screen text`)
  );

  return results;
}

const RUBRIC = `You are reviewing frames from a vertical TikTok video for a small app brand.
Be harsh. This video posts automatically with no human review, so anything
embarrassing is a real cost to the brand.

HOW THIS VIDEO IS BUILT — read before scoring, or you will report false faults:
- There are NO SUBTITLES, deliberately. Each shot carries one short burned-in
  line, and it is a headline rather than a transcript of the narration. Do not
  report the absence of captions, or the fact that the text does not match the
  spoken words, as a fault.
- Layout is verified separately and by construction. Do NOT try to judge from the
  image whether something sits under TikTok's buttons — you cannot measure that
  reliably from a downscaled frame, and guesses here are worse than silence.
  Judge only what you can actually see.

Score each dimension 1-5 (5 = excellent, 3 = mediocre, 1 = unusable):

- "legibility": is every visible word readable — good contrast, not overlapping
  another element, no letters clipped by the frame edge?
- "polish": does this look deliberately designed, or broken — misaligned
  elements, half-rendered animation, awkward cropping, clashing colours?
- "native": does it look like a real TikTok, or like a corporate advert? Calm,
  centred, serif, lots of white space = an advert = low score.
- "hook": judge ONLY the first frame. Would a scrolling 16-24 year old stop for it?

Also flag anything factually or reputationally risky you can SEE.
Facts: the app is ${FACTS.name}, ${FACTS.platform} only, ${FACTS.price} after a
${FACTS.trialDays}-day free trial. It is NOT free.

Return ONLY JSON:
{"scores":{"legibility":n,"polish":n,"native":n,"hook":n},
 "overall":n,
 "blocking_issues":["..."],
 "notes":"one or two sentences"}
"blocking_issues" is ONLY for a problem serious enough to stop the post. An
empty list is the expected result for a competent video. Do not pad it.`;

/**
 * The safe area is guaranteed by construction, not by eyeballing frames: the
 * caption block starts at a fixed y and autoFit caps it at 2 lines, the
 * headline at 3. This recomputes the worst case from the same constants the
 * renderer uses, so a future tweak to a font size or offset fails loudly here
 * instead of silently pushing text under TikTok's UI.
 */
export function layoutInvariants() {
  const results = [];
  const floor = SAFE_AREA.height - SAFE_AREA.bottom;
  const lineHeight = (size) => Math.ceil(size * 1.04);

  // "ui" beats put the line below the mock, capped at 2 lines + plate padding.
  const uiTextBottom = UI_TEXT_Y + 2 * lineHeight(112) + 40;
  results.push(
    uiTextBottom <= floor
      ? pass("layout-ui-text", `ui text ends at ${uiTextBottom}px, floor is ${floor}px`)
      : fail("layout-ui-text", `ui text reaches ${uiTextBottom}px, past the ${floor}px safe floor`)
  );

  // Top-placed text (hook, statements, CTA) gets 3 lines at the hook size.
  const topTextBottom = SAFE_AREA.top + 60 + 3 * lineHeight(130);
  results.push(
    topTextBottom <= floor
      ? pass("layout-top-text", `top text ends at ${topTextBottom}px, floor is ${floor}px`)
      : fail("layout-top-text", `top text reaches ${topTextBottom}px, past the ${floor}px safe floor`)
  );

  return results;
}

/** Model review of sampled frames. */
export async function visionChecks({ videoPath, sampleCount = 6, scratchDir }) {
  if (!KEYS.openai()) {
    return {
      ok: false,
      skipped: true,
      detail: "OPENAI_API_KEY not set — visual QC could not run, so the video is not cleared to post.",
    };
  }
  const info = probe(videoPath);
  // Always include the very first frame: the hook is scored on it.
  const times = [0.2];
  for (let i = 1; i < sampleCount; i++) {
    times.push(Number(((info.seconds * i) / sampleCount).toFixed(2)));
  }
  const frames = extractFrames(videoPath, times, scratchDir);
  const images = frames.map(asBase64);

  const review = await chat({
    system: RUBRIC,
    user: `Frame 1 is the opening frame; the rest are evenly spaced through the video. Review them.`,
    images,
    json: true,
    temperature: 0.2,
  });

  const scores = review.scores || {};
  const lows = Object.entries(scores).filter(
    ([k, v]) => Number(v) < (LIMITS.scoreFloors[k] ?? 3)
  );
  const blocking = review.blocking_issues || [];
  const ok =
    Number(review.overall) >= LIMITS.minOverall && lows.length === 0 && blocking.length === 0;

  return { ok, skipped: false, scores, overall: review.overall, blocking, notes: review.notes, frames };
}

/** Run everything. `ok` true means: safe to publish. */
export async function runQC(ctx) {
  const hard = hardChecks(ctx);
  const hardFailures = hard.filter((r) => !r.ok);

  // Don't spend vision tokens on a video that already failed a hard check.
  if (hardFailures.length) {
    return { ok: false, hard, vision: null, failures: hardFailures.map((f) => `${f.check}: ${f.detail}`) };
  }

  const vision = await visionChecks(ctx);
  const failures = [];
  if (vision.skipped) failures.push(`vision: ${vision.detail}`);
  else if (!vision.ok) {
    for (const [k, v] of Object.entries(vision.scores || {})) {
      const floorVal = LIMITS.scoreFloors[k] ?? 3;
      if (Number(v) < floorVal) failures.push(`vision.${k}: scored ${v}/5, needs ${floorVal}`);
    }
    for (const b of vision.blocking || []) failures.push(`vision.blocking: ${b}`);
    if (Number(vision.overall) < LIMITS.minOverall) failures.push(`vision.overall: ${vision.overall}/5`);
  }

  return { ok: failures.length === 0, hard, vision, failures };
}
