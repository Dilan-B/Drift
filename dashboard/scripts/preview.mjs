// Render the page from INVENTED numbers, with no database and no keys.
//
// The numbers below are fabricated on purpose. This repository is public, so a
// snapshot of the real ones must never be committed; and a preview that needs
// the service-role key on a laptop is a preview nobody runs safely. Change the
// layout, run this, look at preview.html.
import { writeFileSync } from "node:fs";
import { render } from "../lib/render.js";

const day = (i) => new Date(Date.now() - (59 - i) * 864e5).toISOString().slice(0, 10);
const data = {
  generated_at: new Date().toISOString(),
  excluded: 6,
  headline: {
    accounts: 55, tasks_created: 271, tasks_completed: 58, focus_minutes: 5875,
    earned_minutes: 2772, xp: 2044, doers: 12, creators: 30, median_task_min: 60,
    ai_checked: 31, photo_verified: 1, active_7: 3, active_30: 10,
    first_signup: "2026-06-05",
  },
  funnel: { signed_up: 55, onboarded: 21, blocked: 1, created: 30, completed: 12, repeat: 4 },
  daily: Array.from({ length: 60 }, (_, i) => ({
    day: day(i),
    signups: i % 7 === 0 ? 2 : 0,
    created: Math.max(0, Math.round(6 * Math.sin(i / 4) + 6)),
    completed: Math.max(0, Math.round(3 * Math.sin(i / 3) + 2)),
    focus: 0,
  })),
  categories: [
    { category: "work", created: 90, completed: 40, focus: 3000 },
    { category: "learning", created: 80, completed: 12, focus: 1600 },
    { category: "life", created: 60, completed: 4, focus: 700 },
  ],
  retention: { cohort: 30, d1: 11, d7: 7, d30: 3 },
  streaks: { on_streak: 5, best: 4, avg_best: 2.1 },
  money: { paying: 0, trialing: 1, stale_flags: 6, overrides: 5, redeemed: 1 },
  codes: [{ code: "SAMPLE-0000", cohort: "preview", uses: 0, max_uses: 1,
            grant_days: 30, active: true, open_until: "2026-12-31" }],
  events: [{ event_name: "app_opened", n: 120, users: 9 },
           { event_name: "task_created", n: 31, users: 7 }],
};

writeFileSync(new URL("../preview.html", import.meta.url), render(data, true));
console.log("wrote dashboard/preview.html (invented numbers, not production)");
