// Procedural music bed.
//
// The pipeline has to be hands-off, which rules out "add a trending sound in
// the app". Licensed library music would mean sourcing and rights-checking a
// catalogue; synthesising it here costs nothing, carries no licensing risk at
// all, and can vary per video so the account does not sound identical daily.
//
// Deliberately a calm pad rather than a beat: a mediocre drum loop is instantly
// recognisable as cheap, whereas a soft chord bed under text reads as
// intentional. Matches the brand better too.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SR = 44100;

// A minor, i–VI–III–VII. Common, unremarkable, and it stays out of the way.
const PROGRESSIONS = [
  { name: "am", roots: [57, 53, 60, 55] },   // Am F C G
  { name: "dm", roots: [50, 57, 53, 48] },   // Dm Am F C
  { name: "em", roots: [52, 48, 55, 50] },   // Em C G D
];
const TRIAD_MINOR = [0, 3, 7];
const TRIAD_MAJOR = [0, 4, 7];

const midiToHz = (n) => 440 * Math.pow(2, (n - 69) / 12);

/** One-pole lowpass. Takes the edge off raw sines without a filter library. */
function lowpass(buf, cutoffHz) {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const a = (1 / SR) / (rc + 1 / SR);
  let last = 0;
  for (let i = 0; i < buf.length; i++) {
    last += a * (buf[i] - last);
    buf[i] = last;
  }
}

/**
 * Render a bed of `seconds` length.
 * `seed` picks the progression and tempo so consecutive videos differ.
 */
export function renderMusic(seconds, outFile, { seed = 0, gain = 0.22 } = {}) {
  const prog = PROGRESSIONS[seed % PROGRESSIONS.length];
  const bpm = 76 + (seed % 3) * 6;            // 76 / 82 / 88
  const beat = 60 / bpm;
  const barSeconds = beat * 4;
  const total = Math.ceil(seconds * SR);
  const out = new Float64Array(total);

  for (let i = 0; i < total; i++) {
    const t = i / SR;
    const bar = Math.floor(t / barSeconds);
    const root = prog.roots[bar % prog.roots.length];
    // Minor triad on the tonic bars, major on the others — enough motion to
    // stop it sounding like one held drone.
    const triad = bar % prog.roots.length === 0 ? TRIAD_MINOR : TRIAD_MAJOR;
    const posInBar = (t % barSeconds) / barSeconds;

    // Pad: slow swell across each bar, detuned pairs for width.
    const swell = Math.sin(Math.PI * posInBar) ** 0.7;
    let pad = 0;
    for (const iv of triad) {
      const f = midiToHz(root + iv + 12);
      pad += Math.sin(2 * Math.PI * f * t);
      pad += 0.6 * Math.sin(2 * Math.PI * f * 1.004 * t);   // detune
    }
    pad *= swell / (triad.length * 1.6);

    // Sub: root an octave down, gently pulsing on the beat.
    const beatPhase = (t % beat) / beat;
    const pulse = 0.45 + 0.55 * Math.exp(-6 * beatPhase);
    const sub = 0.5 * Math.sin(2 * Math.PI * midiToHz(root - 12) * t) * pulse;

    out[i] = pad * 0.75 + sub * 0.5;
  }

  lowpass(out, 2600);

  // Fades, so it neither starts abruptly nor gets cut off mid-note.
  const fadeIn = Math.floor(1.2 * SR);
  const fadeOut = Math.floor(1.6 * SR);
  for (let i = 0; i < fadeIn && i < total; i++) out[i] *= i / fadeIn;
  for (let i = 0; i < fadeOut && i < total; i++) out[total - 1 - i] *= i / fadeOut;

  // Normalise, then apply the (quiet) target gain — this sits under text, not
  // in front of it.
  let peak = 0;
  for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(out[i]));
  const scale = peak > 0 ? gain / peak : 0;

  const pcm = Buffer.alloc(total * 2);
  for (let i = 0; i < total; i++) {
    const v = Math.max(-1, Math.min(1, out[i] * scale));
    pcm.writeInt16LE(Math.round(v * 32767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);          // PCM
  header.writeUInt16LE(1, 22);          // mono
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, Buffer.concat([header, pcm]));
  return { file: outFile, seconds, bpm, progression: prog.name };
}
