// Receives the Partner and Contact forms from the marketing site
// (Dilan-B/DriftLandingPage, a static export) and emails them to the inbox
// via Resend. Replaces the old mailto: links, which only opened the visitor's
// desktop mail app and never actually sent anything.
//
// Public endpoint: deploy with --no-verify-jwt. Abuse controls are the origin
// allow-list, a honeypot field, strict length limits and a per-instance IP
// throttle (best effort — instances are recycled, Resend's daily cap is the
// hard ceiling).
//
//   supabase functions deploy site-inquiry --no-verify-jwt
//   supabase secrets set RESEND_API_KEY=...            (already set for send-outreach)
//   supabase secrets set SITE_INQUIRY_TO=hello@ridilabs.com   (optional, this is the default)

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const TO_EMAIL = Deno.env.get("SITE_INQUIRY_TO") ?? "hello@ridilabs.com";
const FROM_EMAIL = "Drift Website <website@getdriftapp.org>";

const ALLOWED_ORIGINS = new Set([
  "https://driftproductivity.com",
  "https://www.driftproductivity.com",
  "https://drift-landing-page-beryl.vercel.app",
  "http://localhost:3000",
]);

const PARTNER_TRACKS = [
  "Marketing partner (free)",
  "Paid team / organization",
  "Not sure yet",
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Per-instance throttle: 5 submissions per IP per 10 minutes.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

function throttled(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > MAX_PER_WINDOW;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Vary": "Origin",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function str(v: unknown, min: number, max: number): string | null {
  if (typeof v !== "string") return min === 0 ? "" : null;
  const s = v.trim();
  return s.length >= min && s.length <= max ? s : null;
}

// Strip line breaks so user text can't break out of the subject header.
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ");

type Mail = { subject: string; text: string; replyTo: string };

function buildPartner(b: Record<string, unknown>): Mail | null {
  const name = str(b.name, 2, 100);
  const email = str(b.email, 3, 254);
  const organization = str(b.organization, 2, 120);
  const size = str(b.size, 0, 40);
  const message = str(b.message, 10, 1000);
  const track = typeof b.track === "string" && PARTNER_TRACKS.includes(b.track) ? b.track : null;
  if (!name || !email || !EMAIL_RE.test(email) || !organization || size === null || !message || !track) {
    return null;
  }
  return {
    subject: oneLine(`[Drift Partners] ${track} — ${organization}`),
    text:
      `Name: ${name}\nEmail: ${email}\nOrganization: ${organization}\n` +
      `Track: ${track}\nSize: ${size || "—"}\n\n${message}`,
    replyTo: email,
  };
}

function buildContact(b: Record<string, unknown>): Mail | null {
  const name = str(b.name, 2, 100);
  const email = str(b.email, 3, 254);
  const subject = str(b.subject, 3, 100);
  const message = str(b.message, 10, 5000);
  if (!name || !email || !EMAIL_RE.test(email) || !subject || !message) return null;
  return {
    subject: oneLine(`[Drift] ${subject} — from ${name}`),
    text: `Name: ${name}\nEmail: ${email}\nIssue type: ${subject}\n\n${message}`,
    replyTo: email,
  };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return json(403, { error: "forbidden" });

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (throttled(ip)) return json(429, { error: "rate_limited" });

  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 20_000) return json(413, { error: "too_large" });
    body = JSON.parse(raw);
    if (!body || typeof body !== "object") throw new Error();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  // Honeypot: real visitors never see this field. Pretend success to bots.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return json(200, { ok: true });
  }

  const mail =
    body.form === "partner" ? buildPartner(body) :
    body.form === "contact" ? buildContact(body) :
    null;
  if (!mail) return json(400, { error: "invalid_fields" });

  if (!RESEND_API_KEY) {
    console.error("site-inquiry: RESEND_API_KEY is not set");
    return json(500, { error: "not_configured" });
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [TO_EMAIL],
      reply_to: mail.replyTo,
      subject: mail.subject,
      text: mail.text,
    }),
  });

  if (!res.ok) {
    // Status only — never log the visitor's details.
    console.error(`site-inquiry: Resend responded ${res.status}`);
    return json(502, { error: "send_failed" });
  }
  return json(200, { ok: true });
});
