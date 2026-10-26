// Drift - Delete Account
// Auth required. Erases the current user's data (and, for a parent, every
// child in their families — consent for those children ends with the parent's
// account), removes their avatar files, revokes their Sign in with Apple token,
// then soft-deletes each Supabase Auth user so identifiers are obfuscated.
//
// The erasing itself is public.erase_account() (schema_v23): one transaction,
// and the only sanctioned way past the no-hard-delete trigger. Doing it here
// row by row is what let failures slip through before — friendships and
// ai_check_usage deletes raised on that trigger and nobody checked.
//
// POST { apple_authorization_code?: string }
//   The client re-runs Sign in with Apple right before deleting and passes the
//   fresh authorizationCode. App Store guideline 5.1.1(v) requires apps that
//   offer Sign in with Apple to revoke the user's token on deletion; that needs
//   a refresh token, and Supabase does not keep Apple's. A failed revoke does
//   NOT block deletion — the user asked for their data to be gone.
//
// Secrets for the revoke (deletion works without them, revoke is skipped):
//   APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY (the .p8 contents),
//   APPLE_CLIENT_ID (the bundle id, com.sanghani.drift)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { importPKCS8, SignJWT } from "https://deno.land/x/jose@v4.14.4/index.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function isEmailVerified(user: { email_confirmed_at?: string | null; confirmed_at?: string | null } | null): boolean {
  return !!(user?.email_confirmed_at || user?.confirmed_at);
}

// ── Sign in with Apple revocation ───────────────────────────
async function appleClientSecret(): Promise<string | null> {
  const teamId = Deno.env.get("APPLE_TEAM_ID");
  const keyId = Deno.env.get("APPLE_KEY_ID");
  const pem = Deno.env.get("APPLE_PRIVATE_KEY");
  const clientId = Deno.env.get("APPLE_CLIENT_ID");
  if (!teamId || !keyId || !pem || !clientId) return null;
  const key = await importPKCS8(pem.replace(/\\n/g, "\n"), "ES256");
  return await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt()
    .setExpirationTime("5m")
    .setAudience("https://appleid.apple.com")
    .setSubject(clientId)
    .sign(key);
}

/** Exchange the fresh authorization code for a refresh token, then revoke it. */
async function revokeAppleToken(code: string): Promise<"revoked" | "skipped" | "failed"> {
  const clientId = Deno.env.get("APPLE_CLIENT_ID");
  const secret = await appleClientSecret().catch(() => null);
  if (!clientId || !secret) return "skipped";
  try {
    const tokenRes = await fetch("https://appleid.apple.com/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId, client_secret: secret, code, grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) return "failed";
    const tok = await tokenRes.json();
    const token = tok.refresh_token || tok.access_token;
    if (!token) return "failed";
    const revokeRes = await fetch("https://appleid.apple.com/auth/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId, client_secret: secret, token,
        token_type_hint: tok.refresh_token ? "refresh_token" : "access_token",
      }),
    });
    return revokeRes.ok ? "revoked" : "failed";
  } catch {
    return "failed";
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

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
    if (!isEmailVerified(user)) return json({ error: "email_not_verified" }, 403);

    let body: { apple_authorization_code?: unknown } = {};
    try { body = await req.json(); } catch { /* empty body is fine */ }
    const appleCode = typeof body.apple_authorization_code === "string"
      ? body.apple_authorization_code.slice(0, 2048) : "";

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Revoke first: once the auth user is gone we can't tie the code to them.
    const apple = appleCode ? await revokeAppleToken(appleCode) : "skipped";
    if (apple === "failed") console.error("delete-account: apple revoke failed");

    const { data: erased, error: eraseErr } = await admin.rpc("erase_account", { p_uid: user.id });
    if (eraseErr) {
      console.error("delete-account erase failed:", eraseErr.message);
      return json({ error: "Could not delete account" }, 500);
    }
    const ids: string[] = Array.from(new Set(((erased || []) as string[]).concat(user.id)));

    for (const id of ids) {
      // Avatars live at avatars/<uid>/avatar-<ts>.jpg in a public bucket.
      const { data: files } = await admin.storage.from("avatars").list(id, { limit: 1000 });
      if (files?.length) {
        await admin.storage.from("avatars").remove(files.map((f: { name: string }) => `${id}/${f.name}`));
      }
      const { error: delErr } = await admin.auth.admin.deleteUser(id, true);
      if (delErr && id === user.id) {
        console.error("delete-account auth soft delete failed:", delErr.message);
        return json({ error: "Could not delete account" }, 500);
      }
    }

    return json({ ok: true, apple_revoke: apple, erased: ids.length });
  } catch (err: any) {
    console.error("delete-account:", err?.message || err);
    return json({ error: "Internal error" }, 500);
  }
});
