# Drift — Security Review

## What's protected and how

### Authentication (Supabase Auth)
- ✅ Passwords stored as bcrypt hashes by Supabase, never plaintext.
- ✅ Session tokens stored in `AsyncStorage` via the official Supabase adapter (replaces in-memory default).
- ✅ Token auto-refresh enabled — short-lived JWTs.
- ✅ Email + password are validated and sanitized client-side before submission (sanity check only — server still validates).
- ✅ Password requires 8+ chars, at least one letter and one digit, max 72 chars (bcrypt limit).
- ✅ Generic error messages prevent account enumeration (we never confirm or deny whether an email is registered).
- ✅ Client-side rate limit: 5 attempts per minute per device. Supabase enforces server-side limits too.
- ✅ Username chosen by user at signup, validated for shape + uniqueness, enforced at DB level via unique index.

### OAuth (Apple + Google)
- ✅ **Apple Sign-In uses a cryptographic nonce** — random nonce generated client-side, SHA-256 hash sent to Apple, raw nonce sent to Supabase. Apple's signed token must contain hash(rawNonce). Blocks replay attacks.
- ✅ **Google Sign-In uses PKCE** via `expo-auth-session`. Code verifier never leaves the device. No client secret in the app bundle.
- ✅ **All ID tokens validated against provider public keys** by Supabase Auth before any session is issued.
- ✅ **OAuth client secrets stay server-side** in Supabase config — never compiled into the app.
- ✅ **OAuth account linking** only allowed when the email is verified (Supabase default).
- ✅ **First-time OAuth users get a placeholder username** from the DB trigger, then are prompted to choose a real one. Cannot bypass the prompt by manipulating local state — the modal is driven by the actual `profiles.username` server value.
- ✅ **No raw OAuth tokens persisted or logged** anywhere — only the Supabase session JWT is stored, via the official adapter.

### Database (Row Level Security)
- ✅ RLS enabled on every table.
- ✅ `profiles`: users can only `UPDATE` their own row; reads are public (for usernames).
- ✅ `screen_time`: users can only modify their own rows.
- ✅ `friendships`: only the participants can read/write.
- ✅ `ai_check_usage`: users can only read their own usage rows.
- ✅ Profile row created via `auth.users` trigger (server-side), not user input — prevents id spoofing.

### Edge Functions (server-side gates)
- ✅ Every function requires a valid JWT (`supabase.auth.getUser()`).
- ✅ `verify-task` + `evaluate-task` check `profiles.sub_active` BEFORE calling OpenAI — clients cannot bypass subscription gate.
- ✅ Rate limits: 5/hour, 20/day for `verify-task`; 30/hour, 200/day for `evaluate-task`.
- ✅ Input validation: task title ≤ 200 chars; proof text ≤ 1000; image ≤ 375 KB base64; duration clamped to [1, 720] minutes.
- ✅ Output sanitization: stripping markdown code fences, validating JSON shape before sending back.
- ✅ `stripe-webhook` verifies Stripe's HMAC signature before trusting any event.
- ✅ Service-role key only available inside edge functions (never in client bundle).

### Secrets management
- ✅ OpenAI key → Supabase secret (`OPENAI_API_KEY`)
- ✅ Stripe secret → Supabase secret (`STRIPE_SECRET_KEY`)
- ✅ Stripe webhook secret → Supabase secret (`STRIPE_WEBHOOK_SECRET`)
- ✅ `.env` is gitignored
- ✅ `EXPO_PUBLIC_OPENAI_KEY` exists only as a dev fallback — production builds should remove it.

### Subscription enforcement
- ✅ `sub_active` on `profiles` is the single source of truth.
- ✅ Only the Stripe webhook (with verified signature) can flip the flag.
- ✅ App reads via `useSubscription` hook with real-time channel — instant update after upgrade.
- ✅ AI buttons display a paywall prompt when `sub_active = false`.

### Privacy
- ✅ Photo proofs are sent to OpenAI Vision and not stored anywhere by Drift.
- ✅ AI Check responses are not logged (only the timestamp is stored, for rate limiting).
- ✅ User email visible only in the user's own profile sheet.

---

## Known limitations / TODOs

| # | Item | Note |
|---|------|------|
| 1 | App blocking is not active in Expo Go | Storage + UI work, but actual blocking requires a custom native module on iOS/Android. See `blockedApps.js`. |
| 2 | Direct OpenAI dev fallback | `EXPO_PUBLIC_OPENAI_KEY` lets dev builds work without deploying edge functions. **Must remove for prod release** — set `allowDirect: false` in `aiEvaluate.js` callers and delete the env var. |
| 3 | Email confirmation | Currently disabled in Supabase. Turn it on (Auth → Settings → "Confirm email") for production. |
| 4 | Account deletion | No GDPR-style "delete my data" flow yet. Add one before launch. |
| 5 | Stripe Customer Portal | Users currently have to email support to cancel. Add a portal session edge function. |

---

## Vulnerabilities fixed in this commit

1. **`SUPABASE_URL` was `…/rest/v1/`** which broke every request with "invalid path specified in request URL". Now just the project host.
2. **Sessions weren't persisted** — `AsyncStorage` adapter not configured. Sessions were lost on app close.
3. **Account enumeration** — error messages used to leak whether an email was registered. Now generic.
4. **No rate limit on auth attempts.** Added client-side throttle (server-side already exists).
5. **Weak password rule** (`>= 6` chars). Now 8+ chars, must include letters and a digit.
6. **Profile row inserted from client.** Now created server-side via `auth.users` trigger — clients cannot spoof a profile.
7. **No subscription check on AI edge functions** — anyone with a valid JWT could call them. Now gated by `sub_active`.
8. **Direct OpenAI fallback was always on** — could let users bypass the paywall. Now requires explicit `allowDirect: true`, only used in dev mode.
9. **`Demo` mode** populated arbitrary credits client-side — removed entirely.
