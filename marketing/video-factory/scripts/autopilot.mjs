#!/usr/bin/env node
// Drift TikTok autopilot: idea -> script -> voiceover -> render -> QC -> post.
//
//   node scripts/autopilot.mjs --dry-run          # everything except posting
//   node scripts/autopilot.mjs                    # full run, posts to TikTok
//   node scripts/autopilot.mjs --count 3          # a batch
//   node scripts/autopilot.mjs --seed "back to school"
//   node scripts/autopilot.mjs --script content/my.json --dry-run   # skip the AI stages
//
// The QC gate (scripts/lib/qc.mjs) is what makes unattended posting safe. A
// video that fails it is never posted; the failures are fed back into a fresh
// script attempt, and after --max-attempts the run gives up loudly rather than
// shipping something mediocre.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { ROOT, usageReport } from "./lib/openai.mjs";
import { generateIdeas, recordRun, loadHistory, themeForRun, FORMATS } from "./lib/ideas.mjs";
import { writeScript, validateScript } from "./lib/script.mjs";
import { speakBeat, pickProvider, DEFAULT_VOICE } from "./lib/tts.mjs";
import { describeClips } from "./lib/capture.mjs";
import { runQC } from "./lib/qc.mjs";
import * as tiktok from "./lib/tiktok.mjs";

const FPS = 30;
const PAD_FRAMES = 6; // tight pacing; the brand-film build used 14

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (n) => args.includes(`--${n}`);

const opts = {
  count: Number(flag("count") || 1),
  seed: flag("seed"),
  slot: Number(flag("slot") ?? 0),
  dryRun: has("dry-run"),
  noPost: has("no-post") || has("dry-run"),
  maxAttempts: Number(flag("max-attempts") || 3),
  voice: flag("voice"),
  keep: has("keep"),
  scriptFile: flag("script"),
};

const log = (msg) => console.log(`[autopilot] ${msg}`);
const rule = () => console.log("─".repeat(72));

function renderVideo(propsFile, outFile) {
  execFileSync("npx",
    ["remotion", "render", "src/entry.jsx", "DriftNative", outFile, `--props=${propsFile}`],
    { cwd: ROOT, stdio: "inherit" });
}

/** One full attempt: script -> voiceover -> render -> QC. */
async function attempt({ idea, name, captures, brollClips, provider, voice, feedback, n, fixedScript }) {
  let script;
  if (fixedScript) {
    log(`attempt ${n}: using supplied script ${opts.scriptFile}`);
    script = structuredClone(fixedScript);
  } else {
    log(`attempt ${n}: writing script`);
    // Prior QC failures are passed INTO the writer as constraints. Assigning
    // them to the returned script afterwards (as this did) fed back nothing —
    // the "self-correcting" retry was really just re-rolling.
    ({ script } = await writeScript(idea, { captures, brollClips, qcFeedback: feedback }));
  }

  const audioDir = join(ROOT, "public", "audio", name);
  const beats = [];
  // The requested provider can fall back mid-run; QC judges what was actually used.
  let actualProvider = provider;
  let trimmedTotal = 0;
  log(`attempt ${n}: voicing ${script.beats.length} beats (${provider})`);
  for (const [i, beat] of script.beats.entries()) {
    const { file, seconds, provider: usedProvider, saved } = await speakBeat(beat, {
      dir: audioDir, index: i, provider, voice,
    });
    actualProvider = usedProvider;
    trimmedTotal += saved || 0;
    beats.push({
      ...beat,
      audio: file,
      frames: Math.ceil(seconds * FPS) + PAD_FRAMES,
    });
  }

  if (trimmedTotal > 0.5) log(`attempt ${n}: tightened voiceover by ${trimmedTotal.toFixed(1)}s`);

  const props = {
    beats,
    audioBase: `audio/${name}`,
    title: script.title,
    postCaption: script.postCaption,
    hashtags: script.hashtags,
  };
  const propsFile = join(ROOT, "content", `${name}.native.json`);
  writeFileSync(propsFile, JSON.stringify(props, null, 2));

  const outFile = join(ROOT, "out", `${name}.mp4`);
  const totalSec = beats.reduce((a, b) => a + b.frames, 0) / FPS;
  log(`attempt ${n}: rendering ${totalSec.toFixed(1)}s -> out/${name}.mp4`);
  renderVideo(propsFile, outFile);

  log(`attempt ${n}: running QC`);
  const qc = await runQC({
    videoPath: outFile,
    script,
    beats,
    ttsProvider: actualProvider,
    scratchDir: join(ROOT, "content", "state", "qc", name),
  });

  return { script, beats, props, propsFile, outFile, qc };
}

async function makeOne(index) {
  rule();
  log(`video ${index + 1} of ${opts.count}`);

  const captures = await describeClips("capture");
  const brollDescribed = await describeClips("broll");
  const brollClips = brollDescribed.map((c) => c.file);
  log(`footage: ${captures.length} capture, ${brollClips.length} b-roll`);

  let idea;
  let fixedScript = null;

  if (opts.scriptFile) {
    // Bypasses idea generation entirely — useful offline and for hand-written
    // scripts. The QC gate still applies in full.
    fixedScript = JSON.parse(readFileSync(opts.scriptFile, "utf8"));
    const problems = validateScript(fixedScript, {
      captureNames: captures.map((c) => c.file), brollClips,
    });
    if (problems.length) {
      throw new Error(`Supplied script fails validation:\n${problems.map((p) => `  • ${p}`).join("\n")}`);
    }
    idea = {
      hook: fixedScript.beats[0].onscreen,
      format: fixedScript.format || "manual",
      ideaKey: createHash("sha1").update(JSON.stringify(fixedScript.beats)).digest("hex").slice(0, 12),
    };
    log(`script file: "${idea.hook}"`);
  } else {
    // Formats that need footage are unavailable without any.
    const usable = Object.keys(FORMATS).filter(
      (f) => !FORMATS[f].needsCapture || captures.length || brollClips.length
    );

    // Steer each run at different territory. Without this the model returns to
    // the same framing repeatedly, which matters a lot more at three a day.
    const seed = opts.seed || themeForRun(new Date(), opts.slot + index);
    log(`theme: ${seed}`);

    let accepted = [], rejected = [], historyCount = 0;
    // If nothing survives, relax the near-duplicate bar before giving up. A run
    // that produces nothing is worse than one that revisits a related angle.
    for (const threshold of [0.6, 0.72, 0.85]) {
      ({ accepted, rejected, historyCount } = await generateIdeas(ROOT, {
        count: 10, seed, availableFormats: usable, threshold,
      }));
      if (accepted.length) {
        if (threshold > 0.6) log(`relaxed the duplicate bar to ${threshold} to find a usable idea`);
        break;
      }
      log(`no ideas survived at similarity ${threshold} — retrying looser`);
    }
    if (rejected.length) log(`rejected ${rejected.length} idea(s): ${rejected.map((r) => r.reason).join(" | ")}`);
    if (!accepted.length) throw new Error("No usable ideas survived even a relaxed filter — the angle bank may be exhausted; add THEMES in scripts/lib/ideas.mjs.");

    // Prefer a format we have not used recently. Without this the model keeps
    // choosing its favourite (three "problem-agitate" videos in a row), and an
    // account that posts the same shape every time gets stale fast.
    const recentFormats = loadHistory(ROOT).slice(-4).map((h) => h.format);
    accepted.sort(
      (a, b) => recentFormats.lastIndexOf(a.format) - recentFormats.lastIndexOf(b.format)
    );

    idea = accepted[0];
    const staleness = recentFormats.lastIndexOf(idea.format);
    log(
      `idea (${idea.format}${staleness === -1 ? ", unused recently" : ""}): "${idea.hook}"` +
      `  [${historyCount} previous videos]`
    );
  }

  const provider = pickProvider();
  const voice = opts.voice || DEFAULT_VOICE[provider];
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `${stamp}-${(idea.format || "video")}-${idea.ideaKey.slice(0, 6)}`;

  let feedback = null;
  for (let n = 1; n <= opts.maxAttempts; n++) {
    const name = n === 1 ? base : `${base}-r${n}`;
    const result = await attempt({ idea, name, captures, brollClips, provider, voice, feedback, n, fixedScript });

    if (result.qc.ok) {
      log(`QC PASSED (vision overall ${result.qc.vision?.overall ?? "n/a"}/5)`);
      return { ...result, idea, name };
    }

    console.log("");
    log(`QC FAILED — not posting. Reasons:`);
    for (const f of result.qc.failures) console.log(`   • ${f}`);
    feedback = result.qc.failures.join("\n");

    if (n === opts.maxAttempts) {
      throw new Error(
        `Gave up after ${opts.maxAttempts} attempts. The last render is at out/${name}.mp4 ` +
        `if you want to look at what it could not fix.`
      );
    }
    log(`retrying with those failures as constraints`);
  }
}

async function post(result) {
  const caption = [result.props.postCaption, (result.props.hashtags || []).join(" ")]
    .filter(Boolean).join("\n\n");

  if (opts.noPost) {
    log(`--dry-run: not posting. Caption would be:\n\n${caption}\n`);
    return { skipped: true, caption };
  }
  if (!tiktok.isConfigured()) {
    log("TikTok not configured (missing keys or tokens) — skipping the post step.");
    log("Run: node scripts/tiktok-auth.mjs");
    return { skipped: true, caption };
  }

  log("uploading to TikTok");
  const pub = await tiktok.publishVideo({ videoPath: result.outFile, caption });
  log(`upload accepted (publish_id ${pub.publishId}, privacy ${pub.privacyLevel})`);

  const status = await tiktok.waitForPublish(pub.publishId);
  log(`TikTok status: ${status.status}${status.timedOut ? " (still processing)" : ""}`);
  if (pub.privacyLevel === "SELF_ONLY") {
    log("Posted PRIVATE — this is the unaudited-client restriction, not a bug.");
  }
  return { ...pub, status: status.status, caption };
}

// ── main ─────────────────────────────────────────────────────
mkdirSync(join(ROOT, "out"), { recursive: true });
mkdirSync(join(ROOT, "content", "state"), { recursive: true });

let made = 0;
for (let i = 0; i < opts.count; i++) {
  try {
    const result = await makeOne(i);
    const published = await post(result);

    recordRun(ROOT, {
      ideaKey: result.idea.ideaKey,
      hook: result.idea.hook,
      format: result.idea.format,
      title: result.props.title,
      file: `out/${result.name}.mp4`,
      qcOverall: result.qc.vision?.overall ?? null,
      posted: !published.skipped,
      publishId: published.publishId ?? null,
      privacy: published.privacyLevel ?? null,
    });
    made++;
    rule();
    log(`done: out/${result.name}.mp4`);
  } catch (err) {
    rule();
    console.error(`[autopilot] video ${i + 1} failed: ${err.message}`);
    if (opts.count === 1) process.exitCode = 1;
  }
}

if (!opts.keep) rmSync(join(ROOT, "content", "state", "qc"), { recursive: true, force: true });
const spend = usageReport();
rule();
log(`finished: ${made}/${opts.count} video(s) produced`);
if (spend.calls) {
  const per = made ? spend.totalUsd / made : spend.totalUsd;
  log(`OpenAI spend: $${spend.totalUsd.toFixed(4)} across ${spend.calls} calls` +
      (made ? ` ($${per.toFixed(4)} per video)` : ""));
  for (const [m, c] of Object.entries(spend.byModel)) log(`   ${m}: $${c.toFixed(4)}`);
}
