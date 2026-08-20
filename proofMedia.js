/**
 * proofMedia.js
 * Turning what the camera produced into something verify-task can actually read.
 *
 * Two jobs:
 *   1. Photos  — shrink to a size OpenAI accepts without the edge function
 *                blowing its 60s wall clock.
 *   2. Video   — Drift never uploads the video file. Chat models don't accept
 *                video, and a 30-second clip is tens of megabytes. Instead we
 *                sample evenly spaced still frames and send those as an
 *                ordered bundle; motion between frames is what makes a video
 *                stronger evidence than a single photo, and the sampled frames
 *                preserve exactly that.
 *
 * So the size cap that matters is on the FRAME BUNDLE we transmit, not on the
 * .mov sitting in the cache. A 1 MB budget is enforced here by degrading in
 * three steps — shrink the frames, then drop frames, then refuse — rather than
 * rejecting outright, because a clip that is 200 KB over is not a clip worth
 * making the user re-record.
 */

// Optional native modules. All three are wrapped because a JS-only reload
// (Expo Go, or a build that predates the dependency) must not hard-crash the
// bundle — the UI degrades to photo/text proof instead.
let ImageManipulator = null;
let VideoThumbnails  = null;
let FileSystem       = null;
let FileSystemLegacy = null;
try { ImageManipulator = require("expo-image-manipulator"); } catch {}
try { VideoThumbnails  = require("expo-video-thumbnails"); } catch {}
try { FileSystem       = require("expo-file-system"); } catch {}
try { FileSystemLegacy = require("expo-file-system/legacy"); } catch {}

// ── Budgets ───────────────────────────────────────────────────
// Measured in base64 characters, which is what actually crosses the wire and
// what the edge function checks. base64 inflates by ~4/3, so 1,000,000 chars
// is roughly a 750 KB payload.
export const FRAME_BUNDLE_MAX_CHARS = 1_000_000;
export const SINGLE_IMAGE_MAX_CHARS = 440_000;

// Frames sampled from a clip. Six is the server ceiling; four is plenty to
// establish a repeated movement and costs a third less to review.
export const TARGET_FRAMES = 5;
export const MIN_FRAMES    = 3;

// Recording limits. 45s is generous for "do 10 push-ups" and keeps even a
// high-bitrate capture inside a size we can sample without thrashing.
export const VIDEO_MAX_SECONDS = 45;

// Hard reject above this. Not a quality judgement — a file this large means
// the picker ignored our quality hint, and reading it frame by frame would
// stall the UI for a long time with no way to report progress.
export const VIDEO_HARD_MAX_BYTES = 120 * 1024 * 1024;

export const videoSupported = () => !!(VideoThumbnails?.getThumbnailAsync && ImageManipulator?.manipulateAsync);
export const photoSupported = () => !!ImageManipulator?.manipulateAsync;

/** Best-effort byte size of a local file. Returns null when unknowable. */
export async function fileSize(uri) {
  try {
    if (FileSystem?.File) {
      const f = new FileSystem.File(uri);
      if (typeof f.size === "number") return f.size;
    }
  } catch {}
  try {
    if (FileSystemLegacy?.getInfoAsync) {
      const info = await FileSystemLegacy.getInfoAsync(uri, { size: true });
      if (typeof info?.size === "number") return info.size;
    }
  } catch {}
  return null;
}

/**
 * Shrink one image to `width` px on the long edge at `quality`, returning
 * base64. Returns null if the manipulator isn't available or the file is
 * unreadable.
 */
async function encode(uri, width, quality) {
  if (!ImageManipulator?.manipulateAsync) return null;
  try {
    const out = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width } }],
      { compress: quality, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );
    return out.base64 || null;
  } catch {
    return null;
  }
}

/**
 * Photo proof. 720px/0.55 rather than the old 600px/0.5 — the verification
 * pipeline now reads page numbers, counters and app screens out of the frame,
 * and at 600px those were the first thing to turn to mush.
 *
 * Steps down if the result overshoots the single-image budget.
 */
export async function preparePhoto(uri) {
  const ladder = [
    { width: 720, quality: 0.55 },
    { width: 640, quality: 0.5 },
    { width: 560, quality: 0.45 },
  ];
  for (const step of ladder) {
    const b64 = await encode(uri, step.width, step.quality);
    if (!b64) return { error: "unsupported" };
    if (b64.length <= SINGLE_IMAGE_MAX_CHARS) return { base64: b64 };
  }
  return { error: "too_large" };
}

/**
 * Video proof → an ordered bundle of base64 frames.
 *
 * @param uri         local video uri from the picker
 * @param durationMs  clip length, used to space the samples
 * @param onProgress  (done, total) — extraction is slow enough to need a UI
 * @returns {{ frames, durationSec, bytes } | { error }}
 *
 * error codes: 'unsupported' | 'too_long' | 'file_too_large' | 'no_frames' |
 *              'too_large'
 */
export async function prepareVideo(uri, durationMs, onProgress) {
  if (!videoSupported()) return { error: "unsupported" };

  const durationSec = Math.max(1, Math.round((Number(durationMs) || 0) / 1000));
  if (durationSec > VIDEO_MAX_SECONDS + 5) return { error: "too_long", durationSec };

  const bytes = await fileSize(uri);
  if (bytes && bytes > VIDEO_HARD_MAX_BYTES) return { error: "file_too_large", bytes };

  // Sample inside the clip rather than at its edges. The first and last
  // moments of a hand-held recording are the phone being picked up and put
  // down — the least informative frames in the file.
  const spanStart = durationSec * 0.08;
  const spanEnd   = durationSec * 0.92;
  const stamps = Array.from({ length: TARGET_FRAMES }, (_, i) =>
    Math.round((spanStart + ((spanEnd - spanStart) * i) / (TARGET_FRAMES - 1)) * 1000)
  );

  const uris = [];
  for (let i = 0; i < stamps.length; i++) {
    try {
      const { uri: frameUri } = await VideoThumbnails.getThumbnailAsync(uri, {
        time: stamps[i],
        quality: 0.6,
      });
      if (frameUri) uris.push(frameUri);
    } catch {
      // One unreadable timestamp (seeking past the end of a clip whose
      // reported duration was optimistic) shouldn't sink the whole submission.
    }
    onProgress?.(i + 1, stamps.length);
  }

  if (uris.length < MIN_FRAMES) return { error: "no_frames" };

  // Degrade until the bundle fits: quality first (all frames stay, each gets
  // cheaper), then frame count (drop from the middle, keeping first and last
  // so the before/after contrast survives).
  const ladder = [
    { width: 620, quality: 0.5 },
    { width: 520, quality: 0.45 },
    { width: 440, quality: 0.4 },
  ];

  for (const step of ladder) {
    const frames = [];
    for (const f of uris) {
      const b64 = await encode(f, step.width, step.quality);
      if (b64) frames.push(b64);
    }
    if (frames.length < MIN_FRAMES) continue;

    let kept = frames;
    while (kept.reduce((n, f) => n + f.length, 0) > FRAME_BUNDLE_MAX_CHARS && kept.length > MIN_FRAMES) {
      const mid = Math.floor(kept.length / 2);
      kept = [...kept.slice(0, mid), ...kept.slice(mid + 1)];
    }
    if (kept.reduce((n, f) => n + f.length, 0) <= FRAME_BUNDLE_MAX_CHARS) {
      return { frames: kept, durationSec, bytes: bytes || undefined };
    }
  }

  return { error: "too_large" };
}
