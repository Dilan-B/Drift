// ffmpeg/ffprobe helpers. Remotion ships its own static builds, so the
// pipeline has no system ffmpeg dependency — `npx remotion ffmpeg` is used
// rather than assuming one is on PATH (this machine has none).

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, existsSync } from "node:fs";
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
