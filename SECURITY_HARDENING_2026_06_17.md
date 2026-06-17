# Drift Auth Hardening - 2026-06-17

## What Applied

- Browser `httpOnly` cookies do not apply to this Expo React Native app. Native sessions now use encrypted Supabase auth storage instead: Expo SecureStore holds the device-only cipher key, and AsyncStorage holds ciphertext only.
- For web builds, verify that `window.localStorage` does not contain Supabase auth/session token values.
- Signup password validation is now 12+ characters and requires uppercase, lowercase, number, and symbol.
- Login/signup throttling is now 5 attempts per 15 minutes per email+device in the app. Supabase Auth server-side rate limits should remain enabled.
- Unverified users are blocked from entering the app through password sign-in, signup sessions, OAuth/deep-link completion, and authenticated Edge Functions.
- `supabase/admin/schema_v6_verified_email_writes.sql` requires `auth.users.email_confirmed_at` for RLS-protected writes.

## Edge Function Audit

Already re-verified JWT identity server-side before this pass:

- `claim-trial`
- `create-checkout`
- `confirm-checkout-session`
- `delete-account`
- `evaluate-task`
- `verify-task`
- `redeem-beta-code`

Added in this pass:

- Verified-email guards returning `email_not_verified` with HTTP 403.
- POST-only method guards where user-called functions were missing them.

Special case:

- `stripe-webhook` is intentionally not protected by a user JWT. It verifies Stripe's webhook signature and deduplicates events by Stripe event id.

## Supabase Dashboard Settings To Flip

In Supabase Dashboard:

- Auth -> Sign In / Providers -> Email: enable email confirmation for signup.
- Auth -> Rate Limits: keep email/password auth rate limits enabled. Target login/signup/reset behavior: 5 attempts per 15 minutes per IP+email, with temporary lockout/backoff.
- Auth -> Password Security: set minimum password length to 12 and enable leaked-password / compromised-password protection.

## Verification

- `window.localStorage`: run a web build, open DevTools -> Application -> Local Storage, and confirm no Supabase auth/session token values are present.
- Native storage: inspect AsyncStorage and confirm the Supabase auth key stores JSON ciphertext with `iv` and `value`, not readable JWT JSON.
- Email verification: create a new email/password account and try a write before clicking the email link. It should be blocked by app state, Edge Functions, and RLS.
- Rate limit: attempt login/signup 6 times with the same email within 15 minutes. The 6th attempt should show the app lockout message; Supabase may also return its own server-side rate-limit error.
- Breached password: after enabling Supabase leaked-password protection, try a known compromised password during signup. The client blocks obvious weak passwords, and Supabase should reject breached ones server-side.
