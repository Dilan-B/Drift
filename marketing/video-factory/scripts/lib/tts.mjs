// Voiceover for each beat.
//
// Provider order: ElevenLabs > OpenAI > macOS `say`. The macOS voice is a
// last-resort fallback so the pipeline still produces something offline — it
// is NOT good enough to publish, and the QC gate flags it.

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFile } from "music-metadata";
import { tightenVoice } from "./media.mjs";
import { KEYS, MODELS, trackUsage } from "./openai.mjs";

// The ElevenLabs paywall is a per-run fact, not a per-beat one. Logging it on
// every beat buried the rest of a cron log under six identical lines.
let warnedFallback = false;

export function pickProvider() {
  if (KEYS.eleven()) return "elevenlabs";
  if (KEYS.openai()) return "openai";
  return "say";
}

export const DEFAULT_VOICE = {
  elevenlabs: process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM", // Rachel
  openai: process.env.OPENAI_TTS_VOICE || "nova",
  say: "Samantha",
};

async function ttsElevenLabs(text, outFile, voice) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
    method: "POST",
    headers: { "xi-api-key": KEYS.eleven(), "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
      // Slightly lower stability reads as more natural on short social lines.
      voice_settings: { stability: 0.42, similarity_boost: 0.78, style: 0.25 },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  writeFileSync(outFile, Buffer.from(await res.arrayBuffer()));
}

async function ttsOpenAI(text, outFile, voice) {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEYS.openai()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODELS.tts(),
      voice,
      input: text,
      instructions: process.env.VF_VOICE_DIRECTION ||
        "Sound like a nineteen year old talking to their phone camera. Relaxed and " +
        "offhand, not performing, not selling. Vary the pace naturally — rush a few " +
        "unimportant words, slow down on the ones that matter. Slightly imperfect is " +
        "better than polished.",
      response_format: "mp3",
    }),
  });
  if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  writeFileSync(outFile, Buffer.from(await res.arrayBuffer()));
}

function ttsMacSay(text, outFile, voice) {
  const aiff = outFile.replace(/\.\w+$/, ".aiff");
  execFileSync("say", ["-v", voice, "-o", aiff, text]);
  execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16", aiff, outFile]);
  rmSync(aiff, { force: true });
}

/** Speak one beat. Duration drives the beat's frame count. */
export async function speakBeat(beat, { dir, index, provider, voice }) {
  mkdirSync(dir, { recursive: true });
  const ext = provider === "say" ? "wav" : "mp3";
  const file = `beat-${index + 1}.${ext}`;
  const outFile = join(dir, file);

  // Providers are tried in order of quality, falling back on failure. This
  // matters because the failure is not hypothetical: an ElevenLabs FREE key
  // authenticates fine and then 402s on every synthesis ("Free users cannot
  // use library voices via the API"). Without a fallback, adding a key that
  // looks valid takes the whole pipeline down.
  let used = provider;
  if (provider === "elevenlabs") {
    try {
      await ttsElevenLabs(beat.say, outFile, voice);
    } catch (err) {
      const paywalled = /402|payment_required|paid_plan_required/i.test(err.message);
      used = KEYS.openai() ? "openai" : "say";
      if (!warnedFallback) {
        warnedFallback = true;
        console.log(
          `[tts] ElevenLabs unavailable (${paywalled ? "free plan cannot synthesise via API" : err.message.slice(0, 90)})` +
          ` — using ${used === "openai" ? "OpenAI" : "macOS say"} for this run`
        );
      }
      if (used === "openai") await ttsOpenAI(beat.say, outFile, DEFAULT_VOICE.openai);
      else ttsMacSay(beat.say, outFile, DEFAULT_VOICE.say);
    }
  } else if (provider === "openai") {
    await ttsOpenAI(beat.say, outFile, voice);
  } else {
    ttsMacSay(beat.say, outFile, voice);
  }

  // No tempo lift by default. Speeding up already-synthetic speech is what made
  // the voice sound processed; length is controlled by beat count instead.
  const tempo = Number(process.env.VF_VOICE_TEMPO ?? 1);
  const { saved } = tightenVoice(outFile, { tempo });
  const meta = await parseFile(outFile);
  const seconds = meta.format.duration || beat.say.split(/\s+/).length / 2.35;

  if (used === "openai") {
    // gpt-4o-mini-tts bills text in + audio out; audio tokens track duration.
    trackUsage({ model: MODELS.tts(), in: beat.say.length / 4, out: (seconds / 60) * 1000 });
  }

  return { file, seconds, provider: used, saved };
}
