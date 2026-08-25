// TikTok Content Posting API.
//
// IMPORTANT — read before expecting public posts:
// TikTok restricts every UNAUDITED API client to SELF_ONLY (private) posts.
// The call succeeds, the video lands on the account, and only the account
// owner can see it. Lifting that requires submitting the client for audit
// (2-4 weeks, needs a recorded demo of the posting flow and a privacy policy).
// So TIKTOK_PRIVACY_LEVEL stays SELF_ONLY until the audit clears, and the
// creator_info response is treated as the authority on what is actually
// permitted rather than trusting the env var.
//
// Docs: https://developers.tiktok.com/doc/content-posting-api-get-started

import { existsSync, readFileSync, writeFileSync, statSync, openSync, readSync, closeSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { ROOT } from "./openai.mjs";

const API = "https://open.tiktokapis.com/v2";
const TOKEN_PATH = join(ROOT, "content", "state", "tiktok-tokens.json");

const MIN_CHUNK = 5 * 1024 * 1024;   // 5MB — TikTok's floor
const MAX_CHUNK = 64 * 1024 * 1024;  // 64MB — TikTok's ceiling

export function isConfigured() {
  return !!(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET && existsSync(TOKEN_PATH));
}

function loadTokens() {
  if (!existsSync(TOKEN_PATH)) {
    throw new Error(
      `No TikTok tokens at ${TOKEN_PATH}.\n` +
      `Run: node scripts/tiktok-auth.mjs   (one-time browser authorisation)`
    );
  }
  return JSON.parse(readFileSync(TOKEN_PATH, "utf8"));
}

function saveTokens(tokens) {
  mkdirSync(dirname(TOKEN_PATH), { recursive: true });
  writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

/** Access tokens last 24h; refresh tokens 365 days. Refresh when near expiry. */
export async function getAccessToken() {
  const tokens = loadTokens();
  const now = Date.now();
  if (tokens.access_token && tokens.expires_at && now < tokens.expires_at - 120_000) {
    return tokens.access_token;
  }

  const body = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY,
    client_secret: process.env.TIKTOK_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
  });
  const res = await fetch(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`TikTok token refresh failed: ${data.error_description || JSON.stringify(data)}`);
  }
  const updated = {
    ...tokens,
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    expires_at: now + (data.expires_in ?? 86400) * 1000,
  };
  saveTokens(updated);
  return updated.access_token;
}

async function api(path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data.error && data.error.code && data.error.code !== "ok")) {
    throw new Error(`TikTok ${path} failed: ${data.error?.code || res.status} — ${data.error?.message || JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

/**
 * Required before any direct post. Also tells us what this account may
 * actually do — max duration, and which privacy levels are permitted.
 */
export async function queryCreatorInfo(token) {
  const data = await api("/post/publish/creator_info/query/", token);
  return data.data;
}

function planChunks(size) {
  if (size <= MAX_CHUNK) return { chunkSize: size, count: 1 };
  const chunkSize = Math.max(MIN_CHUNK, 10 * 1024 * 1024);
  // The final chunk absorbs the remainder, so use floor, not ceil.
  return { chunkSize, count: Math.floor(size / chunkSize) };
}

async function uploadChunks(uploadUrl, file, size, chunkSize, count) {
  const fd = openSync(file, "r");
  try {
    for (let i = 0; i < count; i++) {
      const start = i * chunkSize;
      const end = i === count - 1 ? size - 1 : start + chunkSize - 1;
      const len = end - start + 1;
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, start);

      const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(len),
          "Content-Range": `bytes ${start}-${end}/${size}`,
        },
        body: buf,
      });
      if (!res.ok) {
        throw new Error(`Chunk ${i + 1}/${count} upload failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      }
    }
  } finally {
    closeSync(fd);
  }
}

export async function fetchStatus(token, publishId) {
  const data = await api("/post/publish/status/fetch/", token, { publish_id: publishId });
  return data.data;
}

/**
 * Publish a video.
 *
 * mode "direct"  -> posts to the account (SELF_ONLY until the client is audited)
 * mode "inbox"   -> lands in the user's TikTok drafts to finish by hand
 */
export async function publishVideo({
  videoPath,
  caption,
  mode = process.env.TIKTOK_POST_MODE || "direct",
  privacyLevel = process.env.TIKTOK_PRIVACY_LEVEL || "SELF_ONLY",
  disableComment = false,
  disableDuet = false,
  disableStitch = false,
  dryRun = false,
}) {
  const size = statSync(videoPath).size;
  const { chunkSize, count } = planChunks(size);
  const token = await getAccessToken();

  let creator = null;
  if (mode === "direct") {
    creator = await queryCreatorInfo(token);
    const allowed = creator.privacy_level_options || [];
    if (allowed.length && !allowed.includes(privacyLevel)) {
      // Happens on an unaudited client asking for PUBLIC_TO_EVERYONE.
      const fallback = allowed.includes("SELF_ONLY") ? "SELF_ONLY" : allowed[0];
      console.log(
        `[tiktok] "${privacyLevel}" not permitted for this client (allowed: ${allowed.join(", ")}). ` +
        `Falling back to ${fallback}. This is the unaudited-client restriction.`
      );
      privacyLevel = fallback;
    }
    const maxSec = creator.max_video_post_duration_sec;
    if (maxSec) console.log(`[tiktok] posting as @${creator.creator_username} (max ${maxSec}s)`);
  }

  if (dryRun) {
    return { dryRun: true, mode, privacyLevel, sizeBytes: size, chunks: count, creator, caption };
  }

  const source_info = {
    source: "FILE_UPLOAD",
    video_size: size,
    chunk_size: chunkSize,
    total_chunk_count: count,
  };

  const initPath = mode === "inbox"
    ? "/post/publish/inbox/video/init/"
    : "/post/publish/video/init/";

  const body = mode === "inbox"
    ? { source_info }
    : {
        post_info: {
          title: caption,
          privacy_level: privacyLevel,
          disable_comment: disableComment,
          disable_duet: disableDuet,
          disable_stitch: disableStitch,
        },
        source_info,
      };

  const init = await api(initPath, token, body);
  const { publish_id, upload_url } = init.data;

  await uploadChunks(upload_url, videoPath, size, chunkSize, count);

  return { publishId: publish_id, mode, privacyLevel, sizeBytes: size, chunks: count, creator };
}

/** Poll until TikTok finishes processing, so failures surface here. */
export async function waitForPublish(publishId, { timeoutMs = 180_000, intervalMs = 5_000 } = {}) {
  const token = await getAccessToken();
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await fetchStatus(token, publishId);
    if (last.status === "PUBLISH_COMPLETE" || last.status === "SEND_TO_USER_INBOX") return last;
    if (last.status === "FAILED") {
      throw new Error(`TikTok publish failed: ${last.fail_reason || "unknown reason"}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { ...last, timedOut: true };
}
