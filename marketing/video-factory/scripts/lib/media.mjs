// ffmpeg/ffprobe helpers. Remotion ships its own static builds, so the
// pipeline has no system ffmpeg dependency — `npx remotion ffmpeg` is used
// rather than assuming one is on PATH (this machine has none).

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./openai.mjs";

// r_frame_rate arrives as "30/1". Parse it rather than eval it.
const parseRate = (r) => {
  const [n, d] = String(r || "0/1").split("/").map(Number);
  return d ? n / d : n || 0;
};

const run = (tool, args) =>
  execFileSync("npx", ["remotion", tool, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });

/** Container/stream summary for a media file. */
export function probe(file) {
  const out = run("ffprobe", [
    "-v", "quiet", "-print_format", "json",
    "-show_format", "-show_streams", file,
  ]);
  const data = JSON.parse(out);
  const video = data.streams.find((s) => s.codec_type === "video");
  const audio = data.streams.find((s) => s.codec_type === "audio");
  return {
    seconds: Number(data.format?.duration || 0),
    bytes: Number(data.format?.size || 0),
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    fps: video ? parseRate(video.r_frame_rate) : 0,
    videoCodec: video?.codec_name ?? null,
    hasAudio: !!audio,
    audioCodec: audio?.codec_name ?? null,
  };
}

/** Extract PNG frames at the given timestamps. Returns file paths. */
export function extractFrames(video, seconds, outDir) {
  mkdirSync(outDir, { recursive: true });
  const files = [];
  for (const [i, t] of seconds.entries()) {
    const out = join(outDir, `f${String(i).padStart(2, "0")}.png`);
    // -ss before -i seeks fast; good enough at whole-second granularity.
    run("ffmpeg", ["-y", "-ss", String(t), "-i", video, "-frames:v", "1",
                   "-vf", "scale=540:-1", out]);
    files.push(out);
  }
  return files;
}

export const asBase64 = (file) => readFileSync(file).toString("base64");

/**
 * Total silent duration in the audio track. A video whose voiceover failed to
 * attach renders perfectly and is completely silent — worth catching before
 * it reaches an account.
 */
export function silenceSeconds(video, threshold = "-45dB", minDur = 0.8) {
  // ffmpeg writes silencedetect results to stderr and exits 0, so this has to
  // read stderr on SUCCESS. An earlier version only inspected it inside a
  // catch block, which meant the check silently always returned 0.
  // `-f null -` is unavailable: Remotion's ffmpeg build disables the
  // wrapped_avframe encoder the null muxer needs. Dropping the video stream and
  // muxing the audio to /dev/null as wav runs the filter and discards the output.
  const res = spawnSync("npx",
    ["remotion", "ffmpeg", "-hide_banner", "-nostats", "-i", video, "-vn", "-af",
     `silencedetect=noise=${threshold}:d=${minDur}`, "-f", "wav", "-y", "/dev/null"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

  const stderr = `${res.stderr || ""}${res.stdout || ""}`;
  const durations = [...stderr.matchAll(/silence_duration:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  let total = durations.reduce((a, b) => a + b, 0);

  // A silence that runs to the end of the file has a start but no duration line.
  const starts = [...stderr.matchAll(/silence_start:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  if (starts.length > durations.length) {
    const dur = probe(video).seconds - starts[starts.length - 1];
    if (dur > 0) total += dur;
  }
  return total;
}

/** Video files sitting in a public/ subfolder, for the script writer to use. */
export function listClips(subdir) {
  const dir = join(ROOT, "public", subdir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /\.(mp4|mov|webm)$/i.test(f));
}

/**
 * Tighten a voice clip: shave the edge silence, then speed it up slightly.
 *
 * The edge trim is minor — gpt-4o-mini-tts leaves only ~0.09s at the head and
 * nothing at the tail. The pacing is what makes beats long: it delivers about
 * 2.2 words/sec including its own inter-word pauses, so a 9-word line runs 4s.
 * A modest tempo lift is the honest fix, and it reads as more energetic, which
 * suits the format — TikTok voiceovers are fast.
 *
 * `silenceremove` is not compiled into Remotion's ffmpeg; `silencedetect`,
 * `atrim` and `atempo` are.
 */
export function tightenVoice(file, { threshold = "-40dB", minDur = 0.06, keep = 0.03, tempo = 1 } = {}) {
  const total = probe(file).seconds;

  const det = spawnSync("npx",
    ["remotion", "ffmpeg", "-hide_banner", "-nostats", "-i", file, "-af",
     `silencedetect=noise=${threshold}:d=${minDur}`, "-f", "wav", "-y", "/dev/null"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const log = `${det.stderr || ""}${det.stdout || ""}`;
  const starts = [...log.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...log.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));

  let from = 0;
  if (starts.length && starts[0] <= 0.05 && ends.length) from = Math.max(0, ends[0] - keep);
  let to = total;
  if (starts.length > ends.length) to = Math.min(total, starts[starts.length - 1] + keep);

  const needsTrim = from > 0.01 || to < total - 0.01;
  const needsTempo = Math.abs(tempo - 1) > 0.001;
  if (!needsTrim && !needsTempo) return { seconds: total, saved: 0 };

  const chain = [];
  if (needsTrim) chain.push(`atrim=start=${from.toFixed(3)}:end=${to.toFixed(3)}`, "asetpts=PTS-STARTPTS");
  // atempo is only valid in 0.5-2.0 per stage; our range is well inside it.
  if (needsTempo) chain.push(`atempo=${tempo.toFixed(3)}`);

  const tmp = file.replace(/(\.\w+)$/, ".tight$1");
  const cut = spawnSync("npx",
    ["remotion", "ffmpeg", "-hide_banner", "-nostats", "-y", "-i", file, "-af", chain.join(","), tmp],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (cut.status !== 0 || !existsSync(tmp)) return { seconds: total, saved: 0 };

  renameSync(tmp, file);
  const after = probe(file).seconds;
  return { seconds: after, saved: Number((total - after).toFixed(2)) };
}
