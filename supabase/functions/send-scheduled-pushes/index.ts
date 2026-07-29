// Drift – Scheduled engagement push notifications.
// Designed to be called by a cron job (e.g. Supabase pg_cron or external).
// Auth: Bearer token must match PUSH_SECRET env var.
//
// Sends three categories of pushes:
//   1. Streak reminders  — users with an active streak who haven't completed today
//   2. Inactivity nudges — users who haven't opened in 2+ days
//   3. Daily motivation  — users who earned time yesterday
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PUSH_SECRET = Deno.env.get("PUSH_SECRET")!;
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const BATCH_SIZE = 100;

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

// ── Expo push helper ────────────────────────────────────────
interface PushMessage {
  to: string;
  sound: "default";
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

async function sendPushBatched(messages: PushMessage[]) {
  if (!messages.length) return [];
  const results: unknown[] = [];
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    const resp = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(batch),
    });
    results.push(await resp.json());
  }
  return results;
}

// ── Helper: get tokens for a list of user IDs ───────────────
async function getTokens(
  supabase: ReturnType<typeof createClient>,
  userIds: string[],
): Promise<Map<string, string[]>> {
  if (!userIds.length) return new Map();
  const { data } = await supabase
    .from("push_tokens")
    .select("user_id, expo_push_token")
    .in("user_id", userIds);

  const map = new Map<string, string[]>();
  for (const row of data || []) {
    const arr = map.get(row.user_id) || [];
    arr.push(row.expo_push_token);
    map.set(row.user_id, arr);
  }
  return map;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const auth = req.headers.get("authorization")?.replace("Bearer ", "");
    if (auth !== PUSH_SECRET) {
      return json({ error: "unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const twoDaysAgo = new Date(now);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const messages: PushMessage[] = [];

    // ── 1. Streak reminders ──────────────────────────────────
    // Users with streak > 0 who haven't completed a task today.
    const { data: streakUsers } = await supabase
      .from("profiles")
      .select("id, streak")
      .gt("streak", 0);

    if (streakUsers?.length) {
      // Find who already completed a task today.
      const { data: todayActive } = await supabase
        .from("tasks")
        .select("user_id")
        .gte("completed_at", todayStart.toISOString())
        .not("completed_at", "is", null);

      const activeSet = new Set((todayActive || []).map((t: { user_id: string }) => t.user_id));
      const needsReminder = streakUsers.filter(
        (u: { id: string }) => !activeSet.has(u.id),
      );
      const tokenMap = await getTokens(
        supabase,
        needsReminder.map((u: { id: string }) => u.id),
      );

      for (const user of needsReminder) {
        const tokens = tokenMap.get(user.id) || [];
        for (const token of tokens) {
          messages.push({
            to: token,
            sound: "default",
            title: "Don't break your streak!",
            body: `You're on a ${user.streak}-day streak! Complete a task to keep it going.`,
            data: { type: "streak_reminder" },
          });
        }
      }
    }

    // ── 2. Inactivity nudges ─────────────────────────────────
    // Users who haven't had any task activity in 2+ days.
    const { data: inactiveUsers } = await supabase
      .from("profiles")
      .select("id")
      .lt("last_active_at", twoDaysAgo.toISOString());

    if (inactiveUsers?.length) {
      const tokenMap = await getTokens(
        supabase,
        inactiveUsers.map((u: { id: string }) => u.id),
      );
      for (const user of inactiveUsers) {
        const tokens = tokenMap.get(user.id) || [];
        for (const token of tokens) {
          messages.push({
            to: token,
            sound: "default",
            title: "We miss you!",
            body: "Your apps are waiting. Complete a quick task to earn screen time.",
            data: { type: "inactivity_nudge" },
          });
        }
      }
    }

    // ── 3. Daily motivation ──────────────────────────────────
    // Users who earned credits yesterday — tell them how much.
    const { data: yesterdayTasks } = await supabase
      .from("tasks")
      .select("user_id, credits")
      .gte("completed_at", yesterdayStart.toISOString())
      .lt("completed_at", todayStart.toISOString())
      .not("completed_at", "is", null);

    if (yesterdayTasks?.length) {
      // Sum credits per user.
      const creditsByUser = new Map<string, number>();
      for (const t of yesterdayTasks) {
        creditsByUser.set(
          t.user_id,
          (creditsByUser.get(t.user_id) || 0) + (t.credits || 0),
        );
      }

      const tokenMap = await getTokens(
        supabase,
        [...creditsByUser.keys()],
      );
      for (const [userId, totalCredits] of creditsByUser) {
        const tokens = tokenMap.get(userId) || [];
        const mins = Math.round(totalCredits);
        for (const token of tokens) {
          messages.push({
            to: token,
            sound: "default",
            title: "Great day yesterday!",
            body: `You earned ${mins} minute${mins === 1 ? "" : "s"} of screen time. Keep the momentum going!`,
            data: { type: "daily_motivation" },
          });
        }
      }
    }

    // ── Send all messages ────────────────────────────────────
    const results = await sendPushBatched(messages);

    return json({
      sent: messages.length,
      breakdown: {
        streak_reminders: messages.filter((m) => m.data?.type === "streak_reminder").length,
        inactivity_nudges: messages.filter((m) => m.data?.type === "inactivity_nudge").length,
        daily_motivation: messages.filter((m) => m.data?.type === "daily_motivation").length,
      },
      results,
    });
  } catch (err) {
    console.error("send-scheduled-pushes error:", err);
    return json({ error: String(err) }, 500);
  }
});
