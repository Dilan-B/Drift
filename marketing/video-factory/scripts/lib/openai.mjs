// Thin OpenAI wrapper shared by every stage. Centralised so model choice,
// retries and key handling live in one place rather than per-script.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Load marketing/video-factory/.env (gitignored) once, on import.
const envFile = join(ROOT, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export const KEYS = {
  openai: () => process.env.OPENAI_API_KEY || "",
  eleven: () => process.env.ELEVENLABS_API_KEY || "",
};

// Text/reasoning model for writing and judging. Vision model must be
// vision-capable — the QC gate sends rendered frames to it.
export const MODELS = {
  text: () => process.env.VF_MODEL_TEXT || "gpt-4.1-mini",
  vision: () => process.env.VF_MODEL_VISION || "gpt-4.1-mini",
  tts: () => process.env.VF_MODEL_TTS || "gpt-4o-mini-tts",
};

// USD per 1M tokens / per minute. Verified against OpenAI's published pricing
// on 2026-08-25 — these change, so re-check before trusting a forecast.
export const PRICES = {
  "gpt-4.1-mini": { in: 0.40, out: 1.60 },
  "gpt-4.1": { in: 2.00, out: 8.00 },
  "gpt-4o-mini": { in: 0.15, out: 0.60 },
  "gpt-4o-mini-tts": { in: 0.60, audioOut: 12.00 },
};

// Running tally for the current process, so a run can report what it cost.
const usage = [];

export function trackUsage(entry) {
  usage.push(entry);
}

export function usageReport() {
  let total = 0;
  const byModel = {};
  for (const u of usage) {
    const p = PRICES[u.model] || {};
    let cost = 0;
    if (u.minutes != null) cost = (p.perMinute ?? 0) * u.minutes;
    else {
      cost = ((u.in ?? 0) / 1e6) * (p.in ?? 0)
           + ((u.out ?? 0) / 1e6) * (p.out ?? p.audioOut ?? 0);
    }
    total += cost;
    byModel[u.model] = (byModel[u.model] ?? 0) + cost;
  }
  return { totalUsd: total, byModel, calls: usage.length };
}

export function requireOpenAI(what) {
  const k = KEYS.openai();
  if (!k) {
    throw new Error(
      `${what} needs OPENAI_API_KEY. Add it to marketing/video-factory/.env (gitignored).`
    );
  }
  return k;
}

async function withRetry(fn, { tries = 3, label = "request" } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Don't burn retries on a bad key or a malformed request.
      if (/\b(401|403|400)\b/.test(String(err.message))) throw err;
      // A 429 is either a transient rate limit (worth retrying) or an exhausted
      // billing quota (never worth retrying — it will not resolve in 6 seconds).
      if (/exceeded your current quota|insufficient_quota/i.test(String(err.message))) {
        throw new Error(
          "OpenAI quota exhausted — the key is valid but the account/project has no " +
          "available credit. Add billing at platform.openai.com/settings/organization/billing, " +
          "and check the project's own budget limit if you are using a sk-proj- key."
        );
      }
      const wait = 800 * 2 ** i;
      console.log(`[retry] ${label} failed (${err.message.slice(0, 120)}) — retrying in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

/** Chat completion. Set `json:true` to force a JSON object back. */
export async function chat({ system, user, json = false, model, images = [], temperature = 0.9 }) {
  const key = requireOpenAI("Script generation");
  const content = images.length
    ? [
        { type: "text", text: user },
        ...images.map((b64) => ({
          type: "image_url",
          image_url: { url: `data:image/png;base64,${b64}`, detail: "low" },
        })),
      ]
    : user;

  const body = {
    model: model || (images.length ? MODELS.vision() : MODELS.text()),
    temperature,
    messages: [
      { role: "system", content: system },
      { role: "user", content },
    ],
  };
  if (json) body.response_format = { type: "json_object" };

  return withRetry(async () => {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`OpenAI chat ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    trackUsage({
      model: body.model,
      in: data.usage?.prompt_tokens ?? 0,
      out: data.usage?.completion_tokens ?? 0,
    });
    const text = data.choices?.[0]?.message?.content ?? "";
    return json ? JSON.parse(text) : text;
  }, { label: "chat" });
}

export { writeFileSync };
