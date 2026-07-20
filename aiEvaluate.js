/**
 * aiEvaluate.js
 * Server-only AI task evaluation. All OpenAI calls go through the
 * `evaluate-task` Supabase Edge Function — the API key never touches this
 * client. There is no client-side OpenAI fallback in any build configuration.
 *
 * Returns: { credits, xp, category, reasoning }
 * `category` is classified by the model — the user no longer picks one.
 * Throws on failure — caller decides whether to retry.
 */
import { supabase } from "./supabase";
import { cached, rateLimited } from "./apiGuards";

const ALLOWED_CATEGORIES = ["work", "physical", "outdoor", "learning", "social", "life"];

export async function evaluateTask({ title, mins, category }) {
  // Category is no longer user input, so it must not vary the cache key —
  // the same title+duration always yields the same evaluation.
  const key = `ai_eval_${String(title || "").trim().toLowerCase()}_${mins}`;
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
    // Non-productive tasks are HARD-capped at 1/5 of the duration (e.g. 30 min
    // "eating" → 6 max). Productive tasks earn 1/4–1/2. Enforced here too so the
    // cap holds even if the server response is stale/bypassed.
    const nonProductive = body.productive === false;
    const minReward = nonProductive ? 1 : Math.max(1, Math.ceil(mins * 0.25));
    const maxReward = nonProductive
      ? Math.max(1, Math.floor(mins * 0.2))
      : Math.max(1, Math.floor(mins * 0.5));
    const credits = Math.max(minReward, Math.min(Math.max(1, Math.round(body.credits)), maxReward));
    const claimed = String(body.category || "").trim().toLowerCase();
    return {
      credits,
      xp:        Math.max(5, Math.round(body.xp || credits * 0.6 + 8)),
      // Mirror the server's whitelist so an older deploy (no category field)
      // can't produce an unknown chip on the client.
      category:  ALLOWED_CATEGORIES.includes(claimed) ? claimed : null,
      reasoning: body.reasoning || "",
    };
  }

  // Handled error from the server
  if (body?.error) throw new Error(body.error);

  // Network / not-deployed / unknown — surface a generic error
  throw invokeErr || new Error("AI evaluation unavailable.");
  }));
}
