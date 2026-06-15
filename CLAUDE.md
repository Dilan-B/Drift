# Drift

Expo / React Native productivity app. You earn screen-time by completing tasks; a Screen Time shield blocks chosen apps until you've earned time.

## Stack
- Expo SDK + React Native (JS/JSX, not TS). Entry: `App.js` → `Drift.jsx` (main shell, ~4k lines).
- Supabase: auth, Postgres (RLS), Edge Functions (Deno/TS) in `supabase/functions/*`, admin SQL in `supabase/admin/*`.
- Stripe subscriptions via edge functions. OpenAI calls are server-only (never in the client bundle).
- iOS Screen Time (Family Controls / ManagedSettings) via native `screenTime.js` bridge — only works in a dev/standalone build, not Expo Go.

## Conventions
- Secrets live in Supabase secrets or a gitignored `.env` (`EXPO_PUBLIC_*` only for non-sensitive keys). Never hardcode keys; never log tokens/bodies/PII.
- All AI + subscription gating is enforced server-side in edge functions. Client checks are UX-only.
- Data persistence is soft-delete only; never hard-delete user rows.
- Deliver SQL changes as a full file for the user to paste into the Supabase SQL editor (their Windows CLI is flaky).

## Key files
- `Drift.jsx` — app shell, screen-time timer, modals, tab nav
- `useSubscription.js`, `useBetaMode.js` — entitlement state (server is source of truth)
- `blockedApps.js` / `screenTime.js` — app-blocking bridge
- `Anim.jsx` — animation toolkit (origin-grow panels, Pop, etc.)
- `supabase/admin/schema_v*.sql` — run in order in the SQL editor

## ECC
Global security guardrails load from `~/.claude/rules/`. Skills are available on demand.
