// The whole hosted dashboard: one serverless function, one database call.
//
// SECURITY, and none of this is optional for a page holding revenue numbers:
//  - Basic auth in front of everything. Vercel's own Deployment Protection is
//    the better lock, but it is not on every plan, so the app carries its own
//    and does not depend on the platform for it.
//  - Credentials are compared with timingSafeEqual. A plain === leaks the
//    password one character at a time to anyone patient enough to measure.
//  - The service-role key lives ONLY in a Vercel environment variable and is
//    read server-side. It is never sent to the browser. If it ever appears in
//    the HTML, every row of user data is public.
//  - noindex, and no-store, so the page is not cached by a CDN or a proxy that
//    would serve it to someone who never authenticated.
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { render } from "../lib/render.js";

const eq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

function authed(req) {
  const [scheme, b64] = (req.headers.authorization || "").split(" ");
  if (scheme !== "Basic" || !b64) return false;
  const i = Buffer.from(b64, "base64").toString().indexOf(":");
  if (i < 0) return false;
  const user = Buffer.from(b64, "base64").toString().slice(0, i);
  const pass = Buffer.from(b64, "base64").toString().slice(i + 1);
  // Both compared, both timing-safe: bailing early on the username would leak it.
  const okUser = eq(user, process.env.DASH_USER || "");
  const okPass = eq(pass, process.env.DASH_PASS || "");
  return okUser && okPass;
}

export default async function handler(req, res) {
  // Missing config must fail closed. Defaulting to "no password set, let them
  // in" is how internal dashboards end up in search results.
  if (!process.env.DASH_USER || !process.env.DASH_PASS) {
    res.status(500).send("DASH_USER / DASH_PASS are not set. Refusing to serve.");
    return;
  }
  if (!authed(req)) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Drift internal", charset="UTF-8"');
    res.status(401).send("Authentication required.");
    return;
  }

  const real = !("all" in (req.query || {}));
  try {
    // trim(): a key pasted into a terminal prompt or a web form arrives with a
    // trailing newline often enough to be worth defending against. The failure
    // it causes is "Invalid API key", which reads like the wrong key entirely
    // and sends you looking in the wrong place.
    const url = (process.env.SUPABASE_URL || "").trim();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY unset");
    const db = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await db.rpc("internal_dashboard", { p_real: real });
    if (error) throw new Error(error.message);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).send(render(data, real));
  } catch (e) {
    // The message can name the database; say nothing useful to a stranger.
    console.error("dashboard:", e?.message || e);
    res.status(500).send("Could not load metrics. Check the server logs.");
  }
}
