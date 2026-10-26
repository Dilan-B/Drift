# Drift — Written Information Security Program

The amended COPPA Rule (16 CFR 312.8, compliance date 2026-04-22) requires a
written program for protecting children's personal information. This is it.
It covers all user data, not just children's. `SECURITY.md` is the technical
review; this file is the program around it.

**Owner:** Dilan Bhimani (driftappcontact@gmail.com) coordinates the program.
**Review:** at least once a year, and after any incident or material change to
what Drift collects. Record each review at the bottom of this file.

## 1. What we hold and where

| Data | Where | Who can read it |
|---|---|---|
| Accounts, tasks, social graph, balances | Supabase Postgres (US) | The user; for a child, also the parent (RLS) |
| Children's data (name, assigned tasks, balance, app policy, app requests, push token) | Supabase Postgres | The child and their parent only |
| Proof photos / video frames | Never stored. In transit to OpenAI only | — |
| AI's text description of a proof | `tasks.proof_summary` | The user (and parent) |
| Avatars | Supabase Storage `avatars` bucket (public URLs) | Anyone with the URL |
| Screen Time selections, location, calendar, motion, NFC | Device only | — |

## 2. Safeguards

- **Access control.** Row-level security on every table. The service-role key exists only in edge functions. Admin access to the Supabase dashboard is limited to named people, with 2FA required.
- **Children.**
  - No child can join before parental consent is recorded (`join-family`).
  - Child accounts can't call AI functions (`verify-task`, `evaluate-task`).
  - Child accounts can't write analytics (an RLS insert policy blocks it).
  - Child accounts have no email, password or photo.
- **Minimisation.**
  - Proof media is never persisted.
  - Contacts are hashed on the device.
  - Location and calendar stay on the device.
- **Retention.** `purge_expired_data()` runs nightly via pg_cron (schema_v23). Its schedule must match the privacy policy.
- **Erasure.** `erase_account()` is the single path for deletion requests: users, parents and the retention job all go through it.
- **Secrets.** Secrets live in Supabase secrets or a gitignored `.env`, never in the client bundle or logs. Logs record reason codes only, never tokens, bodies or PII.
- **Transport.** TLS everywhere. ATS stays on in the iOS build.
- **Vendors.** Only the providers listed in the privacy policy. Each must have a data-processing agreement and keep data confidential. Before adding one that would receive children's data, update the parental notice, bump `CONSENT_NOTICE_VERSION` and get fresh consent.

## 3. Annual risk assessment checklist

- [ ] Run Supabase security advisors. Fix every RLS and exposure warning.
- [ ] Confirm `families.consent_at` is set for every family with children.
- [ ] Confirm the pg_cron purge job ran in the last 7 days (`cron.job_run_details`).
- [ ] Review who has dashboard, App Store Connect and GitHub access. Remove anyone who has left.
- [ ] Rotate the service-role key, OpenAI key and RevenueCat webhook secret.
- [ ] Re-read the privacy policy against the code. Anything new collected?
- [ ] Check that the vendor list and DPAs are current.

## 4. Incident response

1. Contain it: rotate keys, disable the affected function, revoke sessions.
2. Assess what data was involved, whose, and when.
3. Notify affected users and parents without unreasonable delay. Also notify:
   - the FTC, under the Health Breach Notification Rule, if health data was involved;
   - state attorneys general, as their laws require;
   - EU and UK authorities within 72 hours, where GDPR applies.
4. Write a post-mortem and add the fix to this program.

## Review log

| Date | Reviewer | Notes |
|---|---|---|
| 2026-10-25 | (initial) | Program written alongside schema_v23 (erasure, consent, retention). |
