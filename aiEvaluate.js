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

export async function evaluateTask({ title, mins, category }) {
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
    return {
      credits:   Math.max(1, Math.round(body.credits)),
      xp:        Math.max(5, Math.round(body.xp || body.credits * 0.6 + 8)),
      reasoning: body.reasoning || "",
    };
  }

  // Handled error from the server
  if (body?.error) throw new Error(body.error);

  // Network / not-deployed / unknown — surface a generic error
  throw invokeErr || new Error("AI evaluation unavailable.");
}
