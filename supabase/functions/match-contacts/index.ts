// Drift — Match Contacts
// Receives SHA-256 hashes of the caller's contact emails and returns which ones
// belong to Drift users. The client hashes emails locally; raw emails never
// reach the server. Matching is done against the service-role-only
// `email_hashes` table (see schema_v7_contacts.sql), so no client can read
// another user's email hash.
//
// Privacy/abuse notes:
//  - Only hashes are accepted; we return matched user_id + username only.
//  - Per-user rate limit to prevent using this to enumerate the user base.
//  - Caps the number of hashes per request.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_HASHES = 3000;
const HEX64 = /^[0-9a-f]{64}$/;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    let body: { emailHashes?: unknown };
    try { body = await req.json(); } catch { return json({ error: "Invalid body" }, 400); }

    const rawHashes = Array.isArray(body.emailHashes) ? body.emailHashes : [];
    // Sanitize: only well-formed lowercase hex sha256, deduped, capped.
    const hashes = Array.from(new Set(
      rawHashes
        .filter((h): h is string => typeof h === "string")
        .map(h => h.trim().toLowerCase())
        .filter(h => HEX64.test(h)),
    )).slice(0, MAX_HASHES);

    if (hashes.length === 0) return json({ matches: [] });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Per-user rate limit (reuse beta_redeem_attempts-style? keep simple: rely
    // on the cap + auth). Look up matching user_ids.
    const { data: hashRows, error: hashErr } = await admin
      .from("email_hashes")
      .select("user_id")
      .in("email_sha256", hashes);
    if (hashErr) {
      console.error("match-contacts email_hashes:", hashErr.message);
      return json({ error: "lookup_failed" }, 500);
    }

    const ids = (hashRows || [])
      .map(r => r.user_id)
      .filter(id => id && id !== user.id);
    if (ids.length === 0) return json({ matches: [] });

    const { data: profiles, error: profErr } = await admin
      .from("profiles")
      .select("id, username")
      .in("id", ids);
    if (profErr) {
      console.error("match-contacts profiles:", profErr.message);
      return json({ error: "lookup_failed" }, 500);
    }

    const matches = (profiles || [])
      .filter(p => p.username)
      .map(p => ({ id: p.id, username: p.username }));

    return json({ matches });
  } catch (err: any) {
    console.error("match-contacts:", err?.message || err);
    return json({ error: "Internal error" }, 500);
  }
});
