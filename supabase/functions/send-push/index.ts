// Drift – Send Expo push notifications to specific users.
// POST { user_ids: string[], title: string, body: string, data?: object }
// Auth: Bearer token must match PUSH_SECRET env var.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PUSH_SECRET = Deno.env.get("PUSH_SECRET")!;
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const BATCH_SIZE = 100; // Expo API limit per request

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const auth = req.headers.get("authorization")?.replace("Bearer ", "");
    if (auth !== PUSH_SECRET) {
      return json({ error: "unauthorized" }, 401);
    }

    const { user_ids, title, body, data } = await req.json();

    if (!Array.isArray(user_ids) || !user_ids.length || !title || !body) {
      return json(
        { error: "missing user_ids (array), title, or body" },
        400,
      );
    }

    // Service-role client to read tokens for any user.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: tokens, error: tokErr } = await supabase
      .from("push_tokens")
      .select("expo_push_token")
      .in("user_id", user_ids);

    if (tokErr) {
      console.error("push_tokens query error:", tokErr.message);
      return json({ error: "failed to fetch tokens" }, 500);
    }

    if (!tokens || tokens.length === 0) {
      return json({ sent: 0, message: "no tokens found for given users" });
    }

    // Build Expo push messages.
    const messages = tokens.map((t: { expo_push_token: string }) => ({
      to: t.expo_push_token,
      sound: "default" as const,
      title,
      body,
      ...(data ? { data } : {}),
    }));

    // Send in batches of BATCH_SIZE.
    const results: unknown[] = [];
    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);
      const resp = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batch),
      });
      const respData = await resp.json();
      results.push(respData);
    }

    return json({ sent: messages.length, results });
  } catch (err) {
    console.error("send-push error:", err);
    return json({ error: String(err) }, 500);
  }
});
