# Phone (SMS OTP) Sign-in — Setup Guide

The app code for phone sign-up / sign-in is already shipped (see
`OnboardingScreen.jsx` → `PhoneAuthSlide`). It uses Supabase's passwordless
SMS OTP:

- `supabase.auth.signInWithOtp({ phone })` — texts a 6-digit code (creates the
  user on first use, so it handles both signup and login).
- `supabase.auth.verifyOtp({ phone, token, type: "sms" })` — verifies the code
  and issues a session.

**It will stay disabled until you wire an SMS provider into Supabase.** Until
then, tapping "Sign up with phone" and requesting a code returns a friendly
"Phone sign-in isn't enabled for this build yet." message.

Recommended provider: **Twilio Verify** (Supabase has native support; Twilio
generates and delivers the OTP, best deliverability, least config).

---

## Step 1 — Create a Twilio account + Verify service

1. Sign up at <https://www.twilio.com/try-twilio> and verify your own email/phone.
2. In the Twilio Console, note your **Account SID** and **Auth Token**
   (Console home → "Account Info").
3. Go to **Verify → Services → Create new Service**.
   - Name it `Drift`.
   - Create it and copy the **Service SID** (starts with `VA...`).
4. (Twilio trial accounts can only text *verified* numbers. To text anyone,
   upgrade the account and, in the US, complete **A2P 10DLC** brand/campaign
   registration under Messaging → Regulatory Compliance. Budget a day or two
   for carrier approval before a public launch.)

## Step 2 — Enable the Phone provider in Supabase

1. Supabase Dashboard → your project → **Authentication → Providers → Phone**.
2. Toggle **Enable Phone provider** on.
3. Under **SMS provider**, choose **Twilio Verify**.
4. Fill in:
   - **Twilio Account SID** — from Step 1.2
   - **Twilio Auth Token** — from Step 1.2
   - **Twilio Verify Service SID** — the `VA...` from Step 1.3
5. Set **OTP expiry** to `600` seconds (10 min) to match the client's copy, and
   leave **OTP length** at `6` (the client expects a 6-digit code).
6. Save.

> If you'd rather use plain **Twilio Programmable SMS** (Supabase generates the
> OTP, Twilio just sends it): pick "Twilio" instead of "Twilio Verify", and also
> provide a **Messaging Service SID** or a purchased **From** number. Slightly
> cheaper, a little more setup. Everything on the app side is identical.

## Step 3 — Rate limits (abuse + cost control)

SMS costs real money per message, so cap it server-side:

1. Supabase Dashboard → **Authentication → Rate Limits**.
2. Set **"Rate limit for sending SMS messages"** to something conservative to
   start (e.g. `30` per hour). Raise it as real traffic grows.
3. The client already adds its own guards (`phone_otp_*` / `phone_verify_*` via
   `rateLimited`, plus a 3-per-minute local send cap), but the dashboard limit
   is the one that actually protects your Twilio bill — the client can be
   bypassed.

## Step 4 — Test

1. Rebuild the dev client / standalone build (phone auth, like Google, won't
   work in Expo Go).
2. Onboarding → "Sign up with phone" → enter a number in E.164 form
   (`+14155551234`) → "Text me a code".
3. Enter the 6-digit code → you should land in the app.
4. New phone accounts get the **30-minute welcome bonus** (via the
   `handle_new_user` trigger, same as email/Google) and are routed through the
   username-setup modal, because phone signups have no username yet.

## Notes / gotchas

- **No email on phone accounts.** `authUser.email` is empty for phone users;
  the app already tolerates this. The verification gate in `Drift.jsx`
  (`completeAuthenticatedUser` and the boot path) checks
  `phone_confirmed_at` / `confirmed_at`, so phone users aren't wrongly kicked to
  the verify screen.
- **Account recovery.** A phone-only user who loses their number has no email
  fallback. Consider prompting phone users to add an email later (out of scope
  here).
- **Cost.** Twilio Verify is ~$0.05/verification in the US plus the SMS segment
  fee. Keep the Step 3 rate limit tight until you have signal on real volume.
