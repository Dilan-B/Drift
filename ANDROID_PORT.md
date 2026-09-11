# Android port — status and what's left

Branch: `feat/android-port`. **iOS is untouched**: `git diff main...HEAD -- ios`
is empty, verified by tree hash before and after every prebuild, and every
`app.json` addition is scoped under the `android` key.

Drift builds, installs, runs, signs in, and **blocks apps** on Android.

---

## What was actually verified on a device

On an API 36 emulator, against the real Supabase backend:

- Onboarding, sign-in, and the full app shell (tabs, balance, tasks, profile)
- **App blocking, end to end:**
  - picked Chrome from the in-app picker → opening Chrome showed the shield
  - **back from the shield went to the launcher, not Chrome** — the block is not
    one tap of theatre
  - re-opening Chrome re-blocked
  - unchecking Chrome stopped the service and Chrome opened normally
  - **after a genuine device reboot, with Drift never opened, Chrome was still
    blocked**
- The permission walk, with both permissions revoked, and its deep link landing
  on `Settings$AppUsageAccessSettingsActivity`
- Release build: compiles, and the merged release manifest carries all four
  blocker permissions and all four components

Not verified: a physical device, any OEM skin, the optional accessibility
service, and the paywall (RevenueCat Android is not configured yet).

---

## Blocking on Android

Android has no Family Controls. Nothing lets a third-party app ask the OS to
shield another app, so Drift does it itself, in `modules/drift-blocker`.

### How it works

**Detect** which app is in front, then **cover** it.

| Piece | Role |
|---|---|
| `BlockerService` | Foreground service polling `UsageStatsManager` at 1Hz. The always-available path |
| `DriftAccessibilityService` | Optional. Fires on window-change events, so the shield lands with the app instead of up to a second later |
| `BlockerEngine` | The only place blocking decisions and balance accounting live, so the two detectors cannot disagree |
| `ShieldActivity` | A full activity, not a floating overlay — so the blocked app is actually paused by the OS rather than left playing underneath |
| `BootReceiver` | Restarts the watcher after reboot or app update |
| `BlockerPrefs` | SharedPreferences. The service is killable, so nothing may live only in memory |

It is built as a **local Expo module**, not as hand-written code inside
`android/`. That matters: `expo prebuild --clean` wipes `android/` entirely, and
this survives it. Verified by running exactly that.

### The interface is iOS's

`DriftBlockerModule` deliberately mirrors `ScreenTimeModule` — `applyShield`,
`clearShield`, `startBalanceMonitoring`, `consumeUsedSeconds`,
`consumeDepletedFlag`, `setAppearance`. `screenTime.js` branches on Android
first and leaves the iOS path textually untouched beneath it.

The result is that **no screen needed rewriting**. Drift In, blocked hours,
sleep guard and the balance reconcile all drive the Android blocker through the
same calls they already made.

Two things do not map:

- **`presentAppPicker`** — Apple ships a system sheet and hides the chosen
  bundle IDs. Android has no picker at all, so `AndroidBlockerModal` renders one
  from `PackageManager`, listing only apps with a launcher activity.
- **`applyShieldCategories`** — Android has no app categories. It collapses onto
  the ordinary shield, which means a free-tier user with nothing selected gets
  nothing blocked, where iOS would shield whole categories. Worth a product
  decision.

### The honest limits

This is weaker than the iOS shield and always will be:

- The user can force-stop Drift, or revoke either permission, and blocking stops
- OEM battery managers (Xiaomi, Samsung, Oppo) kill background services on their
  own initiative
- Detection without accessibility lags up to a second
- Two permissions must be granted by hand in Settings, which is real onboarding
  drop-off

The in-app copy says so rather than overselling it: *"Drift can't block apps as
firmly as an iPhone can — Android lets you stop it from Settings at any time.
It's here to make drifting cost something, not to make it impossible."*

---

## Three real bugs found on the way

All three were latent in `main` or would have shipped silently.

### 1. `expo-constants` was four SDKs ahead

Pinned `^57.0.8` against SDK 54, which expects `~18.0.14` — the only `expo-*`
dependency using a caret. iOS tolerated it; Android does not compile, because
that version calls `expo.modules.kotlin.services.ServiceInterface`, absent from
SDK 54's `expo-modules-core`. All four APIs the app uses exist in both versions.

### 2. The force-update gate would have bricked every Android install

`Drift.jsx` check 2 read `app_config.min_ios_version` with **no platform
guard**. Setting it for an iOS hotfix would have locked every Android install
behind `ForceUpdateModal` — which has no dismiss — pointed at an App Store URL
they cannot install from. Same class of lockout as 2026-07-29, arriving from a
config row.

Every key is now per-store (`min_android_version`, `android_store_url`,
`min_android_build`, `min_android_build_version`). iOS behaviour is unchanged,
and the Android keys do not exist yet, so Android is inert by default.

### 3. Blocking would have worked in dev and died in production

`SYSTEM_ALERT_WINDOW` was in `blockedPermissions` from when it looked unused.
React Native's **debug** manifest declares it independently for the dev overlay,
so the permission was present in every debug build and **stripped from
release** — `canDrawOverlays()` would have returned false forever, the shield
would never have launched, and the permission would not even have appeared in
Settings for the user to grant.

Caught by diffing the merged debug and release manifests, which is now worth
doing before any submission.

---

## Other changes

### Icons — `tools/build-android-icons.js`

Android needs four icons iOS does not, all derived from the one iOS app icon so
there is a single source of truth. Re-run after changing it; never hand-edit the
PNGs.

`notification-icon.png` is a white silhouette because **Android discards colour
and keeps only the alpha channel** — a coloured icon there renders as a white
blob. `adaptive-icon.png` is inset to the 66% safe zone so launcher masking
cannot clip the artwork.

### Notification channels

Android 8+ posts nothing without a channel, and `expo-notifications` would have
invented a single "Miscellaneous" bucket — so muting the daily streak nudge
would also mute "your lockbox session is about to be lost". Four channels now,
importance matched to urgency; the lockbox breach warning is a ~5 second window
and needs MAX or it cannot heads-up. All silent.

**Channel importance is fixed at creation** and cannot be tuned later on a
device that already ran an older build.

### Subscriptions

RevenueCat issues one public key per store. Every non-iOS caller previously got
`not_ios` and failed closed, so Android users would have hit an unbuyable
paywall. Now platform-selected via `EXPO_PUBLIC_RC_ANDROID_KEY`, with
deliberately no hardcoded fallback — a wrong key fails identically to a missing
one, except a missing one says so.

### Permissions

Declared: camera, internet, coarse/fine location, read calendar, read contacts,
read external storage, vibrate, plus the four the blocker needs.

Blocked (`tools:node="remove"`, verified in the merged manifest):
`ACCESS_BACKGROUND_LOCATION` (separate Google review, common rejection),
`WRITE_EXTERNAL_STORAGE`, `RECORD_AUDIO`, `WRITE_CONTACTS`.

`WRITE_CALENDAR` was blocked too, until that turned out to break calendar sync
outright — expo-calendar gates on `hasGrantedPermissions(READ, WRITE)` and will
not accept READ alone. Drift still never writes to a calendar; it just has to
hold the permission. `WRITE_CONTACTS` stays blocked because expo-contacts
checks the manifest first and asks for READ alone when WRITE is absent.

`READ_EXTERNAL_STORAGE` is kept — `AICheckModal` and `ProfileScreen` both call
`requestMediaLibraryPermissionsAsync()`.

---

## Before you can ship

### Play Console declarations the blocker forces

These are new, and they are the part of the submission most likely to draw
questions:

1. **`AccessibilityService`.** Google restricts it to accessibility purposes,
   with a carve-out that digital-wellbeing apps ship under. Needs a prominent
   in-app disclosure before the user is sent to Settings, plus a Play Console
   declaration. **Verify current policy yourself — this has changed more than
   once.** It is optional in the code, so a rejection costs latency, not the
   feature; dropping the service entirely is a one-file change.
2. **`SYSTEM_ALERT_WINDOW`** — expect to justify "Display over other apps".
3. **Foreground service `specialUse`** — the subtype string in the manifest is
   shown to reviewers.
4. **`PACKAGE_USAGE_STATS`** — declare the digital-wellbeing purpose.

### Everything else

1. **Confirm the package name.** `com.drift.app` is permanent once published.
   iOS drifted to `com.sanghani.drift`; decide deliberately.
2. **A real upload keystore.** The release build is currently signed with the
   **debug** keystore — the Expo template default, which says `Caution!` in the
   generated `build.gradle`. Let EAS manage credentials, or generate one and
   never commit it (this repo is public).
3. **Play Console** — $25, Data Safety form (location, contacts, camera),
   privacy policy URL. A *personal* account also faces a closed-testing run with
   a minimum tester count for 14 continuous days before production unlocks.
4. **RevenueCat Android** — merchant account, products mirrored, 7-day trial,
   key into `EXPO_PUBLIC_RC_ANDROID_KEY`. The `revenuecat-webhook` edge function
   already handles both stores.
5. **Push** — upload an FCM V1 service-account JSON to EAS, or Android push is
   silently dead.
6. **Google sign-in** — Android OAuth client, SHA-1 of both the debug key and
   Play App Signing.

---

## Full-app pass, 2026-09-11

Every surface was walked on an API 36 emulator against the real backend.
Working: onboarding, sign-in, Today, add-task with AI valuation
(`evaluate-task`), the AI Check time gate, proof submission (`verify-task` —
correctly rejected text-only proof), the Android photo picker, Drift In,
Lockbox, The Grove (both tabs), the native share sheet, The Lab, blocked apps,
blocked hours with the native Android clock picker, and Profile.

Four bugs came out of it. Three are fixed and verified; one is written and
waiting on you.

1. **Lockbox paid out without checking the phone.** `startMonitoring()` threw
   and every caller swallowed it, `onStateChange()` was a no-op, so
   `markDisturbed()` — the only route to forfeiting — could never fire. Every
   session completed and paid in full. Fixed by porting iOS's motion sensing
   (`DriftMotionModule`); verified by injecting accelerometer values and
   watching a session go to "Session lost".
2. **Blocking `WRITE_CALENDAR` broke calendar sync.** expo-calendar gates on
   `hasGrantedPermissions(READ, WRITE)` — both — so the toggle silently
   reverted. Unblocked; `WRITE_CONTACTS` stays blocked because expo-contacts
   checks the manifest first and asks for READ alone.
3. **`screen_time.updated_at` never existed**, so every sync after the first of
   each day failed on BOTH platforms. schema_v7 declared it inside a
   `create table if not exists` on a table that already existed. Migration
   written, **not applied** — see SUBMISSION_ANDROID.md §7.
4. **Push registration fails** — no Firebase/FCM configured. Caught and logged
   rather than crashing. See SUBMISSION_ANDROID.md §2.2.

## Known gaps

- **Never run on a physical device or an OEM skin.** Emulator only. Battery
  managers are the biggest unknown; a Doze / battery-optimisation exemption
  prompt is probably needed and is not implemented.
- **The accessibility service is written but was never switched on and tested.**
  The polling path is what has actually been exercised.
- **Live rep detection (vision-camera + pose) was never exercised.** It is only
  reachable through a rep challenge from a friend. `poseCameraAvailable()`
  degrades to the AI photo check when the native module fails to load, so the
  failure mode is safe, but whether live tracking actually runs on Android is
  unknown.
- **The paywall was never exercised**, because RevenueCat Android is not
  configured. It fails closed.
- **Status bar styling is inert on Android.** Edge-to-edge is forced by SDK 54,
  and the legacy `StatusBarModule` is ignored under it, so all 20
  `<StatusBar barStyle>` calls do nothing and the bar will not follow the in-app
  dark-mode toggle. `expo-status-bar` does **not** fix this — it is built on the
  same RN component. The real fix is `SystemBars` from `react-native-edge-to-edge`,
  which is not installed and would add a native dependency to the iOS pod graph.
  Latent rather than visible: Android 15 appears to apply automatic contrast.
- **Dependency drift**: `expo`, `expo-file-system` (patch), `react-native-webview`
  (a minor ahead). `react-native-get-random-values@2.0.0` is flagged by
  `expo install --check` but was **verified working on device** — a runtime probe
  showed `crypto.getRandomValues` returning real entropy, and the one
  `randomUUID` call in `Drift.jsx` uses `expo-crypto`, not the global. No
  downgrade needed.
- `userInterfaceStyle: "light"` is ignored without `expo-system-ui`; the app's
  own theming is JS-driven, so this is cosmetic.
- Lockbox AR, sleep guard NFC, widgets/Live Activities and Siri intents remain
  iOS-only and no-op cleanly.

## Building locally

Requires the Android SDK and JDK 17+.

```bash
npx expo prebuild --platform android --no-install
```

```bash
cd android && ./gradlew assembleDebug
```

For emulator iteration, restrict ABIs — it roughly quarters native build time:

```bash
cd android && ./gradlew assembleDebug -PreactNativeArchitectures=x86_64
```

Grant the blocker permissions without hand-driving Settings:

```bash
adb shell appops set com.drift.app android:get_usage_stats allow
```

```bash
adb shell appops set com.drift.app android:system_alert_window allow
```
