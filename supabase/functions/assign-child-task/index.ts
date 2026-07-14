// Drift — Assign Child Task (parent → child)
// A parent creates a task in one of their children's task lists. RLS forbids
// writing another user's tasks, so this runs with the service role after
// verifying the caller is that child's parent.
//
// POST { child_id, title, minutes, category? }
//   → { success: true, task }
//   → { success: false, reason: "not_parent" | "bad_input" }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    let body: { child_id?: unknown; title?: unknown; minutes?: unknown; category?: unknown };
    try { body = await req.json(); } catch { return json({ error: "Invalid body" }, 400); }

    const childId = String(body.child_id ?? "");
    const title = String(body.title ?? "").trim().slice(0, 100);
    const minutes = Math.round(Number(body.minutes));
    const category = String(body.category ?? "life").slice(0, 20) || "life";
    if (!childId || !title || !Number.isFinite(minutes) || minutes < 1 || minutes > 600) {
      return json({ success: false, reason: "bad_input" });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: owns } = await admin.rpc("parent_owns_child", {
      parent_uid: user.id, child_uid: childId,
    });
    if (owns !== true) return json({ success: false, reason: "not_parent" });

    const today = new Date().toISOString().slice(0, 10);
    const { data: task, error: insErr } = await admin.from("tasks").insert({
      user_id: childId,
      assigned_by: user.id,
      requires_approval: true,
      status: "assigned",
      title,
      category,
      minutes,
      credits: minutes,          // 1 credit = 1 minute = 60 s of screen time
      xp: 0,
      done: false,
      ai_check: false,
      ai_valued: false,
      task_date: today,
    }).select().single();
    if (insErr) {
      console.error("assign-child-task insert:", insErr.message);
      return json({ error: "insert_failed" }, 500);
    }
    return json({ success: true, task });
  } catch (err: any) {
    console.error("assign-child-task:", err?.message || err);
    return json({ error: "Internal error" }, 500);
  }
});
