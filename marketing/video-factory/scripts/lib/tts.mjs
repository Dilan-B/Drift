// Voiceover + the word timings that drive the karaoke captions.
//
// Provider order: ElevenLabs > OpenAI > macOS `say`. The macOS voice is a
// last-resort fallback so the pipeline still produces something offline — it
// is NOT good enough to publish, and the QC gate flags it.

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFile } from "music-metadata";
import { KEYS, MODELS, transcribeWords, trackUsage } from "./openai.mjs";
import { alignToScript, chunkWords, evenChunks } from "../../src/captions.js";

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
      instructions:
        "Young, natural, slightly wry. Talking to a friend, not reading an advert. " +
        "Quick pace, clear consonants, no radio-announcer lilt, no upsell energy.",
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

/**
 * Speak one beat and return its audio file, duration and caption chunks.
 * Word timings come from Whisper on the generated audio, which works for every
 * provider. If transcription is unavailable the words are spread evenly — less
 * precise, but the video still ships with captions.
 */
export async function speakBeat(beat, { dir, index, provider, voice }) {
  mkdirSync(dir, { recursive: true });
  const ext = provider === "say" ? "wav" : "mp3";
  const file = `beat-${index + 1}.${ext}`;
  const outFile = join(dir, file);

  if (provider === "elevenlabs") await ttsElevenLabs(beat.say, outFile, voice);
  else if (provider === "openai") await ttsOpenAI(beat.say, outFile, voice);
  else ttsMacSay(beat.say, outFile, voice);

  const meta = await parseFile(outFile);
  const seconds = meta.format.duration || beat.say.split(/\s+/).length / 2.8;

  if (provider === "openai") {
    // gpt-4o-mini-tts bills text in + audio out; audio tokens track duration.
    trackUsage({ model: MODELS.tts(), in: beat.say.length / 4, out: (seconds / 60) * 1000 });
  }

  let chunks;
  let timingSource = "whisper";
  try {
    const words = await transcribeWords(outFile);
    if (!words.length) throw new Error("no words returned");
    // Whisper's tokens are not our words — realign before chunking, or a
    // caption can break in the middle of a word.
    const aligned = alignToScript(words, beat.say);
    if (aligned) {
      chunks = chunkWords(aligned);
    } else {
      timingSource = "whisper-unaligned";
      chunks = chunkWords(words);
    }
  } catch (err) {
    timingSource = "estimated";
    chunks = evenChunks(beat.say, seconds);
  }

  return { file, seconds, chunks, timingSource };
}
