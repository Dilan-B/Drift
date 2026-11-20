// Shared OpenAI model default + request shaping for the edge functions that
// call /v1/chat/completions (evaluate-task, verify-task).
//
// Why this exists: gpt-4.1-nano was shut down by OpenAI on 2026-10-23 and every
// call started failing with 404 model_not_found, which verify-task surfaced as
// "Couldn't read that image". Its official replacement, gpt-5.6-luna, is a
// REASONING model, and reasoning models take a different request shape:
//   - `max_tokens` is rejected; the cap is `max_completion_tokens`, and it
//     also counts hidden reasoning tokens.
//   - non-default `temperature` is rejected.
//   - `reasoning_effort` defaults to "medium", which would spend the whole
//     small output budget (8 tokens for the pre-flight) on thinking and return
//     an empty reply. These calls are simple classification/description, so
//     reasoning is turned off with "none".
// Keeping the shape in one place means changing OPENAI_MODEL to either family
// keeps working without a code change.

/** Default for every call. Vision-capable, $0.20/$1.20 per 1M in/out. */
export const DEFAULT_MODEL = "gpt-5.6-luna";

/** gpt-5*, gpt-6*, o1/o3/o4… are reasoning models; gpt-4.x / gpt-4o are not. */
export function isReasoningModel(model: string): boolean {
  return /^(gpt-[5-9]|o\d)/i.test(model.trim());
}

/**
 * Builds the JSON body for a chat completion, adapted to the model family.
 * `temperature` is honoured only on non-reasoning models.
 */
export function chatBody(
  model: string,
  messages: unknown[],
  { maxTokens, temperature = 0 }: { maxTokens: number; temperature?: number },
): Record<string, unknown> {
  if (isReasoningModel(model)) {
    return {
      model,
      messages,
      max_completion_tokens: maxTokens,
      reasoning_effort: "none",
    };
  }
  return { model, messages, max_tokens: maxTokens, temperature };
}
