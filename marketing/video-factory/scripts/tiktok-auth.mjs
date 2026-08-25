#!/usr/bin/env node
// One-time TikTok authorisation. Run this once per account:
//
//   node scripts/tiktok-auth.mjs
//
// It opens TikTok's consent screen, catches the redirect on localhost, swaps
// the code for tokens and writes them to content/state/tiktok-tokens.json
// (gitignored). After that the pipeline refreshes them on its own — refresh
// tokens are valid for 365 days.
//
// Prerequisites in the TikTok developer portal (developers.tiktok.com):
//   1. An app with the "Content Posting API" product added.
//   2. Scopes requested: video.publish, video.upload, user.info.basic
//      Ask for ALL of them now — adding a scope later means another review round.
//   3. The redirect URI below registered EXACTLY as written.

import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { ROOT } from "./lib/openai.mjs";

const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
const REDIRECT_URI = process.env.TIKTOK_REDIRECT_URI || "http://localhost:5178/callback";
const SCOPES = process.env.TIKTOK_SCOPES || "user.info.basic,video.publish,video.upload";
const TOKEN_PATH = join(ROOT, "content", "state", "tiktok-tokens.json");

if (!CLIENT_KEY || !CLIENT_SECRET) {
  console.error(
    "Missing TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET.\n" +
    "Add them to marketing/video-factory/.env (gitignored), then rerun."
  );
  process.exit(1);
}

const state = randomBytes(16).toString("hex");
const port = Number(new URL(REDIRECT_URI).port || 80);

const authUrl =
  `https://www.tiktok.com/v2/auth/authorize/?client_key=${encodeURIComponent(CLIENT_KEY)}` +
  `&scope=${encodeURIComponent(SCOPES)}&response_type=code` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${state}`;

const reply = (res, code, msg) => {
  res.writeHead(code, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<html><body style="font-family:system-ui;padding:48px"><h2>${msg}</h2>
    <p>You can close this tab and return to the terminal.</p></body></html>`);
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname !== new URL(REDIRECT_URI).pathname) return reply(res, 404, "Not found");

  const err = url.searchParams.get("error");
  if (err) {
    reply(res, 400, `Authorisation refused: ${err}`);
    console.error(`\nTikTok returned an error: ${err} — ${url.searchParams.get("error_description") || ""}`);
    server.close();
    process.exit(1);
  }

  if (url.searchParams.get("state") !== state) {
    reply(res, 400, "State mismatch — aborted.");
    console.error("\nState parameter did not match. Aborting rather than trusting the response.");
    server.close();
    process.exit(1);
  }

  const code = url.searchParams.get("code");
  try {
    const body = new URLSearchParams({
      client_key: CLIENT_KEY,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
    });
    const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok || data.error) {
      throw new Error(data.error_description || JSON.stringify(data));
    }

    mkdirSync(dirname(TOKEN_PATH), { recursive: true });
    writeFileSync(TOKEN_PATH, JSON.stringify({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      open_id: data.open_id,
      scope: data.scope,
      expires_at: Date.now() + (data.expires_in ?? 86400) * 1000,
      authorised_at: new Date().toISOString(),
    }, null, 2));

    reply(res, 200, "Drift is now authorised to post.");
    console.log(`\nTokens written to ${TOKEN_PATH}`);
    console.log(`Granted scopes: ${data.scope}`);
    if (!String(data.scope).includes("video.publish")) {
      console.log(
        `\nNote: video.publish was NOT granted, so direct posting is unavailable.\n` +
        `Set TIKTOK_POST_MODE=inbox to send videos to your TikTok drafts instead.`
      );
    }
    server.close();
    process.exit(0);
  } catch (e) {
    reply(res, 500, "Token exchange failed — see terminal.");
    console.error(`\nToken exchange failed: ${e.message}`);
    server.close();
    process.exit(1);
  }
});

server.listen(port, () => {
  if (existsSync(TOKEN_PATH)) {
    const t = JSON.parse(readFileSync(TOKEN_PATH, "utf8"));
    console.log(`Existing tokens found (authorised ${t.authorised_at}). Re-authorising will replace them.\n`);
  }
  console.log(`Listening on ${REDIRECT_URI}`);
  console.log(`\nIf a browser does not open, visit:\n\n${authUrl}\n`);
  execFile("open", [authUrl], () => {});
});
