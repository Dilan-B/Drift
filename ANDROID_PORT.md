# Android port — status and what's left

Branch: `feat/android-port`. Nothing here touches the iOS app: `ios/` is
byte-identical to `main` (verified by tree hash before and after prebuild), and
every `app.json` addition is scoped under the `android` key.

This is **Phase 0** — get Drift building, installing and running on Android, and
find out what actually breaks. It is not a shippable Android release; see
"Before you can ship" below.

---

## The decision this port does NOT make

**Android has no Family Controls.** There is no API that lets a third-party app
tell the OS to shield other apps. That is Drift's core mechanic, so "port Drift
to Android" is a product question before it is an engineering one.

What competitors actually do on Android is a foreground service polling
`UsageStatsManager` (or an `AccessibilityService` for faster detection) plus
`SYSTEM_ALERT_WINDOW` to throw a full-screen overlay over the blocked app. That
is a real Kotlin project, and it is weaker than the iOS shield — the user can
kill the service, and OEM battery managers (Xiaomi, Samsung, Oppo) will do it
for them. The AccessibilityService route is more reliable and is also the single
biggest Play Store rejection risk there is: Google restricts accessibility APIs
to accessibility purposes and has removed blocker apps over it.

Three coherent answers:

- **A. Full parity.** Build the UsageStats + overlay blocker. ~4–8 weeks of
  native Kotlin, with policy risk on the main feature.
- **B. Ship without the shield.** Tasks, Drift In, Lockbox, streaks and social
  all work; blocking becomes an honour-mode nudge. Weaker product, no policy
  risk, and it tells you whether Android demand is real before you spend two
  months on the hard part.
- **C. Don't.** Stay iOS-only.

**This branch is built for B, structured so A drops in later.** No screen needed
changing to make that true — see "The seam" below.

---

## Two real bugs found on the way

Both were latent in `main`; neither is Android-specific.

### 1. `expo-constants` was four SDKs ahead of the project

`package.json` pinned `expo-constants@^57.0.8` against Expo SDK 54, which
expects `~18.0.14`. It happened to work on iOS. On Android it fails Kotlin
compilation outright — `expo-constants` 57 calls
`expo.modules.kotlin.services.ServiceInterface`, which does not exist in SDK
54's `expo-modules-core`.

Fixed to `~18.0.14`. All four APIs the app uses (`expoConfig`, `manifest`,
`appOwnership`, `statusBarHeight`) exist in both, so this is API-safe.

### 2. The force-update gate would have bricked every Android install

`Drift.jsx` check 2 read `app_config.min_ios_version` with **no platform
guard** — only checks 1 and 3 were iOS-gated. The moment anyone set
`min_ios_version` for an iOS hotfix, every Android install would compare
against it too and lock behind `ForceUpdateModal`, which has no dismiss,
pointed at an App Store URL it cannot install from.

That is the same class of lockout as the 2026-07-29 incident, arriving from a
config row rather than a stale `app.json`.

Every key is now per-store, selected by platform:

| iOS | Android |
|---|---|
| `min_ios_version` | `min_android_version` |
| `ios_store_url` | `android_store_url` |
| `min_ios_build` | `min_android_build` |
| `min_ios_build_version` | `min_android_build_version` |

iOS behaviour is unchanged — same keys, same order, same fail-open. The Android
keys do not exist in `app_config` yet, and every check no-ops on a missing key,
so **Android is inert by default**. `ForceUpdateModal` also no longer falls back
to `apps.apple.com` on Android.

Check 1 (the live App Store lookup) stays iOS-only: Google exposes no public
"latest version" endpoint, so `min_android_version` is Android's only gate.

---

## What changed

### Native project
- `android/` generated via `expo prebuild --platform android`. Committed, matching
  how `ios/` is handled.
- Builds clean. Debug APK installs and runs on an API 36 emulator.

### Icons — `tools/build-android-icons.js`
Android needs four icons iOS does not. All four are **derived from the single
iOS app icon** so there is one source of truth; re-run the script after changing
it, never hand-edit the PNGs.

The iOS icon is a bright glow on a flat dark squircle, which is what makes this
derivable: the black exterior floods away cleanly, and luminance doubles as an
alpha mask.

| Output | Why |
|---|---|
| `icon.png` | Legacy launcher icon + Play listing source |
| `adaptive-icon.png` | Foreground layer, inset to the 66% safe zone so launcher masking never clips the artwork |
| `notification-icon.png` | Android **discards colour and keeps only alpha** — a coloured icon here renders as a white blob |
| `monochrome-icon.png` | Android 13+ themed icons |

### Permissions
Declared: camera, internet, coarse/fine location, read calendar, read contacts,
read external storage, vibrate.

Explicitly blocked (`tools:node="remove"`, verified in the generated manifest):

| Blocked | Why |
|---|---|
| `ACCESS_BACKGROUND_LOCATION` | Needs a separate Google review with a demo video and is a common rejection. Places degrades to foreground-only. |
| `SYSTEM_ALERT_WINDOW` | "Display over other apps" — sensitive, and unused in plan B. **Phase A needs this back.** |
| `WRITE_EXTERNAL_STORAGE` | Pulled in by `expo-file-system`; nothing writes to shared storage |
| `RECORD_AUDIO` | Pulled in by vision-camera; Drift never records audio |
| `WRITE_CALENDAR` / `WRITE_CONTACTS` | Read-only by design, and the iOS permission copy promises exactly that |

`READ_EXTERNAL_STORAGE` is deliberately kept — `AICheckModal` and
`ProfileScreen` both call `requestMediaLibraryPermissionsAsync()`, which needs
it on API ≤ 32.

### Notification channels — `notifications.js`
Android 8+ posts nothing without a channel. `expo-notifications` would have
invented a single "Miscellaneous" bucket, which means muting the daily streak
nudge also mutes "your lockbox session is about to be lost".

Four channels, importance matched to urgency:

| Channel | Importance | Carries |
|---|---|---|
| `sessions` | MAX | Lockbox breach/lost/done, sleep guard. The breach warning is a ~5 second window — below MAX it cannot heads-up and is useless |
| `time` | HIGH | Out of time, running low |
| `reminders` | DEFAULT | Daily streak, bedtime |
| `social` | DEFAULT | Friend requests, challenges, approvals, leaderboard |

All silent (`sound: null`) — an app about focus should not make noise telling
you to stop looking at your phone.

**A channel's importance is fixed at creation.** Changing these values does
nothing on a device that already ran an older build.

### Subscriptions — `useSubscription.js`
RevenueCat issues one public key per store and they are not interchangeable.
Previously every non-iOS caller got `not_ios` and failed closed, so every
Android user would have hit a paywall they could not buy through.

Now platform-selected, reading `EXPO_PUBLIC_RC_ANDROID_KEY`. **Deliberately no
hardcoded Android fallback** — the comment at the top of that file records a
stale hardcoded key outliving its app and shipping silently in every build,
because a wrong key fails identically to a missing one except a missing one says
so. Until that env var is set, Android reports `no_key_android` and fails
closed, which is correct: better an unbuyable paywall than free Pro.

`redeemAppStoreCode` stays iOS-only — it is Apple's offer-code sheet, and Play
promo codes are redeemed in the Play Store app.

---

## The seam for Phase A

No screens need changing. `screenTime.js` already resolves every call to a safe
no-op off iOS, and the UI already degrades: `BlockedAppsModal` computes
`canBlock = isNativeBlockingAvailable()` and **skips the onboarding gate when
blocking is unavailable** rather than trapping the user. That Expo Go path is
the Android path.

To add the blocker later: implement the native module, make `isAvailable()`
true on Android, restore `SYSTEM_ALERT_WINDOW`, and the existing call sites
light up unchanged.

---

## Before you can ship

Console work I cannot do — all of it needs your accounts:

1. **Confirm the package name.** `com.drift.app` is permanent once published.
   Note iOS drifted to `com.sanghani.drift`; decide deliberately whether Android
   matches or keeps `com.drift.app`.
2. **Google Play Console** — $25 one-time. Data Safety form (you collect
   location, contacts, camera), privacy policy URL (`PRIVACY_POLICY.md` is
   already served via GitHub Pages). If this is a *personal* rather than
   organisation account, Google requires a closed-testing run with a minimum
   number of testers for 14 continuous days before production unlocks — verify
   current terms, they have changed twice.
3. **RevenueCat Android** — Play merchant account, products mirrored
   (`com.drift.pro.month`, `com.drift.pro.annual`, `drift_family_1..5`), 7-day
   trial on both solo products, Android API key into
   `EXPO_PUBLIC_RC_ANDROID_KEY`. The `revenuecat-webhook` edge function already
   handles both stores.
4. **Push** — upload an FCM V1 service-account JSON to EAS. Without it Android
   push is silently dead.
5. **Google sign-in** — create an Android OAuth client and register the SHA-1 of
   **both** the debug key and Play App Signing. `oauthSignIn.js` already reads
   `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`.

---

## Known gaps

- **Dependency drift still outstanding** (`npx expo install --check`):
  `expo`, `expo-file-system` (trivial patch drift), `react-native-webview`
  (ahead by a minor), and `react-native-get-random-values@2.0.0` where SDK 54
  expects `~1.11.0`. That last one is a **major** mismatch in the crypto
  polyfill Supabase auth relies on — the most likely next thing to break. Left
  alone deliberately: each of these also moves iOS, so they should be changed
  one at a time against a real device.
- `userInterfaceStyle: "light"` is ignored on Android without `expo-system-ui`.
  Not installed, to avoid adding a pod to the iOS dependency graph. The app's
  own theming is JS-driven, so this is cosmetic.
- **Status bar styling is inert on Android.** Edge-to-edge is forced by SDK 54 /
  Android 15, and under it the legacy `StatusBarModule` is ignored — Android
  logs `StatusBarModule: Ignored status bar change, current activity is
  edge-to-edge` once per render. So all 20 `<StatusBar barStyle>` calls in the
  app do nothing on Android, and the bar will not follow the in-app dark-mode
  toggle.

  In practice the emulator still showed correct contrast on both light and dark
  screens, so this is latent rather than currently visible — Android 15 appears
  to be applying automatic contrast.

  **`expo-status-bar` does not fix this** — it is documented as "built on top of
  the StatusBar component exported from React Native", so on Android it routes
  into the same ignored module. I tried a wrapper around it and reverted it,
  because it changed 30 lines and fixed nothing. The real fix is `SystemBars`
  from `react-native-edge-to-edge`, which is **not** currently installed (only
  the `react-native-is-edge-to-edge` detection helper is). Adding it means adding
  a native dependency that also lands in the iOS pod graph, which is why it is
  left for a decision rather than done here.
- Layout uses `StatusBar.currentHeight` for top inset and needs a real look on a
  device with a notch/punch-hole.
- Lockbox AR, sleep guard NFC, widgets/Live Activities and Siri intents are
  iOS-only and no-op cleanly. Android equivalents exist (ARCore, Android NFC,
  Glance) but are not built.

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
