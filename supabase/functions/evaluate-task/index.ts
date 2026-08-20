// Drift – AI Task Credit Evaluator
// Returns AI-assigned credits + xp for a new task. Key stays on the server.
// Rate-limited per user: 30/hour, 200/day.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_PER_HOUR = 30;
const MAX_PER_DAY  = 200;

// Model is configurable so it can be changed with `supabase secrets set`
// instead of a code deploy. Default is the cheapest model that handles this
// job: gpt-4.1-nano ($0.10/$0.40 per 1M in/out) vs gpt-4o-mini ($0.15/$0.60).
// This call is text-only, so vision support isn't required here.
const MODEL = Deno.env.get("OPENAI_MODEL_TEXT") || Deno.env.get("OPENAI_MODEL") || "gpt-4.1-nano";

// Per-instance subscription cache
const SUB_TTL_MS = 60_000;
const subCache = new Map<string, { active: boolean; ts: number }>();
function cachedSub(uid: string) {
  const hit = subCache.get(uid);
  return hit && Date.now() - hit.ts < SUB_TTL_MS ? hit.active : null;
}
function setCachedSub(uid: string, active: boolean) {
  if (subCache.size > 5000) subCache.clear();
  subCache.set(uid, { active, ts: Date.now() });
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });

function isEmailVerified(user: { email_confirmed_at?: string | null; confirmed_at?: string | null } | null): boolean {
  return !!(user?.email_confirmed_at || user?.confirmed_at);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);
    if (!isEmailVerified(user)) return json({ error: "email_not_verified" }, 403);

    // Subscription gate (cached + dev-bypass; graceful fallback if RPC missing)
    let subActive: boolean | null = cachedSub(user.id);
    if (subActive === null) {
      // is_pro() is the single definition of entitlement (schema_v9): an active
      // subscription, a manual grant, a beta unlock, OR being a child inside a
      // parent's paid seat count. Hand-rolling that OR in each edge function is
      // how they drifted apart before — and none of them knew about children.
      const proPromise = supabase.rpc("is_pro", { p_uid: user.id })
        .then(r => r.data === true).catch(() => null);
      const devPromise = supabase.rpc("is_dev_user", { uid: user.id })
        .then(r => r.data === true).catch(() => false);
      const [isPro, isDev] = await Promise.all([proPromise, devPromise]);

      if (isPro === null) {
        // RPC missing or errored: read the columns directly rather than denying.
        // A broken helper must never lock out paying users. Children aren't
        // covered on this path, which is why it is only a fallback.
        const profile = await supabase
          .from("profiles").select("sub_active, sub_expires, beta_unlocked_at")
          .eq("id", user.id).maybeSingle().then(r => r.data).catch(() => null);
        const subOk = !!profile?.sub_active &&
          (!profile.sub_expires || new Date(profile.sub_expires) > new Date());
        subActive = isDev || subOk || !!profile?.beta_unlocked_at;
      } else {
        subActive = isDev || isPro;
      }
      setCachedSub(user.id, subActive);
    }
    // TEMPORARY: Pro is free for everyone until Apple IAP is re-enabled
    // post-approval. To restore paid gating, uncomment the line below.
    // if (!subActive) return json({ error: "subscription_required" }, 402);

    // Rate limiting (shared ai_check_usage table is fine here too)
    const hourAgo  = new Date(Date.now() - 3_600_000).toISOString();
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);

    const [{ count: hourCount }, { count: dayCount }] = await Promise.all([
      supabase.from("ai_check_usage").select("*", { count: "exact", head: true })
        .eq("user_id", user.id).gte("created_at", hourAgo),
      supabase.from("ai_check_usage").select("*", { count: "exact", head: true })
        .eq("user_id", user.id).gte("created_at", midnight.toISOString()),
    ]);
    if ((hourCount ?? 0) >= MAX_PER_HOUR)
      return json({ error: "rate_limit", message: "Hourly limit reached." }, 429);
    if ((dayCount ?? 0) >= MAX_PER_DAY)
      return json({ error: "rate_limit", message: "Daily limit reached." }, 429);

    const body = await req.json().catch(() => ({}));
    const title    = String(body.title || "").slice(0, 200);
    const mins     = Math.max(1, Math.min(720, Number(body.mins) || 30));
    // `category` is now CLASSIFIED BY THE MODEL, not chosen by the user. Any
    // value the client sends is only a provisional hint we ignore in the
    // prompt — the server's answer is authoritative.
    if (!title) return json({ error: "Title required" }, 400);

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) return json({ error: "Service misconfigured" }, 500);

    const prompt =
      `You evaluate tasks for a productivity app called Drift. Users earn screen-time credits for time spent. ` +
      `Be fair but not generous — credits should match real effort.\n\n` +
      `FIRST decide "productive": true only if the task is DIRECTLY productive or self-improving ` +
      `(work, study, exercise, chores, skill-building, errands). Set it false for maintenance/leisure/consumption ` +
      `(eating, resting, watching, browsing, grooming, casual socializing).\n\n` +
      `HARD RULE: if productive is false, credits MUST NOT exceed 1/5 of the duration (${Math.floor(mins * 0.2)} max). ` +
      `Example: "eating food" for 30 min → 6 credits max. Never exceed this cap for non-productive tasks.\n\n` +
      `For productive tasks:\n` +
      `- Trivial: ~0.3-0.5 cr/min\n` +
      `- Light: ~0.5-0.75 cr/min\n` +
      `- Focused: ~0.75-1.0 cr/min\n` +
      `- Hard: ~1.0-1.5 cr/min\n\n` +
      `HARD RULE: credits MUST NEVER exceed 60, no matter how long or demanding ` +
      `the task is. A task of 3 hours or more earns at most 60.\n\n` +
      `ALSO classify the task into exactly one category, chosen from this list ` +
      `(use the id, lowercase): work (job, meetings, admin), physical (exercise, ` +
      `sport, gym), outdoor (walking, hiking, gardening, being outside), ` +
      `learning (study, reading, practising a skill), social (friends, family, ` +
      `meals with others), life (chores, errands, cooking, self-care, anything ` +
      `else). If two fit, pick the more specific one; use "life" only as a ` +
      `fallback.\n\n` +
      `Task: "${title.replace(/"/g, "'")}"\n` +
      `Duration: ${mins} min\n\n` +
      `XP ≈ credits × 0.6 + 8 (round to integer)\n\n` +
      `Reply ONLY this JSON (no markdown):\n` +
      `{"productive":<bool>,"credits":<int>,"xp":<int>,"category":"<one of: work|physical|outdoor|learning|social|life>","reasoning":"one short sentence"}`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 150, temperature: 0.4,
      }),
    });

    if (!resp.ok) {
      const e = await resp.json().catch(() => ({}));
      // Log only error type/code — never the full body (may include user input)
      console.error("OpenAI:", resp.status, e?.error?.type || "unknown_type", e?.error?.code || "no_code");
      return json({ error: "AI temporarily unavailable" }, 502);
    }

    const data = await resp.json();
    const raw  = data.choices?.[0]?.message?.content || "{}";
    const content = raw.replace(/^```[\w]*\n?/m, "").replace(/```$/m, "").trim();

    let result: { productive?: boolean; credits: number; xp: number; category?: string; reasoning: string };
    try { result = JSON.parse(content); }
    catch { return json({ error: "AI returned malformed response" }, 502); }

    // Constrain the model's category to the app's fixed set — a hallucinated
    // value would render as an unknown chip on the client.
    const ALLOWED_CATEGORIES = ["work", "physical", "outdoor", "learning", "social", "life"];
    const claimed = String(result.category || "").trim().toLowerCase();
    result.category = ALLOWED_CATEGORIES.includes(claimed) ? claimed : "life";

    // Server-authoritative hard cap: non-productive tasks can never earn more than
    // 1/5 of their duration, regardless of what the model returned.
    if (result.productive === false) {
      const cap = Math.max(1, Math.floor(mins * 0.2));
      if (result.credits > cap) {
        result.credits = cap;
        result.xp = Math.round(cap * 0.6 + 8);
      }
    }

    // Absolute ceiling: no single task is worth more than an hour of screen
    // time, however long or well-graded it is. A 3h+ task lands exactly here.
    const MAX_REWARD_MINUTES = 60;
    if (result.credits > MAX_REWARD_MINUTES) {
      result.credits = MAX_REWARD_MINUTES;
      result.xp = Math.round(MAX_REWARD_MINUTES * 0.6 + 8);
    }

    supabase.from("ai_check_usage").insert({ user_id: user.id }).then(() => {}, () => {});
    return json(result);
  } catch (err) {
    console.error("evaluate-task error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
