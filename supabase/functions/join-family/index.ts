// Drift — Join Family (child provisioning)
// A child device joins a family with just { family_code, child_name } — no email,
// no password, no existing session. The FAMILY CODE is the credential.
//
// Flow (all service-role, RLS-bypassing):
//   1. Validate the code → an active family.
//   2. Enforce a per-family child cap (basic abuse guard).
//   3. admin.createUser: a real auth user with a SYNTHETIC, already-confirmed
//      email (email_confirm:true) so the child passes current_user_email_confirmed()
//      and can write their own rows. handle_new_user creates the profile
//      (account_type='child', balance 0, no welcome bonus).
//   4. Link the child into family_members (display_name = the typed name).
//   5. Mint a session by signing in with the throwaway password, and return the
//      tokens so the client can setSession(...) and stay logged in.
//
// POST { family_code: string, child_name: string }
//   → { success: true, access_token, refresh_token, user_id, username, display_name }
//   → { success: false, reason: "invalid_code" | "inactive" | "family_full" | "bad_name" }
//
// NOTE: no caller Authorization is required (the child has no session yet).
// Abuse mitigation here is the per-family cap + the 31^6 code space; a per-IP
// edge rate limit should be added before a public launch.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const MAX_CHILDREN_PER_FAMILY = 10;

function normalizeUsername(raw: string): string {
  return (raw || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
}

function randomPassword(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // URL-safe-ish strong password; never shown to anyone.
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("") + "Aa1!";
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    let body: { family_code?: unknown; child_name?: unknown };
    try { body = await req.json(); } catch { return json({ error: "Invalid body" }, 400); }

    const code = String(body.family_code ?? "").trim().toUpperCase();
    const childName = String(body.child_name ?? "").trim().slice(0, 40);
    if (!code || code.length > 32) return json({ success: false, reason: "invalid_code" });
    if (childName.length < 1) return json({ success: false, reason: "bad_name" });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Validate the family code.
    const { data: family, error: famErr } = await admin
      .from("families")
      // seats: how many children the parent has paid for ($0.99/mo each).
      // Without it in this select the seat check below reads undefined and
      // silently never fires.
      .select("id, parent_id, active, deleted_at, seats")
      .eq("code", code)
      .maybeSingle();
    if (famErr) {
      console.error("join-family lookup:", famErr.message);
      return json({ error: "lookup_failed" }, 500);
    }
    if (!family || family.deleted_at) return json({ success: false, reason: "invalid_code" });
    if (!family.active) return json({ success: false, reason: "inactive" });

    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );

    // 1b. Rejoin: if exactly one active child with this name already exists in
    // the family (a kid who reinstalled / signed out), re-issue a session for
    // that account instead of creating a duplicate. The old throwaway password
    // is unrecoverable, so we reset it and sign in with the new one.
    const nameKey = childName.trim().toLowerCase();
    const { data: existingMembers } = await admin
      .from("family_members")
      .select("user_id, display_name")
      .eq("family_id", family.id).eq("role", "child").is("removed_at", null);
    const matches = (existingMembers || []).filter(
      (m: { display_name?: string }) => (m.display_name || "").trim().toLowerCase() === nameKey,
    );
    if (matches.length === 1) {
      const existingId = matches[0].user_id as string;
      const newPw = randomPassword();
      const { error: pwErr } = await admin.auth.admin.updateUserById(existingId, { password: newPw });
      const { data: udata } = await admin.auth.admin.getUserById(existingId);
      const existingEmail = udata?.user?.email;
      if (!pwErr && existingEmail) {
        const { data: reSignIn } = await anon.auth.signInWithPassword({ email: existingEmail, password: newPw });
        if (reSignIn?.session) {
          const { data: prof } = await admin
            .from("profiles").select("username").eq("id", existingId).maybeSingle();
          return json({
            success: true,
            access_token: reSignIn.session.access_token,
            refresh_token: reSignIn.session.refresh_token,
            user_id: existingId,
            username: prof?.username ?? normalizeUsername(childName),
            display_name: matches[0].display_name,
            rejoined: true,
          });
        }
      }
      // Fall through to creating a fresh child if rejoin couldn't be completed.
    }

    // 2. Per-family child cap.
    const { count, error: countErr } = await admin
      .from("family_members")
      .select("id", { count: "exact", head: true })
      .eq("family_id", family.id)
      .eq("role", "child")
      .is("removed_at", null);
    if (countErr) {
      console.error("join-family count:", countErr.message);
      return json({ error: "lookup_failed" }, 500);
    }
    // Two different caps, and they mean different things:
    //   MAX_CHILDREN_PER_FAMILY is an abuse ceiling on the whole feature.
    //   families.seats is what the parent has PAID for ($0.99/mo per child).
    //
    // The seat check happens here, at join time, rather than letting the child
    // in and having is_pro() quietly deny them later. A child who signs up and
    // then finds the app inert has no idea why, and cannot fix it — only the
    // parent can. Refusing at the door with a reason the parent can act on is
    // the kinder failure.
    const paidSeats = Math.max(0, Number((family as { seats?: number }).seats ?? 0));
    if (paidSeats > 0 && (count ?? 0) >= paidSeats) {
      return json({ success: false, reason: "no_seats", seats: paidSeats });
    }

    if ((count ?? 0) >= MAX_CHILDREN_PER_FAMILY) {
      return json({ success: false, reason: "family_full" });
    }

    // 3. Create the child auth user (synthetic, confirmed email).
    const syntheticEmail = `child.${crypto.randomUUID()}@familybox.driftproductivity.com`;
    const password = randomPassword();
    const username = normalizeUsername(childName);

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: syntheticEmail,
      password,
      email_confirm: true,
      user_metadata: {
        username,                       // handle_new_user uniquifies collisions
        full_name: childName,
        account_type: "child",
        family_id: family.id,
      },
    });
    if (createErr || !created?.user) {
      console.error("join-family createUser:", createErr?.message);
      return json({ error: "create_failed" }, 500);
    }
    const childId = created.user.id;

    // 4. Link into the family (display_name = the typed name).
    const { error: memberErr } = await admin.from("family_members").insert({
      family_id: family.id,
      user_id: childId,
      role: "child",
      display_name: childName,
    });
    if (memberErr) {
      console.error("join-family member insert:", memberErr.message);
      // Best-effort cleanup so a failed join doesn't leave an orphan auth user.
      await admin.auth.admin.deleteUser(childId).catch(() => {});
      return json({ error: "link_failed" }, 500);
    }

    // 5. Mint a session with the throwaway password.
    const { data: signIn, error: signErr } = await anon.auth.signInWithPassword({
      email: syntheticEmail,
      password,
    });
    if (signErr || !signIn?.session) {
      console.error("join-family signIn:", signErr?.message);
      return json({ error: "session_failed" }, 500);
    }

    // Read back the (possibly suffixed) username the trigger settled on.
    const { data: prof } = await admin
      .from("profiles").select("username").eq("id", childId).maybeSingle();

    return json({
      success: true,
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
      user_id: childId,
      username: prof?.username ?? username,
      display_name: childName,
    });
  } catch (err: any) {
    console.error("join-family:", err?.message || err);
    return json({ error: "Internal error" }, 500);
  }
});
