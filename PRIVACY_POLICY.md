# Drift Privacy Policy

**Effective: June 7, 2026**

This Privacy Policy describes how Drift ("we", "us") handles your data when you use the Drift mobile application. We've kept it short and human-readable. If something here isn't clear, email **driftappcontact@gmail.com** and we'll explain.

## What we collect

**Account data** — when you sign up, we store:
- Your email address (used for sign-in and account recovery).
- A username you pick.
- A salted password hash (we never see your password — Supabase manages this).
- The date you installed the app.

**Activity data** — to make the app work, we store:
- Tasks you create, mark complete, or delete (titles, durations, categories).
- Earned screen-time credits and XP totals.
- Friendships you've initiated or accepted, by user ID.
- Challenges you send or receive, including status, type, and exercise picked.

**Optional data** — only collected if you opt in:
- An avatar image you upload (Supabase Storage).
- Photos or text you submit for AI verification (processed by OpenAI via our server, then discarded — not stored).
- App selections you make in Apple's Screen Time picker (stored on your device only — see "Apple Screen Time" below).

**Crash diagnostics** — none. We don't include third-party analytics, crash reporters, advertising SDKs, or trackers.

## What we don't collect

- We don't read your contacts, calendar, photos library (beyond a photo you explicitly pick for proof), location, or Health data.
- We don't track which apps you actually use on your phone. Apple's Screen Time API gives us *opaque tokens* representing your selection — even we can't see which apps you picked.
- We don't sell, rent, or share your personal data with advertisers or data brokers. Ever.

## Where your data lives

- **Account, tasks, friendships, screen-time history**: Supabase (PostgreSQL, hosted in the US). Encrypted at rest and in transit.
- **AI verification proofs**: sent over HTTPS to OpenAI through our Supabase Edge Function, used for one evaluation, then discarded. Neither we nor OpenAI retain training data from these submissions.
- **Apple Screen Time selection**: stored *only on your device* (iOS UserDefaults). Never uploaded to our servers.
- **Local app state** (current day's balance, dark mode preference): stored on your device only.

## Who can see your data

- **You** — full access via the app.
- **Your friends** — only your username and total screen-time minutes earned today. Not the underlying tasks.
- **Drift staff** — only with your explicit support request, and only the minimum needed to debug your issue.
- **No one else.** We do not share, sell, or hand over data to third parties except as required by law (e.g., a valid US court order).

## Apple Screen Time

Drift uses Apple's Family Controls and Device Activity frameworks to optionally block apps you select during focus sessions or when your earned balance hits zero. Per Apple's design:
- The list of apps you pick is **never visible to us** — we receive only opaque tokens.
- The shield is applied and enforced by iOS itself, not by Drift's servers.
- All Screen Time activity stays on your device.

## Children

Drift is rated 12+ and not directed at children under 13. We don't knowingly collect data from anyone under 13. If you believe a minor has signed up, email us and we'll delete the account.

## Your rights

You can:
- **View your data** by tapping the user icon in Drift.
- **Delete your account and all associated data** by emailing **driftappcontact@gmail.com** with the subject "Delete my account" from the address you signed up with. We process deletions within 7 days.
- **Export your data** — same email, subject "Export my data". You'll get a JSON file within 14 days.

If you're in the EEA, UK, or California, you have additional rights under GDPR / UK GDPR / CCPA (access, correction, portability, right to object). The email above handles those requests too.

## Security

- All network traffic uses HTTPS / TLS 1.2+. Plain HTTP is disabled in our iOS build.
- Passwords are hashed and salted by Supabase Auth (bcrypt-equivalent).
- The Supabase anon key shipped with the app is restricted by Row Level Security — it can't read or modify another user's data.
- We do not store payment card details — Stripe handles those directly.

## Changes to this policy

If we change anything material, we'll post the new version in the app and notify you on next launch. The effective date at the top reflects the most recent revision.

## Contact

**driftappcontact@gmail.com** — privacy, deletion, GDPR, anything.
