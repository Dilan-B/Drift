#!/usr/bin/env node
// One-time TikTok authorisation.
//
//   node scripts/tiktok-auth.mjs
//
// Opens TikTok's consent screen, you paste the code back, and tokens land in
// content/state/tiktok-tokens.json (gitignored). After that the pipeline
// refreshes them itself — refresh tokens last 365 days.
//
// Why paste-the-code rather than a localhost callback: TikTok rejects any
// redirect URI that is not https, and rejects localhost even over https. The
// redirect therefore points at a static page on the verified GitHub Pages site
// (docs/tiktok-callback.html), which displays the code for copying. That page
// never touches the client secret — the token exchange happens here.

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { ROOT } from "./lib/openai.mjs";

const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
const REDIRECT_URI = process.env.TIKTOK_REDIRECT_URI || "https://dilan-b.github.io/Drift/tiktok-callback.html";
const SCOPES = process.env.TIKTOK_SCOPES || "user.info.basic,video.publish,video.upload";
const TOKEN_PATH = join(ROOT, "content", "state", "tiktok-tokens.json");

if (!CLIENT_KEY || !CLIENT_SECRET) {
  console.error(
    "Missing TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET.\n" +
    "Add them to marketing/video-factory/.env (gitignored), then rerun.\n\n" +
    "Use the SANDBOX credentials while the app is unapproved — the sandbox has\n" +
    "its own key and secret, separate from Production."
  );
  process.exit(1);
}

if (existsSync(TOKEN_PATH)) {
  const t = JSON.parse(readFileSync(TOKEN_PATH, "utf8"));
  console.log(`Existing tokens found (authorised ${t.authorised_at}). Continuing will replace them.\n`);
}

const state = randomBytes(16).toString("hex");

// TikTok requires PKCE on this flow — without a code_challenge the authorize
// call fails with "Something went wrong ... code_challenge".
//
// Note it deviates from RFC 7636: the challenge is the HEX digest of the
// SHA-256 hash, not base64url. Sending the standard base64url form is rejected.
const codeVerifier = randomBytes(48).toString("base64url").slice(0, 64);
const codeChallenge = createHash("sha256").update(codeVerifier).digest("hex");

const authUrl =
  `https://www.tiktok.com/v2/auth/authorize/?client_key=${encodeURIComponent(CLIENT_KEY)}` +
  `&scope=${encodeURIComponent(SCOPES)}&response_type=code` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${state}` +
  `&code_challenge=${codeChallenge}&code_challenge_method=S256`;

console.log("1. Open this URL and authorise the Drift TikTok account:\n");
console.log(`   ${authUrl}\n`);
console.log(`2. You'll land on ${REDIRECT_URI}`);
console.log("   which shows a code. Copy it.\n");
execFile("open", [authUrl], () => {});

const rl = createInterface({ input: stdin, output: stdout });
const code = (await rl.question("3. Paste the code here: ")).trim();
const returnedState = (await rl.question(`   Paste the state shown on the page (or press enter to skip): `)).trim();
rl.close();

if (!code) {
  console.error("\nNo code entered — aborting.");
  process.exit(1);
}
if (returnedState && returnedState !== state) {
  console.error("\nState mismatch. Aborting rather than trusting this response — start again.");
  process.exit(1);
}

try {
  const body = new URLSearchParams({
    client_key: CLIENT_KEY,
    client_secret: CLIENT_SECRET,
    // TikTok URL-decodes the code once; a pasted value may still be encoded.
    code: decodeURIComponent(code),
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier,
  });
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error_description || JSON.stringify(data));

  mkdirSync(dirname(TOKEN_PATH), { recursive: true });
  writeFileSync(TOKEN_PATH, JSON.stringify({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    open_id: data.open_id,
    scope: data.scope,
    expires_at: Date.now() + (data.expires_in ?? 86400) * 1000,
    authorised_at: new Date().toISOString(),
  }, null, 2));

  console.log(`\nTokens written to ${TOKEN_PATH}`);
  console.log(`Granted scopes: ${data.scope}`);
  if (!String(data.scope).includes("video.publish")) {
    console.log(
      `\nNote: video.publish was NOT granted, so direct posting is unavailable.\n` +
      `Set TIKTOK_POST_MODE=inbox to send videos to your TikTok drafts instead.`
    );
  }
} catch (e) {
  console.error(`\nToken exchange failed: ${e.message}`);
  console.error("Codes are single-use and expire fast — if you waited a while, just run this again.");
  process.exit(1);
}
