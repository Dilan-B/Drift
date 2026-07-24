#!/usr/bin/env node
// Drift video factory — one command from brief to rendered MP4.
//
//   node scripts/make-video.mjs                          -> default script, offline voice
//   node scripts/make-video.mjs --brief "back to school" -> AI-written script (needs OPENAI_API_KEY)
//   node scripts/make-video.mjs --script content/x.json  -> your own script file
//   flags: --name <slug> --voice <tts-voice> --no-audio
//
// Voiceover: OpenAI TTS when OPENAI_API_KEY is set, otherwise macOS `say`.

import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFile } from "music-metadata";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FPS = 30;

// Load marketing/video-factory/.env (gitignored) into process.env
const envFile = join(ROOT, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY || "";

// ── args ─────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getFlag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const brief = getFlag("brief");
const scriptPath = getFlag("script");
const ttsProvider = ELEVEN_KEY ? "elevenlabs" : OPENAI_KEY ? "openai" : "say";
const voice =
  getFlag("voice") ||
  { elevenlabs: "21m00Tcm4TlvDq8ikWAM", openai: "nova", say: "Samantha" }[ttsProvider];
const noAudio = args.includes("--no-audio");
const name =
  getFlag("name") ||
  (brief
    ? brief.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)
    : "drift-promo");

const log = (msg) => console.log(`[video-factory] ${msg}`);

// ── 1. script ────────────────────────────────────────────────
const VISUAL_TYPES = ["hook", "shield", "tasks", "earn", "challenge", "proof", "approve", "cta"];

// AI b-roll clips (e.g. from Higgsfield/Runway) dropped into public/broll/
const BROLL_DIR = join(ROOT, "public", "broll");
const brollClips = existsSync(BROLL_DIR)
  ? readdirSync(BROLL_DIR).filter((f) => /\.(mp4|mov|webm)$/i.test(f))
  : [];

async function writeScriptWithAI(briefText) {
  log(`writing script with OpenAI for brief: "${briefText}"`);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You write scripts for short vertical marketing videos for Drift, an iOS app where you earn screen time by completing real-life tasks. Distracting apps stay locked behind an iOS Screen Time shield until you've earned minutes.

Return ONLY JSON: {"title": string, "scenes": [{"visual": string, "kicker": string, "headline": string, "voiceover": string}]}.

Rules:
- 5 to 6 scenes. "visual" must be one of: ${[...VISUAL_TYPES, ...(brollClips.length ? ["broll"] : [])].join(", ")}. Start with "hook", end with "cta". Use each of shield/tasks/earn at most once, in a natural order.${
            brollClips.length
              ? `\n- A "broll" scene shows full-screen live-action footage with the headline overlaid. It must also include "src": one of ${JSON.stringify(brollClips)} — pick the clip whose filename best matches the scene's message. Use 1-2 broll scenes where real footage hits harder than UI graphics.`
              : ""
          }
- "headline": max 8 words, punchy, on-screen text.
- "kicker": 1-3 word label above the headline.
- "voiceover": one or two conversational sentences, spoken aloud, 5-9 seconds each. Total spoken time 25-40 seconds.
- Tone: sharp, a little confrontational about doomscrolling, never preachy. The brand line is "Earn your scroll."`,
        },
        { role: "user", content: `Brief / angle for this video: ${briefText}` },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI script generation failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  if (!Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
    throw new Error("AI returned no scenes");
  }
  for (const s of parsed.scenes) {
    if (s.visual === "broll") {
      if (!brollClips.includes(s.src)) s.src = brollClips[0];
      if (!s.src) s.visual = "hook";
    } else if (!VISUAL_TYPES.includes(s.visual)) {
      s.visual = "hook";
    }
  }
  return parsed;
}

async function getScript() {
  if (scriptPath) {
    log(`using script file ${scriptPath}`);
    return JSON.parse(readFileSync(resolve(scriptPath), "utf8"));
  }
  if (brief) {
    if (!OPENAI_KEY) {
      throw new Error(
        "--brief needs OPENAI_API_KEY for script writing. Set it, or pass --script <file.json>, or run with no args for the default script."
      );
    }
    return writeScriptWithAI(brief);
  }
  log("no brief/script given — using built-in default script");
  const mod = await import(join(ROOT, "src", "defaultScript.js"));
  return structuredClone(mod.default);
}

// ── 2. voiceover ─────────────────────────────────────────────
async function ttsOpenAI(text, outFile) {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
      voice,
      input: text,
      instructions:
        "Warm, calm, confident narrator for a short social ad. Conversational pace, slight energy, no radio-announcer affect.",
      response_format: "mp3",
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI TTS failed: ${res.status} ${await res.text()}`);
  }
  writeFileSync(outFile, Buffer.from(await res.arrayBuffer()));
}

async function ttsElevenLabs(text, outFile) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
    method: "POST",
    headers: { "xi-api-key": ELEVEN_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
      voice_settings: { stability: 0.45, similarity_boost: 0.75 },
    }),
  });
  if (!res.ok) {
    throw new Error(`ElevenLabs TTS failed: ${res.status} ${await res.text()}`);
  }
  writeFileSync(outFile, Buffer.from(await res.arrayBuffer()));
}

function ttsMacSay(text, outFile) {
  const aiff = outFile.replace(/\.wav$/, ".aiff");
  execFileSync("say", ["-v", voice, "-o", aiff, text]);
  execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16", aiff, outFile]);
  rmSync(aiff);
}

// ── main ─────────────────────────────────────────────────────
const script = await getScript();
const audioDir = join(ROOT, "public", "audio", name);
mkdirSync(audioDir, { recursive: true });
mkdirSync(join(ROOT, "out"), { recursive: true });
mkdirSync(join(ROOT, "content"), { recursive: true });

const PAD_FRAMES = 14; // breathing room after each VO line
const MIN_FRAMES = 75;

for (let i = 0; i < script.scenes.length; i++) {
  const scene = script.scenes[i];
  if (noAudio || !scene.voiceover) {
    scene.audio = null;
    scene.frames = scene.frames || 105;
    continue;
  }
  const ext = ttsProvider === "say" ? "wav" : "mp3";
  const file = `scene-${i + 1}.${ext}`;
  const outFile = join(audioDir, file);
  log(`voiceover ${i + 1}/${script.scenes.length} (${ttsProvider}:${voice})`);
  if (ttsProvider === "elevenlabs") {
    await ttsElevenLabs(scene.voiceover, outFile);
  } else if (ttsProvider === "openai") {
    await ttsOpenAI(scene.voiceover, outFile);
  } else {
    ttsMacSay(scene.voiceover, outFile);
  }
  const meta = await parseFile(outFile);
  const dur = meta.format.duration || 3;
  scene.audio = file;
  scene.frames = Math.max(MIN_FRAMES, Math.ceil(dur * FPS) + PAD_FRAMES);
}

const props = { ...script, audioBase: `audio/${name}` };
const propsFile = join(ROOT, "content", `${name}.props.json`);
writeFileSync(propsFile, JSON.stringify(props, null, 2));
log(`script + timing saved to content/${name}.props.json`);

const outVideo = join(ROOT, "out", `${name}.mp4`);
const totalSec = script.scenes.reduce((a, s) => a + s.frames, 0) / FPS;
log(`rendering ${totalSec.toFixed(1)}s video -> out/${name}.mp4`);
execSync(
  `npx remotion render src/entry.jsx DriftPromo "${outVideo}" --props="${propsFile}"`,
  { cwd: ROOT, stdio: "inherit" }
);
log(`done: ${outVideo}`);
