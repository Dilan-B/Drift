// Drift - Delete Account
// Auth required. Performs a privacy-preserving account delete for the current
// user only: anonymize user-owned data, remove social links, then soft-delete
// the Supabase Auth user so auth identifiers are obfuscated without cascading
// through the whole relational graph.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function isEmailVerified(user: { email_confirmed_at?: string | null; confirmed_at?: string | null } | null): boolean {
  return !!(user?.email_confirmed_at || user?.confirmed_at);
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

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const now = new Date().toISOString();
    const anon = `deleted_${user.id.replace(/-/g, "").slice(0, 18)}`;

    // Profile: remove direct identifiers and paid/beta state, keep aggregate
    // stats only as non-identifying historical data.
    await admin.from("profiles").update({
      username: anon,
      avatar_url: null,
      avatar_seed: "deleted",
      sub_active: false,
      sub_expires: now,
      beta_unlocked_at: null,
      stripe_customer_id: null,
      balance_seconds: 0,
      updated_at: now,
    }).eq("id", user.id);

    // Personal content: neutralize task text and soft-delete where supported.
    await admin.from("tasks").update({
      title: "Deleted account task",
      ai_reasoning: null,
      deleted_at: now,
    }).eq("user_id", user.id);

    await admin.from("blocked_apps").update({ removed_at: now }).eq("user_id", user.id);
    await admin.from("credit_ledger").update({ ref_id: null }).eq("user_id", user.id);
    await admin.from("feedback").update({ body: "[deleted account]" }).eq("user_id", user.id);
    await admin.from("ai_check_usage").delete().eq("user_id", user.id);

    // Social graph: remove links/challenges involving the account without
    // touching other users' profiles or unrelated rows.
    await admin.from("friendships").delete().or(`user_id.eq.${user.id},friend_id.eq.${user.id}`);
    await admin.from("challenges").update({
      title: "Deleted account challenge",
      description: null,
      status: "declined",
    }).or(`challenger_id.eq.${user.id},challenged_id.eq.${user.id}`);

    // Keep screen_time aggregate rows but detach behaviorally sensitive counts.
    await admin.from("screen_time").update({ minutes: 0, unlocks: 0 }).eq("user_id", user.id);

    // Family cleanup. If this account owns families (a parent), deactivate them
    // and unlink every member — the children become inert (no new grants) but
    // their own data is untouched. If this account is itself a member (a child),
    // unlink that membership.
    const { data: ownedFamilies } = await admin
      .from("families").select("id").eq("parent_id", user.id);
    const famIds = (ownedFamilies || []).map((f: { id: string }) => f.id);
    if (famIds.length) {
      await admin.from("families").update({ active: false, deleted_at: now }).in("id", famIds);
      await admin.from("family_members").update({ removed_at: now })
        .in("family_id", famIds).is("removed_at", null);
    }
    await admin.from("family_members").update({ removed_at: now })
      .eq("user_id", user.id).is("removed_at", null);

    // Supabase Auth soft delete obfuscates auth identity instead of hard
    // deleting/cascading through public tables.
    const { error: deleteErr } = await admin.auth.admin.deleteUser(user.id, true);
    if (deleteErr) {
      console.error("delete-account auth soft delete failed:", deleteErr.message);
      return json({ error: "Could not delete account" }, 500);
    }

    return json({ ok: true });
  } catch (err: any) {
    console.error("delete-account:", err?.message || err);
    return json({ error: "Internal error" }, 500);
  }
});
