// Drift – AI Task Verification Edge Function
// Proxies OpenAI calls so the API key never reaches the client.
// Rate limits: 5/hour and 20/day per authenticated user.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Limits ────────────────────────────────────────────────────
const MAX_PER_HOUR     = 5;
const MAX_PER_DAY      = 20;
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

// ── Main handler ──────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // ── 1. Authenticate ──────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    // Reject oversized requests early — protect from amplification attacks
    const lenHeader = parseInt(req.headers.get("content-length") || "0", 10);
    if (lenHeader && lenHeader > MAX_BODY_BYTES) return json({ error: "Body too large" }, 413);

    // ── 1b. Subscription check (cached + dev-bypass) ─────────
    let subActive: boolean | null = cachedSub(user.id);
    if (subActive === null) {
      // is_dev_user RPC may not exist on older schemas — treat failure as "not dev"
      const devPromise = supabase.rpc("is_dev_user", { uid: user.id })
        .then(r => r.data === true).catch(() => false);

      const profilePromise = supabase
        .from("profiles").select("sub_active, sub_expires").eq("id", user.id).maybeSingle()
        .then(r => r.data).catch(() => null);

      const [isDev, profile] = await Promise.all([devPromise, profilePromise]);
      subActive = isDev || (!!profile?.sub_active &&
        (!profile.sub_expires || new Date(profile.sub_expires) > new Date()));
      setCachedSub(user.id, subActive);
    }
    if (!subActive) {
      return json({ error: "subscription_required", message: "AI Check requires Pro. Tap profile → Upgrade." }, 402);
    }

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

    if ((hourCount ?? 0) >= MAX_PER_HOUR)
      return json({
        error: "rate_limit",
        message: `You can verify up to ${MAX_PER_HOUR} tasks per hour. Try again soon.`,
      }, 429);

    if ((dayCount ?? 0) >= MAX_PER_DAY)
      return json({
        error: "rate_limit",
        message: `Daily limit of ${MAX_PER_DAY} AI verifications reached. Resets at midnight.`,
      }, 429);

    // ── 3. Parse & validate input ────────────────────────────
    let body: { taskTitle?: string; durationMins?: number; proofText?: string; imageBase64?: string };
    try { body = await req.json(); }
    catch { return json({ error: "Invalid JSON body" }, 400); }

    const { taskTitle, durationMins, proofText, imageBase64 } = body;

    if (!taskTitle || typeof taskTitle !== "string" || taskTitle.length > 200)
      return json({ error: "Invalid task title" }, 400);

    if (!proofText && !imageBase64)
      return json({ error: "Proof text or image required" }, 400);

    const sanitizedProof = proofText
      ? proofText.slice(0, MAX_PROOF_CHARS).replace(/[<>]/g, "")
      : undefined;

    if (imageBase64 && imageBase64.length > MAX_IMAGE_BYTES)
      return json({ error: "Image too large (max ~375 KB)" }, 400);

    // ── 4. Build OpenAI request ───────────────────────────────
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      console.error("OPENAI_API_KEY secret not set");
      return json({ error: "Service misconfigured" }, 500);
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
        `Evaluate whether the user genuinely completed their task.\n\n` +
        `Task: "${taskTitle.replace(/"/g, "'")}"` +
        `\nTime claimed: ${durationMins ?? "?"} minutes` +
        (sanitizedProof ? `\nUser's explanation: "${sanitizedProof}"` : "\nNo written explanation.") +
        (imageBase64 ? "\nPhoto evidence provided (see image)." : "\nNo photo.") +
        `\n\nBe encouraging but honest. Reply ONLY with valid JSON (no markdown, no extra text):\n` +
        `{"verified": true or false, "confidence": "high" or "medium" or "low", "message": "1-2 sentence response"}`,
    });

    // ── 5. Call OpenAI ────────────────────────────────────────
    // Supabase Edge Functions kill us at 60s WallClockTime. Budget conservatively.
    const startedAt = Date.now();
    async function callOpenAI(timeoutMs: number) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openaiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: messageContent }],
            max_tokens: 200,
            temperature: 0.3,
          }),
          signal: controller.signal,
        });
      } finally { clearTimeout(timeout); }
    }

    let openaiResp: Response;
    try {
      openaiResp = await callOpenAI(28_000);
      // Retry on 5xx ONLY if we have time budget left (don't risk WallClockTime kill)
      if (openaiResp.status >= 500 && openaiResp.status < 600 && Date.now() - startedAt < 25_000) {
        await new Promise(r => setTimeout(r, 500));
        openaiResp = await callOpenAI(20_000);
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
      const errBody = await openaiResp.json().catch(() => ({}));
      const openAiMsg = errBody?.error?.message || `status ${openaiResp.status}`;
      console.error("OpenAI error:", openaiResp.status, JSON.stringify(errBody));
      return json({
        error: "ai_error",
        message: `AI rejected the request: ${openAiMsg}`,
        debug: { status: openaiResp.status, openai: errBody?.error?.code || null },
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
