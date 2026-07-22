// Drift – AI Task Verification Edge Function
// Proxies OpenAI calls so the API key never reaches the client.
// Rate limits: 5/hour and 20/day per authenticated user.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Limits ────────────────────────────────────────────────────
const MAX_PER_HOUR     = 5;
const MAX_PER_DAY      = 20;

// ── Model selection ──────────────────────────────────────────
// Both are env-overridable (`supabase secrets set OPENAI_MODEL=...`) so the
// model can change without a code deploy.
//
// MODEL_VISION handles the real proof check, which may include a photo — it
// MUST be a vision-capable model or photo verification breaks outright.
// MODEL_TEXT handles the one-word verifiability pre-flight, which never sends
// an image, so it can be a cheaper text-only model if one is available.
//
// Default for both: gpt-4.1-nano — $0.10/$0.40 per 1M in/out (vs gpt-4o-mini's
// $0.15/$0.60) and it accepts image input.
const MODEL_VISION = Deno.env.get("OPENAI_MODEL") || "gpt-4.1-nano";
const MODEL_TEXT   = Deno.env.get("OPENAI_MODEL_TEXT") || MODEL_VISION;
const MAX_PROOF_CHARS  = 1000;
const MAX_IMAGE_BYTES  = 450_000; // ~330 KB original after shrink → safer for OpenAI
const MAX_BODY_BYTES   = 800_000; // hard ceiling on request body

// In-memory subscription cache (per cold-start instance)
// TTL short enough that revocations propagate, long enough to skip Postgres
// on hot paths.
const SUB_TTL_MS = 60_000;
const subCache = new Map<string, { active: boolean; ts: number }>();
function cachedSub(uid: string) {
  const hit = subCache.get(uid);
  return hit && Date.now() - hit.ts < SUB_TTL_MS ? hit.active : null;
}
function setCachedSub(uid: string, active: boolean) {
  // Bound cache size to keep memory in check during big spikes
  if (subCache.size > 5000) subCache.clear();
  subCache.set(uid, { active, ts: Date.now() });
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

function isEmailVerified(user: { email_confirmed_at?: string | null; confirmed_at?: string | null } | null): boolean {
  return !!(user?.email_confirmed_at || user?.confirmed_at);
}

/**
 * Reject with a logged reason.
 *
 * Every rejection used to `return json(...)` silently, so a run that was
 * refused at the door produced logs containing nothing but boot/listening/
 * shutdown — indistinguishable from a run that never happened. That made a
 * real user-reported failure impossible to diagnose after the fact.
 *
 * Logs the reason code and status only. Never the task title, proof text,
 * image, token, or user id — a rejection reason is not worth leaking content.
 */
function reject(reason: string, status: number, body?: Record<string, unknown>) {
  console.error(`reject: ${reason} (${status})`);
  return json({ error: reason, ...body }, status);
}

// ── Main handler ──────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Wall-clock budget for everything this invocation does. Supabase kills the
  // function at 60s; we aim to have replied well before that, because a kill
  // gives the client no HTTP status at all.
  const REQUEST_STARTED_AT = Date.now();
  const REQUEST_DEADLINE_MS = 45_000;

  try {
    // ── 1. Authenticate ──────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return reject("Unauthorized", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return reject("Unauthorized", 401);
    if (!isEmailVerified(user)) return reject("email_not_verified", 403);

    // Reject oversized requests early — protect from amplification attacks
    const lenHeader = parseInt(req.headers.get("content-length") || "0", 10);
    if (lenHeader && lenHeader > MAX_BODY_BYTES) return reject("body_too_large", 413);

    // ── 1b. Subscription check (cached + dev-bypass) ─────────
    let subActive: boolean | null = cachedSub(user.id);
    if (subActive === null) {
      // is_dev_user RPC may not exist on older schemas — treat failure as "not dev"
      const devPromise = supabase.rpc("is_dev_user", { uid: user.id })
        .then(r => r.data === true).catch(() => false);

      const profilePromise = supabase
        .from("profiles").select("sub_active, sub_expires, beta_unlocked_at").eq("id", user.id).maybeSingle()
        .then(r => r.data).catch(() => null);

      const [isDev, profile] = await Promise.all([devPromise, profilePromise]);
      const subOk  = !!profile?.sub_active &&
        (!profile.sub_expires || new Date(profile.sub_expires) > new Date());
      const betaOk = !!profile?.beta_unlocked_at;
      subActive = isDev || subOk || betaOk;
      setCachedSub(user.id, subActive);
    }
    // TEMPORARY: Pro is free for everyone until Apple IAP is re-enabled
    // post-approval. To restore paid gating, uncomment the block below.
    // if (!subActive) {
    //   return json({ error: "subscription_required", message: "AI Check requires Pro. Tap profile → Upgrade." }, 402);
    // }

    // ── 2. Rate limiting ─────────────────────────────────────
    const now      = new Date();
    const hourAgo  = new Date(now.getTime() - 3_600_000).toISOString();
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);

    const [{ count: hourCount }, { count: dayCount }] = await Promise.all([
      supabase
        .from("ai_check_usage")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gte("created_at", hourAgo),
      supabase
        .from("ai_check_usage")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gte("created_at", midnight.toISOString()),
    ]);

    // These two are the most likely cause of a "couldn't connect" report: the
    // old client showed any unparseable error body as a connection failure, so
    // a plain 429 looked exactly like being offline. Log them so the next
    // occurrence is unambiguous in the dashboard.
    if ((hourCount ?? 0) >= MAX_PER_HOUR)
      return reject("rate_limit", 429, {
        message: `You can verify up to ${MAX_PER_HOUR} tasks per hour. Try again soon.`,
      });

    if ((dayCount ?? 0) >= MAX_PER_DAY)
      return reject("rate_limit", 429, {
        message: `Daily limit of ${MAX_PER_DAY} AI verifications reached. Resets at midnight.`,
      });

    // ── 3. Parse & validate input ────────────────────────────
    let body: { taskTitle?: string; durationMins?: number; proofText?: string; imageBase64?: string };
    try { body = await req.json(); }
    catch { return reject("invalid_json", 400); }

    const { taskTitle, durationMins, proofText, imageBase64 } = body;

    if (!taskTitle || typeof taskTitle !== "string" || taskTitle.length > 200)
      return reject("invalid_task_title", 400);

    if (!proofText && !imageBase64)
      return reject("proof_required", 400);

    const sanitizedProof = proofText
      ? proofText.slice(0, MAX_PROOF_CHARS).replace(/[<>]/g, "")
      : undefined;

    if (imageBase64 && imageBase64.length > MAX_IMAGE_BYTES)
      return reject("image_too_large", 400);

    // ── 4. Build OpenAI request ───────────────────────────────
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      console.error("OPENAI_API_KEY secret not set");
      return reject("service_misconfigured", 500);
    }

    // fetch + hard timeout. Supabase kills the whole invocation at 60s
    // WallClockTime, so every outbound call needs its own budget — a hung
    // request would otherwise burn the function's entire lifetime and return
    // nothing the client can interpret.
    async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(url, { ...init, signal: controller.signal });
      } finally { clearTimeout(timer); }
    }

    // ── 4a. Verifiability pre-flight ──────────────────────────
    // Some tasks have no plausible proof. "Speak with my teacher", "call mum",
    // "think through the pitch" leave nothing to photograph and nothing a
    // photo could contradict, so running them through image verification just
    // produces a coin-flip rejection the user can't do anything about.
    //
    // For those, we skip verification entirely and accept. This is deliberately
    // server-side and invisible: exposing it as a client flag would let anyone
    // mark their own tasks unverifiable and auto-pass everything.
    //
    // Fails OPEN toward normal verification — if this classification errors or
    // returns junk we fall through to the real check rather than auto-accepting.
    async function isHardToVerify(): Promise<boolean> {
      try {
        const r = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: MODEL_TEXT,
            max_tokens: 10,
            temperature: 0,
            messages: [{
              role: "user",
              content:
                `A user must prove they completed a task using one photo and/or a short written note.\n` +
                `Decide whether that task can plausibly be evidenced this way.\n` +
                `Answer "verifiable" if there is a physical trace, location, object, screen, or bodily state ` +
                `a photo could plausibly show (gym workout, dishes, reading, a run, cooking, cleaning).\n` +
                `Answer "unverifiable" if completion is private, conversational, or purely mental, leaving ` +
                `nothing a photo could show or contradict (speaking with someone, phoning a relative, ` +
                `thinking, planning in your head, praying, meditating without a setup).\n` +
                `Task: "${taskTitle.replace(/"/g, "'")}"\n` +
                `Reply with exactly one word: verifiable or unverifiable.`,
            }],
          }),
        }, 8_000);
        if (!r.ok) return false;
        const d = await r.json();
        const word = String(d.choices?.[0]?.message?.content || "").trim().toLowerCase();
        return word.startsWith("unverifiable");
      } catch {
        return false;
      }
    }

    if (await isHardToVerify()) {
      // Log the bypass so the rate-limit ledger still reflects the attempt.
      supabase.from("ai_check_usage").insert({ user_id: user.id }).then(() => {}, () => {});
      return json({
        verified: true,
        confidence: "medium",
        bypassed: true,
        message: "This one's hard to capture in a photo, so we'll take your word for it. Nice work.",
      });
    }

    const messageContent: Array<{ type: string; [k: string]: unknown }> = [];

    if (imageBase64) {
      messageContent.push({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: "low" },
      });
    }

    messageContent.push({
      type: "text",
      text:
        `You are an accountability coach for a productivity app called Drift. ` +
        `Evaluate whether the user's submitted proof plausibly shows the task is complete.\n` +
        `Do not judge or penalize based on how long ago the task/challenge was created, ` +
        `how long the user took to submit proof, missing timestamps, or whether the elapsed time seems too long. ` +
        `Only evaluate the content of the task and the submitted proof.\n` +
        `Do NOT rely solely on a photo. A clear, specific written explanation is valid proof on its own: if the user describes ` +
        `what they did in convincing, task-relevant detail — and, when there is no photo, gives a plausible reason a photo isn't ` +
        `available or simply describes completion credibly — verify the task on the strength of that description alone. ` +
        `Be lenient and realistic about the limits of single-photo evidence: the user can only submit one picture right now, ` +
        `so the photo usually cannot prove every rep, minute, or before/during/after step. Verify the task when the image provides plausible, ` +
        `task-relevant evidence of participation or completion, even if it is not mathematically conclusive. ` +
        `For physical or repetition-based tasks, accept reasonable visual proof such as the user in the relevant exercise position, ` +
        `workout context, sweat, flushed/tired facial expression, or other after-the-fact body/environment clues. ` +
        `For object or consumption tasks, look carefully for small visual details such as residue, stains, wetness, crumbs, changed object state, ` +
        `empty containers, disturbed surfaces, or other signs that the task likely occurred. ` +
        `Do not reject just because the photo cannot prove the full sequence; only reject when the evidence is unrelated, clearly contradictory, ` +
        `or far too vague to connect to the task.\n\n` +
        `Task: "${taskTitle.replace(/"/g, "'")}"` +
        (durationMins ? `\nEstimated duration: ${durationMins} minutes (context only, not a deadline)` : "") +
        (sanitizedProof ? `\nUser's explanation: "${sanitizedProof}"` : "\nNo written explanation.") +
        (imageBase64 ? "\nPhoto evidence provided (see image)." : "\nNo photo — judge on the written explanation, which is sufficient when specific and credible.") +
        `\n\nExamples: an empty mug can verify a drink/chug-coffee challenge when it shows plausible coffee evidence, ` +
        `such as brown residue, ring marks, stains, wetness, or leftover drops. A photo of a user in push-up position, or visibly tired right after, ` +
        `can verify a 20 push-ups challenge when it plausibly matches the task context. Do not reject these merely because a single photo ` +
        `cannot mathematically prove the user personally completed every rep.` +
        `\n\nBe encouraging but honest. Reply ONLY with valid JSON (no markdown, no extra text):\n` +
        `{"verified": true or false, "confidence": "high" or "medium" or "low", "message": "1-2 sentence response"}`,
    });

    // ── 5. Call OpenAI ────────────────────────────────────────
    // Supabase Edge Functions kill us at 60s WallClockTime. Budget against a
    // deadline measured from when the REQUEST started, not from here — the
    // verifiability pre-flight above has already spent some of it, and the old
    // fixed 28s+20s pair could overrun once anything ran before it.
    const startedAt = Date.now();
    async function callOpenAI(timeoutMs: number) {
      return await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL_VISION,
          messages: [{ role: "user", content: messageContent }],
          max_tokens: 200,
          temperature: 0.3,
        }),
      }, timeoutMs);
    }

    let openaiResp: Response;
    try {
      // Leave ~6s of headroom under the 60s kill for reading the body and
      // replying, so a slow OpenAI turns into a clean 503 rather than the
      // platform killing us mid-flight (which reaches the client as an opaque
      // "failed to send a request" — indistinguishable from being offline).
      const budgetLeft = () => REQUEST_DEADLINE_MS - (Date.now() - REQUEST_STARTED_AT);
      openaiResp = await callOpenAI(Math.max(5_000, Math.min(28_000, budgetLeft())));
      // Retry on 5xx ONLY if enough budget remains for a second full attempt.
      if (openaiResp.status >= 500 && openaiResp.status < 600 && budgetLeft() > 12_000) {
        await new Promise(r => setTimeout(r, 500));
        openaiResp = await callOpenAI(Math.max(5_000, Math.min(20_000, budgetLeft())));
      }
    } catch (e: any) {
      const tag = e?.name === "AbortError" ? "timeout" : (e?.message || "unknown");
      console.error("OpenAI request failed:", tag);
      return json({
        error: "ai_unreachable",
        message: tag === "timeout"
          ? "AI took too long. Try a smaller photo or text-only proof."
          : "AI service didn't respond. Try again."
      }, 503);
    }

    if (!openaiResp.ok) {
      // Log only the bare minimum server-side. Never log the full errBody —
      // OpenAI error responses can include partial prompt content / request
      // metadata that might mirror user input.
      const errBody = await openaiResp.json().catch(() => ({}));
      console.error("OpenAI error:", openaiResp.status, errBody?.error?.type || "unknown_type", errBody?.error?.code || "no_code");
      return json({
        error: "ai_error",
        message: "The AI service had trouble with this request. Please try again.",
      }, 502);
    }

    const openaiData = await openaiResp.json();
    const rawText    = openaiData.choices?.[0]?.message?.content ?? "{}";

    let result: { verified: boolean; confidence: string; message: string };
    try {
      result = JSON.parse(rawText);
      if (typeof result.verified !== "boolean") throw new Error("bad shape");
    } catch {
      const verified = rawText.toLowerCase().includes('"verified":true') ||
        rawText.toLowerCase().includes('"verified": true');
      result = { verified, confidence: "low", message: rawText.slice(0, 150) };
    }

    // ── 6. Log usage (non-blocking) ───────────────────────────
    supabase.from("ai_check_usage").insert({ user_id: user.id }).then(
      () => {}, err => console.error("Usage log error:", err)
    );

    return json(result);
  } catch (err) {
    console.error("Unhandled error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
