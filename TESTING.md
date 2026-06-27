# Drift — Session Changes & Test Plan

All changes below are **additive** on top of the latest pull. Nothing in the
existing app (RevenueCat Free/Pro, blocking, auth, screen-time) was modified,
**except** the signup verification screen (magic link → 6-digit OTP), which was
an intentional change.

Everything is verified to **compile/parse** (Babel-clean) but was **not**
runtime-tested — these changes were made on Windows with no device build, so the
checklist below must be run on a real iOS dev/standalone build.

---

## What changed this session

### New features
- **Email OTP verification** — signup uses a 6-digit code screen (`verifyOtp`)
  instead of a magic link, and blocks reused emails with an "account already
  exists" message. — `OnboardingScreen.jsx`
- **Post-signup onboarding** — a coachmark **tutorial** (`TutorialOverlay.jsx`)
  followed by a decorated **review page** that auto-fires Apple's review prompt
  (`ReviewPromptScreen.jsx`). Triggered after the first-time app-block setup. —
  `Drift.jsx`
- **Contacts in the Grove** — privacy-safe matching: contact emails are SHA-256
  hashed on-device, only hashes go to the `match-contacts` edge function, which
  returns Drift users to add; the rest can be invited via a share link. —
  `contacts.js`, `SocialScreen.jsx`, `supabase/functions/match-contacts`
- **Level plant icons** — friends' Grove plants and the Today hero card now show
  the user's **level tier** (Seedling → Old Growth) from XP, via shared
  `levels.js` and `total_xp` added to the friends query. —
  `Drift.jsx`, `SocialScreen.jsx`, `supabase.js`, `levels.js`

### Fixes / polish
- **Dare vs challenge copy** — dares now have their own labels and correct stake
  instructions everywhere (previously reused the compete-challenge text). —
  `SocialScreen.jsx`
- **Tap reliability** — fixed SVG-inside-touchable taps (challenge cards, avatar
  edit badge, challenge rows) and added keyboard tap-persistence. —
  `SocialScreen.jsx`, `ProfileScreen.jsx`
- **Privacy / Terms links** → `driftproductivity.com/privacy/` & `/terms/`. —
  `ProfileScreen.jsx`
- Input `maxLength`s and the iOS **contacts permission** string. —
  `app.json`, `ios/Drift/Info.plist`

### Backend (gitignored admin SQL + edge functions)
- `supabase/admin/schema_v7_contacts.sql` — `email_hashes` table + trigger for
  contact matching (service-role only).
- `supabase/admin/fix_public_profile_security_invoker.sql` — fixes the
  `public_profile` SECURITY DEFINER lint.
- `supabase/functions/match-contacts` — contact-matching edge function.

### Cleanup
- Removed redundant `grant_everyone_pro.sql`, `schema_v6_revenuecat.sql`, and the
  `revenuecat-webhook` function (RevenueCat is client-side; these were unused and
  could have caused confusion).

---

## Prerequisites before a test build

**Local installs (then rebuild):**
```
npx expo install expo-store-review expo-contacts
```
Until installed, the review prompt no-ops and the "Find friends from contacts"
button stays hidden (guarded — nothing crashes).

**Supabase:**
- Run `schema_v7_contacts.sql` (required for contacts).
- Run `fix_public_profile_security_invoker.sql` (security fix).
- Deploy the `match-contacts` edge function.
- Custom SMTP set up (e.g. Resend, host `smtp.resend.com`, password = API key),
  and add the code to the **Confirm signup** email template, e.g.
  `Your Drift code is {{ .Token }}`. Email confirmation must be **ON**.

**Then:** rebuild the iOS dev/standalone build.

---

## Cofounder test checklist (device build required)

1. **OTP signup** — sign up with a *fresh* email → code arrives (check Resend →
   Emails) → enter it → logged in. Reused email → "account already exists" error.
   Wrong code → error; let it expire → "Resend code" works.
2. **Pro/Free intact** — a Free account hits the task limit + default app
   blocking; a Pro account has full access + the custom app picker. Confirms the
   session's changes did not disturb the RevenueCat gating.
3. **Post-signup flow** — new signup → blocked-apps setup → **tutorial**
   coachmarks → **review page** appears, auto-prompts for a review after ~2.5s,
   and the Continue button appears afterward.
4. **Level plants** — Today card shows your tier plant; in the Grove, each
   friend's plant reflects *their* level; the friend-stats modal shows their level.
5. **Contacts** — Grove → `+` → "Find friends from contacts" → grant permission →
   contacts on Drift appear with **Add**; "Invite contacts" shares a link. (No
   matches if none of your contacts are on Drift — expected.)
6. **Dares** — send a Dare vs a Compete challenge. The recipient should see
   "DARE" labels and "finish before midnight / you lose X min" wording; the
   win/lose outcome modal reads correctly for a dare.
7. **Tap reliability** — the bottom tab bar, friend plants, challenge cards, and
   the profile avatar edit badge all register on the **first** tap.
8. **Privacy / Terms** — both open the correct `driftproductivity.com` pages.

### Quick triage if something fails
- **No OTP email:** test with a brand-new email (existing accounts send nothing);
  check Resend → Emails for a delivered/failed entry; verify the Resend sending
  domain is verified and the SMTP host is `smtp.resend.com`.
- **Contacts button missing:** `expo-contacts` not installed, or rebuild needed.
- **Review prompt does nothing:** `expo-store-review` not installed, or Apple is
  rate-limiting the prompt (it won't show every time by design).
