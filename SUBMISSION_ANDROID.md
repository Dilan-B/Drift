# Submitting Drift to Google Play

Branch: `feat/android-port`. Companion to `ANDROID_PORT.md`, which covers how
the port works; this covers getting it onto the store.

**Status: a signed production AAB exists and is ready to upload.** The signing
key is done (§2.1). What remains is Play Console work, plus two things you can
ship without (§2.2, §2.3).

---

## 1. What's ready

| | |
|---|---|
| Builds | Debug and release both compile; release manifest verified to carry all four blocker permissions and all four components |
| App blocking | Built and verified on device, including after a reboot with Drift never opened |
| Store graphics | `store/android/play-icon-512.png`, `play-feature-graphic-1024x500.png`, 7 screenshots in `store/android/screenshots/` |
| Package | `com.drift.app`, versionCode 1, versionName 1.1.7 |

The screenshots are padded to 1200×2400. That is deliberate: Play rejects a
screenshot whose long side is more than **twice** the short side, and a raw
1080×2400 capture is 2.22. The padding uses each screen's own edge colour, so
it is invisible.

The feature graphic is composed from the app's real rendered typography —
Playfair for "Drift", DM Sans for the tagline — lifted off the onboarding
screen rather than re-set in a lookalike font.

---

## 2. What needs your accounts

### 2.1 Upload keystore — DONE

Generated on EAS on 2026-09-11 (`Build Credentials Yw5V2CBQIw`) and used to
sign a production AAB. Verified from the artifact itself: the certificate is
valid 2026-09-11 → 2054-01-27 and its DN is NOT
`CN=Android Debug, O=Android, C=US`, so it is genuinely the upload key rather
than the debug key the local Gradle build still uses. Google requires validity
past 2033; this clears it by two decades.

**Back it up.** Losing this key means never updating the app again:

```bash
npx eas-cli credentials --platform android
```

→ `production` → `Keystore` → Download, then store it somewhere durable. It is
held on EAS servers, not in this repo — and it must never be committed, since
this repo is public.

**Rebuild any time with:**

```bash
npx eas-cli build --platform android --profile production
```

`eas.json` is configured for an `app-bundle` with
`autoIncrement: "versionCode"`, so each build bumps the number for you.

### 2.2 Firebase / FCM — re-engagement pushes only

**Not a blocker, and not a migration.** FCM is the only transport that can wake
an Android device — Google's equivalent of APNs — so Supabase cannot deliver a
push on its own and neither can anyone else. You create a Firebase project
purely to obtain a credential, and use none of Firebase's products: no Auth, no
Firestore, no Storage, no Analytics. Supabase remains the entire backend, and
it is free.

Verified failing on device, on every launch:

```
registerForPushNotifications failed: Default FirebaseApp is not initialized
```

What actually depends on it is narrow. Drift sends exactly three things
remotely, all from the `send-scheduled-pushes` cron: `streak_reminder`,
`inactivity_nudge`, `daily_motivation`. Every time-critical notification — out
of time, running low, lockbox breach and loss, sleep guard, task approved,
friend requests, challenges — is a LOCAL notification and already works on
Android today. Shipping the first release without FCM costs retention, not
function, so this should not hold up a submission.

To do it (~15 minutes): Firebase console → new project → add an Android app
with package `com.drift.app` → download `google-services.json` to the repo
root → upload the **FCM V1 service-account JSON** to EAS (`eas credentials` →
Android → FCM V1) → rebuild.

**Add `googleServicesFile: "./google-services.json"` to `app.json` only at that
same moment** — prebuild hard-fails on a missing file. Tested.

### 2.3 RevenueCat Android — the paywall cannot be bought through

`EXPO_PUBLIC_RC_ANDROID_KEY` is unset, so `useSubscription` reports
`no_key_android` and fails closed. That is the correct failure, but it means
Android cannot take money yet. Needs a Play merchant account, the products
mirrored (`com.drift.pro.month`, `com.drift.pro.annual`,
`drift_family_1..5`), a 7-day trial on both solo products, and the Android key
into the env. The `revenuecat-webhook` edge function already handles both
stores.

---

## 2.5 Two things that bit on the first build

**EAS does not see your `.env`.** It is gitignored and not uploaded, so the
first build had every `EXPO_PUBLIC_*` undefined. `GOOGLE_WEB_CLIENT_ID` and
`GOOGLE_IOS_CLIENT_ID` are now set as plaintext EAS variables on production,
preview and development. Anything else the client needs at build time has to be
added the same way:

```bash
npx eas-cli env:create production --name NAME --value VALUE --visibility plaintext
```

**The upload archive was 1.0 GB** because `android/app/build` is 2.5 GB of
local Gradle output. `.easignore` now excludes it and the archive is 18.5 MB.
Note that `.easignore` REPLACES `.gitignore` for uploads rather than extending
it, which is why it repeats entries that look redundant.

---

## 2.6 Google sign-in on Android — order matters

Android needs its own OAuth client keyed to a SHA-1 fingerprint, and the
fingerprint that matters is **Play's, not yours**: Play App Signing re-signs
the app, so the upload key's fingerprint is not what Google validates against.
It does not exist until the first AAB has been uploaded.

1. Upload the AAB to internal testing
2. Play Console → **Setup → App integrity** → copy the **app signing key** SHA-1
3. Google Cloud Console → Credentials → **Create OAuth client ID → Android**,
   package `com.drift.app`, paste that SHA-1
4. Add the **upload key** SHA-1 to the same client too, so EAS
   internal-distribution APKs (which Play never re-signs) also work
5. `npx eas-cli env:create production --name EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID --value <id> --visibility plaintext`
6. Rebuild

Until then Google sign-in fails on Android and email/password works. Worth
knowing before you test the first build and assume it is broken.

---

## 3. Declarations the blocker forces

These are the parts of the submission most likely to draw review questions.
Budget time for them.

| Permission | What to say |
|---|---|
| `PACKAGE_USAGE_STATS` | Digital wellbeing. Drift reads which app is in the foreground so it can hold apps the user chose to block until they have earned screen time. |
| `SYSTEM_ALERT_WINDOW` | Required to show the block screen over a blocked app. Since Android 10 an app cannot start an activity from the background without it. |
| `FOREGROUND_SERVICE_SPECIAL_USE` | The subtype string is already in the manifest: "Enforces the user's own app-blocking schedule for digital wellbeing". |
| **`AccessibilityService`** | **The risky one.** Google restricts it to accessibility purposes, with a carve-out digital-wellbeing apps ship under. Needs a prominent in-app disclosure *before* sending the user to Settings, and a Play Console declaration. **Verify current policy yourself — it has changed more than once and my knowledge has a cutoff.** |

**Evidence for the accessibility declaration.** The service was enabled on a
device and Android reports it bound with exactly the scope it asks for:

```
Service[label=Drift, feedbackType[FEEDBACK_GENERIC], capabilities=0,
        eventTypes=TYPE_WINDOW_STATE_CHANGED, notificationTimeout=100]
```

`capabilities=0` means it requests **no** special capabilities — it cannot
retrieve window content, perform gestures, or observe input — and
`TYPE_WINDOW_STATE_CHANGED` is the only event type it receives. It reads one
field, the package name of the window that just opened. That is the narrowest
form the API allows, and it is worth quoting verbatim in the declaration.

The service is also **optional in the code**. If review pushes back, deleting
it from `modules/drift-blocker/.../AndroidManifest.xml` costs blocking latency
(up to ~1s instead of instant) and nothing else.

Not yet measured: the end-to-end latency improvement. Binding and scope are
verified; the instant-block path itself needs a logged-in session to exercise.

---

## 4. Data Safety form

Grounded in what the code actually does — each claim below was checked, not
assumed. Re-verify before you submit; you are the one signing it.

| Data | Collected | Shared | Notes |
|---|---|---|---|
| Email, username | Yes | No | Supabase auth |
| Task names & descriptions | Yes | **Yes** | Sent to OpenAI via the `evaluate-task` edge function for valuation |
| Proof photos / video | Yes | **Yes** | Sent as base64 to `verify-task` → OpenAI. **Processed, not stored** — only avatars go to Supabase storage |
| Avatar image | Yes | No | Supabase storage bucket `avatars` |
| Screen-time minutes | Yes | No | `screen_time` table; visible to accepted friends via RLS |
| Approximate + precise location | Yes | No | Foreground only. `ACCESS_BACKGROUND_LOCATION` is explicitly blocked |
| Contacts | Yes | No | **SHA-256 hashed on device before upload** (`contacts.js:72`); plain emails never leave the device |
| Calendar | **No** | No | Read-only, never uploaded. The permission is held only because expo-calendar's own gate demands READ+WRITE together |
| Purchase history | Yes | **Yes** | RevenueCat |
| Push token | Yes | No | Once FCM is configured |

Everything is in transit over HTTPS, and the account is deletable in-app
(Profile → Delete account) — both are Data Safety questions.

**Blocked-app selection never leaves the device.** It lives in
SharedPreferences only. Worth saying in the listing; it is a genuine privacy
advantage over competitors.

---

## 5. Listing copy

**Short description (80 max)**

> Earn your screen time by getting real things done.

**Full description** — draft; edit freely.

> Drift makes screen time something you earn.
>
> Pick the apps that eat your day. Until you have earned time, Drift holds
> them. Do a real task — the dishes, a run, an hour of study — and prove it,
> and your apps unlock.
>
> • **Earn, don't scroll.** Every task is worth screen time. Finish it and the
>   clock starts.
> • **Prove it.** An AI check asks for evidence, and a timer stops you claiming
>   a 15-minute task in 15 seconds.
> • **Lockbox.** Put the phone down and leave it. Pick it up early and the
>   session is forfeited.
> • **Drift In.** One task, full attention, for as long as you choose.
> • **The Grove.** Grow a tier, keep a streak, and see how your friends are
>   doing.
>
> Your blocked-app list stays on your device. Drift never uploads it.

**Category:** Productivity. **Content rating:** likely Everyone — complete the
questionnaire honestly; there is no user-generated content shown to others
beyond usernames.

---

## 6. Order of operations

1. Fix the keystore (§2.1) — nothing else can be uploaded first.
2. `google-services.json` + FCM (§2.2), then rebuild. Push is worth having in
   the first build rather than a later one.
3. RevenueCat Android (§2.3), or ship the first internal build knowing the
   paywall is a dead end and fix it before production.
4. Create the app in Play Console, fill Data Safety (§4) and the declarations
   (§3), upload the graphics from `store/android/`.
5. Upload to **internal testing** first. `eas.json` already submits to the
   `internal` track as a `draft`.
6. **Test on a physical device.** Nothing here has run on real hardware, and
   OEM battery managers are the single biggest unknown for the blocker.
7. Closed testing. If this is a *personal* rather than organisation account,
   Google requires a minimum tester count for 14 continuous days before
   production unlocks. Start it early — it is a calendar constraint, not a work
   one.

---

## 7. Also outstanding

- ~~`screen_time_updated_at` migration~~ — **applied 2026-09-11 and verified**:
  the PostgREST probe returns 200 where it returned 42703, the migration is
  recorded remotely, and the `syncScreenTime` warning is gone from the device
  logs. Screen-time sync works again on both platforms.
- Bump `versionName` if 1.1.7 is not what you want Android to launch as. iOS
  and Android version numbers do not have to match, and arguably should not.
- `Drift-changelog.xlsx` should get a row for the Android launch, per CLAUDE.md.
