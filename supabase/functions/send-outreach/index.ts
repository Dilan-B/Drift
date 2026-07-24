import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const OUTREACH_SECRET = Deno.env.get("OUTREACH_SECRET")!;
const FROM_EMAIL = "Riaan <riaan@getdriftapp.org>";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const auth = req.headers.get("authorization")?.replace("Bearer ", "");
    if (auth !== OUTREACH_SECRET) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { to, recipientName, recipientContext, customAngle } = await req.json();

    if (!to || !recipientName) {
      return new Response(JSON.stringify({ error: "missing to or recipientName" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Generate personalized email via OpenAI
    const prompt = `You are writing a cold outreach email on behalf of Riaan, the founder of Drift.

Drift is an iOS app built by two teens (Riaan and his co-founder) to solve their own generation's screen time problem. It uses Apple's Screen Time API to block distracting apps (TikTok, Instagram, games, etc.) until the user completes real-world tasks — homework, chores, exercise, or custom goals set by parents or the user themselves. Once tasks are verified, they earn minutes of screen time that unlock their blocked apps. It's live on the App Store and growing organically.

Recipient: ${recipientName}
Context about them: ${recipientContext || "none provided"}
${customAngle ? `Specific angle to use: ${customAngle}` : ""}

RULES (follow strictly):
- Subject line: 2-4 words, all lowercase, under 33 characters. Reference something specific about them if possible.
- Body: plain text ONLY. Under 120 words total. No HTML, no bullet points, no bold.
- Structure: one personalized observation referencing their specific work → 2-3 sentences explaining what Drift is and why it's relevant to them → one clear low-friction CTA (e.g. "would a 15-min call next week work?" or "happy to send a 2-min demo").
- Tone: professional but warm. Slightly formal — you're a founder reaching out, not a friend texting. Confident but not arrogant.
- Sign off as "Riaan Sanghani" with "Co-Founder, Drift" on the next line.
- Do NOT use exclamation marks in the subject line.

Return ONLY valid JSON with two fields:
- "subject": the email subject line
- "body": the email body in plain text (include greeting and sign-off)`;

    const oaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        response_format: { type: "json_object" },
      }),
    });

    const oaiData = await oaiRes.json();
    const emailContent = JSON.parse(oaiData.choices[0].message.content);

    // Send via Resend
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [to],
        subject: emailContent.subject,
        text: emailContent.body + "\n\n---\nDrift App · driftproductivity.com\nReply \"unsubscribe\" to opt out.",
        reply_to: "driftappcontact@gmail.com",
      }),
    });

    const resendData = await resendRes.json();

    if (!resendRes.ok) {
      return new Response(JSON.stringify({ error: "resend_error", detail: resendData }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      emailId: resendData.id,
      subject: emailContent.subject,
      preview: emailContent.body,
    }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
