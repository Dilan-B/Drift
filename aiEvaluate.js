/**
 * aiEvaluate.js
 * Asks the AI to assign credit/XP value to a new task based on title + duration + category.
 * Tries Supabase Edge Function first, falls back to direct OpenAI call for dev.
 *
 * Returns: { credits, xp, reasoning }  (integers + short string)
 * Throws on failure — caller decides whether to retry or use a fallback.
 */
import { supabase } from "./supabase";

const buildPrompt = (title, mins, category) =>
  `You evaluate tasks for a productivity app called Drift. A user earns "credits" (1 credit = 1 minute of screen time) for completing tasks. ` +
  `Be fair but not generous — credits should roughly match the real effort and value of the task.\n\n` +
  `Guidelines:\n` +
  `- Trivial tasks (texting, browsing notifications): ~0.3-0.5 credits/min\n` +
  `- Light tasks (admin, errands, light reading): ~0.5-0.75 credits/min\n` +
  `- Focused tasks (work sessions, studying, meal prep): ~0.75-1.0 credits/min\n` +
  `- Hard tasks (deep work, intense workout, learning new skill): ~1.0-1.5 credits/min\n` +
  `- Be skeptical of vague tasks — give lower credits if unclear what work was done\n\n` +
  `Task: "${title}"\n` +
  `Estimated duration: ${mins} minutes\n` +
  `Category: ${category}\n\n` +
  `XP should be roughly: credits × 0.6 + 8 (round to integer)\n\n` +
  `Reply ONLY with this JSON (no markdown, no code fences, no extra text):\n` +
  `{"credits":<integer>,"xp":<integer>,"reasoning":"one short sentence explaining why"}`;

const stripFences = s =>
  (s || "").replace(/^```[\w]*\n?/m, "").replace(/```$/m, "").trim();

const parseResult = raw => {
  const content = stripFences(raw);
  const parsed  = JSON.parse(content);
  const credits = Math.max(1, Math.round(Number(parsed.credits) || 0));
  const xp      = Math.max(5, Math.round(Number(parsed.xp) || credits * 0.6 + 8));
  const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 200) : "";
  return { credits, xp, reasoning };
};

// ── Direct OpenAI call (dev fallback) ─────────────────────────
const callOpenAIDirect = async (title, mins, category) => {
  const key = (process.env.EXPO_PUBLIC_OPENAI_KEY || "")
    .trim().replace(/^["']|["']$/g, "");
  if (!key.startsWith("sk-"))
    throw new Error("EXPO_PUBLIC_OPENAI_KEY missing or malformed");

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: buildPrompt(title, mins, category) }],
      max_tokens: 150,
      temperature: 0.4,
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.message || `OpenAI error ${resp.status}`);
  }

  const data = await resp.json();
  return parseResult(data.choices?.[0]?.message?.content);
};

// ── Public API ─────────────────────────────────────────────────
// `allowDirect` only used in dev when explicitly enabled — never in prod builds.
export async function evaluateTask({ title, mins, category }, { allowDirect = false } = {}) {
  // 1. Try the edge function (subscription enforced server-side)
  let body = null;
  let status = 0;
  let invokeErr = null;
  try {
    const res = await supabase.functions.invoke("evaluate-task", {
      body: { title, mins, category },
    });
    body = res.data;
    invokeErr = res.error;
    status = res.error?.context?.status || (body && !res.error ? 200 : 0);
    if (res.error?.context?.response) {
      try { body = await res.error.context.response.json(); } catch {}
    }
  } catch (e) {
    invokeErr = e;
  }

  // Paywall — never silently bypass via direct call
  if (body?.error === "subscription_required" || status === 402) {
    const e = new Error(body?.message || "AI features require an active subscription.");
    e.code = "subscription_required";
    throw e;
  }

  // Success
  if (body && !body.error && typeof body.credits === "number") {
    return {
      credits:   Math.max(1, Math.round(body.credits)),
      xp:        Math.max(5, Math.round(body.xp || body.credits * 0.6 + 8)),
      reasoning: body.reasoning || "",
    };
  }

  // Rate limit or other handled error
  if (body?.error) {
    if (!allowDirect) throw new Error(body.error);
  }

  // Edge function truly unreachable (not deployed, network, etc.) → direct fallback only in dev
  if (!allowDirect) {
    throw invokeErr || new Error("AI evaluation unavailable.");
  }

  return await callOpenAIDirect(title, mins, category);
}
