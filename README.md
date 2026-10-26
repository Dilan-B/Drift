# Drift

**Work for your scroll.** Drift is an iOS app that blocks the apps you choose
until you earn screen time by doing real things: a workout, a chapter, a chore.
You prove it with a photo or a short video, and an AI check approves it before
the time is credited.

[![Download on the App Store](https://img.shields.io/badge/App_Store-Download-0D96F6?logo=apple&logoColor=white)](https://apps.apple.com/app/drift-screentime/id6778215875)
· [Website](https://dilan-b.github.io/Drift/)

<!-- TODO: add 2–3 screenshots or GIFs here (task → proof → time earned → shield lifting). -->

## What it does

- **Earned screen time.** Finishing a task adds minutes to your balance. While
  the balance is empty, the apps you picked stay behind a Screen Time shield.
- **Proof, not honour.** Photo and video proof are judged server-side. A
  task-blind pass describes what's in the frame, then a text-only pass judges
  that description against the task, so the model can't "find" push-ups in a
  picture of a living room just because it was told to look for them.
- **Families.** Parents assign tasks, approve or reject proof, and set app
  policies on a child's device.
- **Lockbox.** Put the phone in an AR box and leave it there. Lift it and a
  countdown starts, driven by on-device motion detection.
- **Sleep guard.** Tap an NFC tag in another room before bed; in the morning
  Drift checks from motion history that the phone actually stayed there.
- **Widgets, Live Activities and Siri intents**, plus 20 languages.

## Architecture

```
┌────────────────────────────────┐        ┌────────────────────────────────────┐
│iOS app (Expo / React Native)   │        │Supabase                            │
│ Drift.jsx shell, JS/JSX        │──JWT──▶│ Edge Functions (Deno/TS)           │
│ Native modules (Swift):        │        │  verify-task, evaluate-task        │
│  ScreenTime, Lockbox,          │        │    -> OpenAI (server-side only)    │
│  SleepGuard                    │        │  revenuecat-webhook <- RevenueCat  │
└────────────────────────────────┘        │  family + push functions           │
                                          │ Postgres + RLS                     │
┌────────────────────────────────┐        │  is_pro(uuid): one entitlement     │
│Extensions (App Group)          │        │  definition for every caller       │
│ DriftMonitor: DeviceActivity   │        └────────────────────────────────────┘
│ DriftShield: shield UI         │
│ DriftWidgets                   │
└────────────────────────────────┘
```

A few decisions worth calling out:

- **The server is the only judge.** Every AI call and every subscription check
  happens in an edge function. The client bundle holds no OpenAI key, and any
  gating in the UI is cosmetic.
- **One definition of "Pro".** Entitlement comes from a live subscription, a
  redeemed code, a beta unlock, or a child seat under a paying parent. All of
  them are ORed in a single SQL function, `is_pro()`, which every edge
  function calls instead of re-implementing the check.
- **The webhook owns subscription state.** Only `revenuecat-webhook` (which
  authenticates every request) may write a subscription's active/expiry
  fields; a database trigger rejects writes from anywhere else.
- **Blocking survives the app being killed.** `DriftMonitor` is a
  DeviceActivityMonitor extension that iOS wakes on its own schedule, so the
  shield goes up even if Drift is force-quit or the phone is offline.
- **Soft delete everywhere.** A trigger refuses hard deletes on user data. The
  only exception is erasure (account deletion, COPPA child deletion,
  retention purge), which goes through dedicated functions that switch the
  guard off for their own transaction.
- **Battery-aware sensing.** Motion thresholds are evaluated in Swift, and
  only state transitions cross the bridge into JavaScript, so a still phone
  generates no traffic.

## Repository layout

| Path | What's there |
| --- | --- |
| `App.js`, `Drift.jsx`, `*.jsx` | App shell, screens and modals |
| `screenTime.js`, `blockedApps.js` | JS side of the Screen Time bridge |
| `ios/Drift/` | Native modules (Screen Time, Lockbox AR, Sleep Guard) |
| `ios/DriftMonitor`, `ios/DriftShield`, `ios/DriftWidgets` | App extensions |
| `supabase/functions/` | Edge functions |
| `supabase/admin/` | Annotated schema history (`schema_v*.sql`): explains *why* |
| `supabase/migrations/` | The migrations as applied |
| `i18n/` | Translation sources (`i18n/src/*.tsv`) and the build that emits JS, Swift and InfoPlist strings |
| `dashboard/` | Internal metrics page (Vercel) |
| `docs/` | Public website, served by GitHub Pages |

## Building it

You'll need a Mac with Xcode, Node, CocoaPods and your own Supabase project.
Screen Time features (shields, the app picker, the monitor extension) only work
on a real iPhone, not in the simulator or Expo Go.

```sh
npm install --legacy-peer-deps
cd ios && pod install && cd ..
cp .env.example .env               # Google OAuth client IDs
npx expo start --dev-client
```

Point `SUPABASE_URL` / `SUPABASE_ANON` in `supabase.js` at your own project.

Then build the `Drift` scheme from `ios/Drift.xcworkspace` in Xcode. On Xcode
27, `npx expo run:ios` can't find the simulator; build with `xcodebuild`
instead (see `CLAUDE.md` for the exact command).

The backend runs on Supabase: apply `supabase/migrations/` with
`supabase db push`, deploy the functions, and set `OPENAI_API_KEY`,
`OPENAI_MODEL` (must be vision-capable) and `REVENUECAT_WEBHOOK_SECRET` as
function secrets.

## Legal

[Privacy policy](PRIVACY_POLICY.md) · [Terms of use](TERMS_OF_USE.md)
