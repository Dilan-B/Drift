/**
 * aiEvaluate.js
 * Server-only AI task evaluation. All OpenAI calls go through the
 * `evaluate-task` Supabase Edge Function — the API key never touches this
 * client. There is no client-side OpenAI fallback in any build configuration.
 *
 * Returns: { credits, xp, reasoning }  (integers + short string)
 * Throws on failure — caller decides whether to retry.
 */
import { supabase } from "./supabase";
import { cached, rateLimited } from "./apiGuards";

export async function evaluateTask({ title, mins, category }) {
  const key = `ai_eval_${String(title || "").trim().toLowerCase()}_${mins}_${category}`;
  return cached(key, 10 * 60_000, () => rateLimited("ai_evaluate", { limit: 10, windowMs: 60 * 60_000 }, async () => {
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

  // Paywall
  if (body?.error === "subscription_required" || status === 402) {
    const e = new Error(body?.message || "AI features require an active subscription.");
    e.code = "subscription_required";
    throw e;
  }

  // Success
  if (body && !body.error && typeof body.credits === "number") {
    const minReward = Math.max(1, Math.ceil(mins * 0.25));
    const maxReward = Math.max(1, Math.floor(mins * 0.5));
    const credits = Math.max(minReward, Math.min(Math.max(1, Math.round(body.credits)), maxReward));
    return {
      credits,
      xp:        Math.max(5, Math.round(body.xp || credits * 0.6 + 8)),
      reasoning: body.reasoning || "",
    };
  }

  // Handled error from the server
  if (body?.error) throw new Error(body.error);

  // Network / not-deployed / unknown — surface a generic error
  throw invokeErr || new Error("AI evaluation unavailable.");
  }));
}
