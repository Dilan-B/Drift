# Drift iOS/Xcode Testing Guide for Riaan

This guide is for everything that cannot be properly tested from Windows. Please run these tests on a Mac with Xcode and, for the Screen Time features, on a real iPhone. Expo Go is not enough for the native features in this app.

## Quick Summary

Use this order:

1. Pull the latest repo.
2. Install JS dependencies and iOS pods.
3. Open `ios/Drift.xcworkspace` in Xcode.
4. Verify signing, entitlements, App Group, URL schemes, background modes, and the `DriftMonitor` extension target.
5. Create/verify the Phase 2 native targets: `DriftWidgets` and `DriftIntents`.
6. Run a Debug build on a real iPhone.
7. Test auth, onboarding, Screen Time authorization, app picker, shielding, earned balance, force-quit behavior, extension-side notifications, Home Screen widget, Live Activity/Dynamic Island, Shortcuts/HealthKit earning, camera/photo permissions, AI checks, notifications, profile, social/challenges, and persistence.
8. Send back the completed report template at the end of this file.

## What Needs a Real iPhone

These are the main things Dilan cannot validate on Windows:

- Apple Screen Time APIs:
  - `FamilyControls` authorization
  - Apple's secure `FamilyActivityPicker`
  - `ManagedSettings` app/category/domain shields
  - `DeviceActivityMonitor` extension behavior while Drift is closed or force-quit
- App Groups shared storage between the main app and the `DriftMonitor` extension.
- iOS local notifications.
- Extension-side local notifications posted by `DriftMonitor` while Drift is closed.
- iOS Background App Refresh / BGTask registration.
- WidgetKit Home Screen widget.
- ActivityKit Live Activity and Dynamic Island for Drift In sessions.
- App Intents + Shortcuts + HealthKit step-count earning.
- Camera permission, photo library permission, and camera capture.
- VisionCamera + TFLite pose detection.
- Google OAuth / email verification deep links returning to the native app through `drift://auth-callback`.
- Sign in/session persistence through iOS secure storage.
- Xcode signing/provisioning/capabilities.

Do not mark Screen Time as tested if you only ran the simulator or Expo Go.

## Phase 2 Native Update

Phase 2 added app-side bridge code and source files for these native surfaces:

- Home Screen widget showing the current earned balance.
- Live Activity / Dynamic Island for Drift In sessions.
- Shortcuts/App Intent that reads HealthKit step count and writes pending earned time.
- Extension-side "Time's up" local notification from `DriftMonitor`.

Important: the Phase 2 source files are in the repo, but the `DriftWidgets` and `DriftIntents` Xcode extension targets still need to be created/verified in Xcode before those features can be fully tested. Use `docs/PHASE_2_NATIVE_TARGETS.md` as the build companion for this guide.

## Repo and Build Setup

From Terminal on the Mac:

```bash
cd ~/Desktop
git clone <repo-url> Drift
cd Drift
npm install --legacy-peer-deps
cd ios
pod install
cd ..
```

If the repo is already cloned:

```bash
cd ~/Desktop/Drift
git pull
npm install --legacy-peer-deps
cd ios
pod install
cd ..
```

Start Metro for the dev client:

```bash
npx expo start --dev-client --clear
```

In a separate Terminal window, open Xcode:

```bash
open ios/Drift.xcworkspace
```

Important: open the `.xcworkspace`, not the `.xcodeproj`, because CocoaPods are required.

## Xcode Build Instructions

In Xcode:

1. Select the `Drift` scheme.
2. Select a real connected iPhone as the run destination.
3. Use an iPhone on iOS 16 or newer. Newer is better.
4. Press `Cmd + Shift + K` to clean the build folder.
5. Press `Cmd + B` to build.
6. Press `Cmd + R` to run.

If Xcode asks whether to trust the developer app on the iPhone:

1. On the iPhone, open Settings.
2. Go to General > VPN & Device Management.
3. Trust the developer profile.
4. Run again from Xcode.

Keep the Xcode debug console open while testing. If a native issue happens, copy the first red error and the first stack trace, not just the final message.

## Critical Xcode Preflight Checks

Before testing app behavior, check these Xcode settings. These are common causes of "works in JS, fails on device" problems.

### Main App Target: `Drift`

Open the `Drift` project, select the `Drift` target, then check Signing & Capabilities.

Required:

- Team: the Apple Developer team that owns the identifiers.
- Bundle Identifier: should match the real Apple Developer App ID used for this build.
- Family Controls capability: enabled.
- App Groups capability: enabled.
- App Group value: `group.com.sanghani.drift.shared`
- Sign In with Apple capability: enabled if Apple sign-in is being tested or shipped.
- Background Modes:
  - Background fetch
  - Background processing

Also check Info:

- Camera usage description exists.
- Photo library usage description exists.
- Microphone usage description exists because VisionCamera may require it.
- Motion usage description exists.
- `NSSupportsLiveActivities` is present and true.
- URL scheme `drift` exists, because auth uses `drift://auth-callback`.

Important mismatch to verify: `app.json` currently says the iOS bundle identifier is `com.drift.app`, but the generated Xcode project currently shows `com.sanghani.drift` for the main app and `com.sanghani.drift.DriftMonitor` for the extension. Do not guess which one is right. Confirm the intended Apple Developer identifiers and make Xcode, Apple Developer, App Groups, OAuth redirects, and Supabase redirect URLs all agree.

### Extension Target: `DriftMonitor`

Select the `DriftMonitor` target.

Required:

- Bundle Identifier: should be the main app bundle identifier plus `.DriftMonitor`, or whatever exact extension identifier exists in Apple Developer.
- Family Controls capability: enabled.
- App Groups capability: enabled.
- App Group value: exactly `group.com.sanghani.drift.shared`.
- The extension is embedded in the main app target under Build Phases > Embed Foundation Extensions.
- `ios/DriftMonitor/Info.plist` has extension point `com.apple.deviceactivity.monitor-extension`.

The App Group must match exactly in:

- `ios/Drift/Drift.entitlements`
- `ios/DriftMonitor/DriftMonitor.entitlements`
- `ios/Drift/ScreenTimeModule.swift`
- `ios/DriftMonitor/DriftMonitor.swift`
- Apple Developer portal
- Xcode Signing & Capabilities

If one character differs, the main app and extension will not share selected apps or balance state.

### Phase 2 Target: `DriftWidgets`

This target may not exist until Riaan creates it in Xcode.

Create or verify it:

1. In Xcode, open `ios/Drift.xcworkspace`.
2. File > New > Target > Widget Extension.
3. Product Name: `DriftWidgets`.
4. Include Configuration Intent: off.
5. Bundle Identifier: main app bundle identifier plus `.DriftWidgets`, unless Apple Developer already has a different approved identifier.
6. Add App Groups capability.
7. App Group value: exactly `group.com.sanghani.drift.shared`.
8. Add these files to the `DriftWidgets` target membership:
   - `ios/DriftPhase2/Shared/DriftPhase2Shared.swift`
   - `ios/DriftPhase2/DriftWidgets/DriftWidgetBundle.swift`
   - `ios/DriftPhase2/DriftWidgets/DriftBalanceWidget.swift`
   - `ios/DriftPhase2/DriftWidgets/DriftInLiveActivityWidget.swift`
   - `ios/DriftPhase2/DriftWidgets/Info.plist`
   - `ios/DriftPhase2/DriftWidgets/DriftWidgets.entitlements`
9. Confirm `DriftPhase2Shared.swift` is also still included in the main `Drift` app target. The main app and widget extension both need `DriftInActivityAttributes`.

Required:

- WidgetKit extension point: `com.apple.widgetkit-extension`.
- App Groups capability.
- Same App Group as the main app.
- Live Activity widget compiles for iOS 16.1+.
- The main app has `NSSupportsLiveActivities` set to true.

### Phase 2 Target: `DriftIntents`

This target may not exist until Riaan creates it in Xcode.

Create or verify it:

1. File > New > Target > App Intents Extension.
2. Product Name: `DriftIntents`.
3. Bundle Identifier: main app bundle identifier plus `.DriftIntents`, unless Apple Developer already has a different approved identifier.
4. Add App Groups capability.
5. App Group value: exactly `group.com.sanghani.drift.shared`.
6. Add HealthKit capability.
7. Add these files to the `DriftIntents` target membership:
   - `ios/DriftPhase2/Shared/DriftPhase2Shared.swift`
   - `ios/DriftPhase2/DriftIntents/DriftEarnTimeIntent.swift`
   - `ios/DriftPhase2/DriftIntents/Info.plist`
   - `ios/DriftPhase2/DriftIntents/DriftIntents.entitlements`

Required:

- App Intents extension builds and embeds.
- HealthKit capability is enabled for the extension.
- `NSHealthShareUsageDescription` exists.
- App Group matches the main app and widget target.

### Phase 2 Bridge Methods

After the build runs on-device, confirm the custom native module includes these methods:

- `updateSharedBalance(seconds:)`
- `startDriftInLiveActivity(title:seconds:)`
- `updateDriftInLiveActivity(seconds:)`
- `endDriftInLiveActivity()`
- `consumePendingHealthEarn()`

If the app builds but any Phase 2 feature silently does nothing, check `ios/Drift/ScreenTimeModule.m` first. The Objective-C bridge must expose every Swift method to React Native.

## Optional EAS Build Path

If you are testing an installed internal build instead of running from Xcode:

```bash
npm install --legacy-peer-deps
npx eas build -p ios --profile development
```

Install the development build on the iPhone, then run:

```bash
npx expo start --dev-client --clear
```

Use Xcode for native debugging whenever Screen Time or the extension fails. EAS builds are useful for real-device install testing, but Xcode is better for build settings, logs, breakpoints, and extension debugging.

## Test Device Preparation

Use a disposable test account and a real iPhone.

Before starting:

1. Delete any existing Drift build from the phone.
2. Reboot the phone if previous Screen Time tests got stuck.
3. Confirm Screen Time is enabled in iOS Settings.
4. Confirm Background App Refresh is enabled:
   - Settings > General > Background App Refresh
   - Background App Refresh: On
   - Drift: On, if visible
5. Disable Low Power Mode for background tests.
6. Pick one obvious app to block, such as YouTube, Instagram, TikTok, Safari, or a Games category. Choose something installed and easy to open.
7. Keep another device nearby for timing long Screen Time tests.

## Test Result Format

For each test below, record:

- Result: Pass, Fail, Partial, or Blocked
- Device model:
- iOS version:
- Build source: Xcode Debug, EAS development, preview, or production
- Build date/commit:
- Steps actually taken:
- Expected result:
- Actual result:
- Screenshots or screen recording:
- Xcode console logs:
- Any iOS Settings screenshots for permissions/capabilities:

If something fails, try to capture:

- The alert text shown in Drift.
- Whether the native permission dialog appeared.
- Whether the issue happens after force-quitting Drift.
- Whether it happens after reboot.
- The exact selected app/category/domain used for blocking.
- Approximate timing. Example: "shield appeared after 16m 40s of YouTube."

## Build Smoke Test

### 1. Clean Build

Steps:

1. Open `ios/Drift.xcworkspace`.
2. Select real iPhone.
3. Clean build folder.
4. Build.
5. Run.

Expected:

- Build succeeds.
- App installs.
- App launches.
- No immediate native crash.
- Metro connects if using Debug/dev client.
- Xcode console does not show missing native module errors for `ScreenTimeModule`.
- If Phase 2 targets were created, `DriftWidgets.appex` and `DriftIntents.appex` build and embed without signing errors.

Fail if:

- Xcode signs the main app but not the extension.
- Xcode says Family Controls entitlement is missing.
- The extension cannot be embedded.
- App launches but JS says `ScreenTimeModule` is unavailable in a custom build.
- Phase 2 Swift files are not in the correct target membership.
- `DriftInActivityAttributes` is missing from either the main app or widget target.
- `NSSupportsLiveActivities` is missing from the main app Info.plist.

### 2. Cold Launch

Steps:

1. Force-quit Drift.
2. Launch Drift from the home screen.
3. Repeat once from Xcode.

Expected:

- Splash screen appears.
- App reaches onboarding or signed-in home.
- No blank white screen.
- No crash on startup.

## Authentication and Deep Link Tests

### 3. Email Sign Up

Steps:

1. Use a fresh test email.
2. Sign up with a valid username and password.
3. Confirm the app shows the verify-email state.
4. Tap "resend" once.
5. Open the latest verification email on the iPhone.
6. Tap the verification link.

Expected:

- Supabase sends the email.
- Tapping the verification link returns to Drift.
- Drift handles `drift://auth-callback`.
- User becomes signed in or can continue without manually restarting.
- Username/profile exists.

Important:

- If tapping the email opens Safari and never returns to Drift, check that the `drift` URL scheme exists in Xcode and that Supabase redirect URLs allow `drift://auth-callback`.

### 4. Email Sign In

Steps:

1. Sign out.
2. Sign in with the same email/password.
3. Force-quit Drift.
4. Relaunch.

Expected:

- Login succeeds.
- Session persists after relaunch.
- App does not get stuck on onboarding.

### 5. Google Sign-In

Only run this if Google client IDs are configured for this build.

Steps:

1. Tap "Sign in with Google" or "Sign up with Google".
2. Complete the Google browser flow.
3. Confirm the browser returns to Drift.
4. If a username setup modal appears, complete it.
5. Force-quit and relaunch.

Expected:

- Google flow opens.
- Redirect returns to Drift.
- Supabase session is created.
- Session persists.

Fail if:

- The button says Google is not configured.
- Redirect gets stuck in Safari.
- The app returns but no session is created.

### 5A. Sign in with Apple — RELEASE BLOCKER

App Review rejected 1.1.4 twice under Guideline 4.8 for this. `appleSignIn.js` was
fully written but its import in `OnboardingScreen.jsx` was commented out, so the
button never rendered and only Google was offered. We replied to Apple asserting we
had it, which is why it bounced a second time. **Do not submit without checking this.**

Steps:

1. Open the sign-up screen. Look at the social buttons.
2. Tap the black "Sign up with Apple" button.
3. Complete the Apple sheet (Face ID / password).
4. Choose "Hide My Email" on the first authorization.
5. If a username setup modal appears, complete it.
6. Force-quit and relaunch.
7. Sign out, then sign in again with Apple.

Expected:

- An Apple button is visible **above** the Google button on both sign-up and sign-in.
- The native Apple sheet appears (not a web view).
- A Supabase session is created and persists across a relaunch.
- Second sign-in works even though Apple returns no name/email that time.

Fail if:

- Only a Google button is present. ← this is the rejection; stop and report it
- The Apple button renders but nothing happens on tap.
- Signing in a second time fails or creates a duplicate account.

### 5B. Force-update gate does not fire on the current build — RELEASE BLOCKER

`app.json` declared `1.0.0` while the native build was `1.1.4`. The gate reads
`Constants.expoConfig.version` (from `app.json`, not the native settings), so every
install judged itself outdated and blocked behind `ForceUpdateModal`, which has no
dismiss. This locked the whole team out of TestFlight.

Steps:

1. Install the build and cold-launch it.
2. Background the app for 30 seconds, then foreground it (the check re-runs on foreground).

Expected:

- The app opens normally. No "Time to update Drift" screen at any point.

Fail if:

- The update screen appears. If it does, **the version numbers are out of sync again** —
  check `app.json`, `package.json`, and `MARKETING_VERSION` all read the same value.

To get past it while debugging: tap the sprout illustration **seven times** to reveal a
"Continue without updating (dev)" link. The override is keyed to the version it was
granted on, so it clears itself on the next update.

## Onboarding Tests

### 6. New User Onboarding

Steps:

1. Use a fresh account.
2. Complete onboarding normally.
3. When asked to pick apps to block, open the Apple Screen Time picker.
4. Select at least one app/category/domain.
5. Finish onboarding.

Expected:

- Onboarding is smooth.
- Screen Time permission prompt appears when needed.
- Apple's secure picker appears.
- Picker can be dismissed with Done.
- Drift continues after the picker.

### 7. Permission Denial During Onboarding

Steps:

1. On a fresh install, deny Screen Time access if prompted.
2. Continue onboarding.
3. Later open Profile > Screen Time access.

Expected:

- Drift does not crash.
- Drift shows a useful status.
- User can retry permission from Profile.

## Screen Time and App Blocking Tests

This is the highest-priority section.

### 8. Screen Time Authorization

Steps:

1. Open Profile.
2. Tap "Screen Time access".
3. Approve the iOS Screen Time permission.
4. Return to Profile.

Expected:

- iOS permission prompt appears.
- Profile row changes to Approved.
- No crash.

Then revoke it:

1. Open iOS Settings > Screen Time.
2. Disable Drift's access if visible.
3. Relaunch or foreground Drift.

Expected:

- Drift notices authorization is not approved.
- Drift prompts to re-enable access or shows status not approved.
- App does not claim blocking is active when permission is gone.

### 9. Apple Secure Picker

Steps:

1. Open Profile > Blocked apps.
2. Tap "Pick apps with Apple Screen Time".
3. Select one individual app.
4. Select one category.
5. Select one web domain if available.
6. Tap Done.
7. Reopen the picker.

Expected:

- Apple's picker opens.
- The app/category/domain selection is still selected after reopening.
- Drift itself does not display bundle IDs, which is expected.
- No crash when opening and closing repeatedly.

Fail if:

- Alert says Screen Time API unavailable in a custom build.
- Picker never appears.
- Picker appears but selection does not persist.

### 10. Immediate Shield at Zero Balance

Goal: prove `ManagedSettings` shielding works.

Steps:

1. Make sure a blocked app is selected.
2. Bring Drift balance to zero. Use a fresh account, reduce screen time to zero, or spend/drain the balance.
3. Open the selected blocked app.

Expected:

- iOS shows the Screen Time shield for the selected app/category/domain.
- Returning to Drift shows zero balance.
- No selected app should remain freely usable while balance is zero.

If it fails:

- Reopen Profile > Blocked apps and confirm selection is saved.
- Recheck Family Controls and App Group entitlements.
- Confirm Screen Time access is approved.

### 11. Shield Clears When Time Is Earned

Goal: prove Drift unlocks apps after a task earns time.

Steps:

1. Start from zero balance with a blocked app shielded.
2. Complete a normal task that grants minutes.
3. Return to the blocked app.

Expected:

- Balance increases in Drift.
- Selected blocked app becomes usable again.
- Drift starts iOS balance monitoring for the earned time.

### 12. Shield Returns When Balance Is Spent In-App

Steps:

1. Earn a small positive balance.
2. Use Drift's reduce/spend screen-time flow to spend the balance down to zero.
3. Open the selected blocked app.

Expected:

- Balance reaches zero.
- Shield is applied.
- Local "Time's up" notification may appear if notifications are allowed.

### 13. Force-Quit DeviceActivity Extension Test

Goal: prove `DriftMonitor` works when the main app is dead.

Important timing note: iOS Screen Time usage thresholds are coarse. Expect roughly 15-minute behavior, not second-perfect behavior.

Steps:

1. Select a blocked app in Profile > Blocked apps.
2. Earn at least 15 minutes of balance.
3. Confirm the selected app is unblocked.
4. Force-quit Drift from the app switcher.
5. Open the selected blocked app and actively use it.
6. Keep using it until after the threshold window has passed.
7. Do not reopen Drift during the test.
8. When the blocked app gets shielded, note the exact time.
9. Reopen Drift.

Expected:

- The selected app eventually becomes shielded even though Drift was force-quit.
- Reopening Drift shows the balance corrected down, ideally to zero.
- Drift does not resurrect the old balance from Supabase.

Capture:

- Start time.
- Balance before force-quit.
- Selected blocked app/category.
- Time shield appeared.
- Drift balance after reopening.
- Xcode/Console logs if available.

### 14. Reboot Recovery Test

Goal: prove Drift recovers after iOS drops active monitors.

Steps:

1. Select a blocked app.
2. Earn positive balance.
3. Confirm blocked app is unblocked.
4. Reboot the iPhone.
5. Launch Drift.
6. Open the blocked app.

Expected:

- Drift does not crash after reboot.
- Drift rechecks native diagnostics on foreground.
- If there is positive balance and no active monitor, Drift re-arms monitoring.
- Blocked app remains usable while balance is positive.
- When balance returns to zero, shield applies.

### 15. App Group Persistence

Goal: prove the main app and extension share the same selection/state.

Steps:

1. Pick blocked apps.
2. Force-quit Drift.
3. Reopen Drift.
4. Reopen Profile > Blocked apps.
5. Trigger zero-balance shield.

Expected:

- Selection persists after force-quit.
- Shield uses the same selected apps.
- Extension behavior does not look like it has "forgotten" the selection.

Likely cause if this fails:

- App Group mismatch between app target, extension target, Swift constants, and Apple Developer portal.

## Drift In Focus Session Tests

### 16. Start Drift In With No Selected Apps

Steps:

1. Clear or skip blocked app selection if possible.
2. Start a Drift In session.

Expected:

- Drift warns that no apps are selected.
- Session can still run.
- App does not crash.

### 17. Start Drift In With Selected Apps

Steps:

1. Select at least one blocked app.
2. Start a Drift In session.
3. Open the selected blocked app.
4. Return to Drift and end the session.
5. Open the selected blocked app again.

Expected:

- During Drift In, selected apps are shielded.
- After ending Drift In, shield clears or balance-based behavior resumes correctly.
- Ending Drift In does not permanently leave apps blocked if the user has positive balance.

## Blocked Hours Tests

This may require Pro/subscription access or beta override.

### 18. Blocked Hours Setup

Steps:

1. Open Profile > Blocked hours.
2. Create a blocked window that includes the current time.
3. Save.
4. Open a selected blocked app.

Expected:

- Drift treats blocked hours as forced zero balance.
- Selected blocked apps are shielded during the window.
- Outside the window, normal balance rules resume.

### 19. Overnight Blocked Hours

Steps:

1. Create a blocked window like 10:00 PM to 7:00 AM.
2. Test while current time is inside that window, or temporarily use a short window that crosses the hour.

Expected:

- Overnight ranges work.
- No off-by-one bug around midnight.

## Notifications Tests

### 20. Notification Permission

Steps:

1. Fresh install or reset notification permission.
2. Launch Drift.
3. Accept notification permission when prompted.

Expected:

- iOS prompt appears.
- Drift continues whether permission is accepted or denied.

### 21. Out-of-Time Notification

Steps:

1. Allow notifications.
2. Earn positive balance.
3. Spend or reduce balance to zero while Drift is active.

Expected:

- "Time's up" notification/banner appears.
- It appears even if Drift is foregrounded.

### 22. Low-Time Notification

Steps:

1. Allow notifications.
2. Start with more than two minutes balance.
3. Spend/drain down below about two minutes while Drift is active.

Expected:

- "Running low" notification/banner appears once around the threshold.

### 23. Daily Reminder

Steps:

1. Allow notifications.
2. Confirm a daily reminder is scheduled after app launch.
3. If practical, temporarily adjust the schedule in a test build or wait until the scheduled time.

Expected:

- Daily reminder appears.
- Duplicate daily reminders are not stacked repeatedly across launches.

### 23A. Extension-Side Out-of-Time Notification

Goal: prove `DriftMonitor` can post "Time's up" while Drift is closed.

Steps:

1. Allow notifications for Drift.
2. Select at least one blocked app.
3. Earn at least 15 minutes of balance.
4. Confirm selected apps are unblocked.
5. Force-quit Drift.
6. Use the selected blocked app until the DeviceActivity threshold or failsafe fires.
7. Do not reopen Drift until either the shield appears or the test times out.

Expected:

- Selected app becomes shielded.
- A local notification appears with title `Time's up`.
- Notification body says the user is out of earned time and should complete a task to unlock apps.
- Reopening Drift shows zero/corrected balance.

Fail if:

- Shield appears but no notification appears, while notification permission is granted.
- Notification appears only after reopening Drift.
- Duplicate notifications spam repeatedly for the same depletion event.

## Background Refresh Tests

### 24. Background Registration

Steps:

1. Enable Background App Refresh in iOS Settings.
2. Launch Drift.
3. Watch the Xcode console during startup.
4. Background/foreground the app a few times.

Expected:

- No registration crash.
- No BGTaskScheduler identifier error.
- App works whether iOS grants background refresh or restricts it.

### 25. Background Reconcile

This is opportunistic and cannot be perfectly forced. Treat it as a best-effort test.

Steps:

1. Earn balance.
2. Use blocked app enough for the extension to deplete or record usage while Drift is closed.
3. Later foreground Drift.

Expected:

- Drift consumes native usage/depleted flags.
- Local balance is corrected.
- Supabase balance is not stale after foregrounding.

## Phase 2 Native Surface Tests

Run these only after the `DriftWidgets` and `DriftIntents` targets build successfully. These are all real-device tests.

### P2-1. Home Screen Widget Appears

Goal: prove the WidgetKit target is installed and reading shared App Group state.

Steps:

1. Build and run Drift on the iPhone.
2. Sign in.
3. Earn a known balance, such as 10 minutes.
4. Go to the iPhone Home Screen.
5. Long-press the Home Screen and add the Drift Balance widget.
6. Test both supported sizes if available:
   - small
   - medium
7. Wait up to 15 minutes or force a widget refresh by removing/re-adding it if needed.

Expected:

- Drift widget is available in the widget gallery.
- Widget shows the same earned balance, rounded/formatted as minutes or hours/minutes.
- Zero balance says something like "earn to unlock".
- Positive balance says "earned time".
- Widget does not show stale placeholder data after the app has written a balance.

Fail if:

- Drift does not appear in the widget gallery.
- Widget always shows the placeholder `25m`.
- Widget shows zero while Drift has a positive balance.
- Widget only works if Drift is open, then goes stale forever.

Capture:

- Screenshot of Drift balance.
- Screenshot of widget immediately after adding.
- Screenshot after earning/spending time.

### P2-2. Shared Balance Updates

Goal: prove `updateSharedBalance(seconds:)` writes every balance change into App Group storage for widgets.

Steps:

1. Start with zero balance.
2. Add/complete a task to earn time.
3. Check the Home Screen widget.
4. Spend or reduce balance.
5. Check the Home Screen widget again.
6. Force-quit Drift and check whether the widget keeps the latest value.

Expected:

- Widget eventually reflects earned time.
- Widget eventually reflects spent/reduced time.
- Force-quitting Drift does not erase widget state.

Likely causes if this fails:

- App Group mismatch.
- `DriftWidgets` target does not include `DriftPhase2Shared.swift`.
- Main app target is not calling/exposing `updateSharedBalance`.

### P2-3. Drift In Live Activity on Lock Screen

Goal: prove ActivityKit starts, updates, and ends from the Drift In flow.

Requirements:

- iOS 16.1 or newer.
- Live Activities enabled in iOS Settings.
- Main app Info.plist has `NSSupportsLiveActivities = true`.
- `DriftWidgets` target is created and embedded.

Steps:

1. Open Drift.
2. Start a Drift In session.
3. Lock the iPhone.
4. Watch the Lock Screen.
5. Let the timer run for at least 30 seconds.
6. Return to Drift and complete or abandon the session.
7. Lock the iPhone again.

Expected:

- Live Activity appears on the Lock Screen.
- It shows the Drift In title/task.
- Remaining time updates.
- Progress changes over time.
- Activity ends after collect/complete/abandon.
- No old Live Activity remains stuck after the session ends.

Fail if:

- No Live Activity appears even though Live Activities are enabled.
- It starts but never updates.
- It remains stuck after the session ends.
- Starting a second Drift In session leaves multiple stale activities.

### P2-4. Dynamic Island

Run this only on an iPhone model with Dynamic Island.

Steps:

1. Start a Drift In session.
2. Leave Drift while the session is active.
3. Observe compact Dynamic Island.
4. Long-press Dynamic Island to expand it.
5. Return to Drift and end the session.

Expected:

- Compact leading view shows `D`.
- Compact trailing view shows remaining minutes.
- Expanded view shows "Drift In", remaining time, and progress.
- Dynamic Island disappears or resolves after the session ends.

If the test phone does not have Dynamic Island, mark this as Blocked and still test the Lock Screen Live Activity.

### P2-5. Live Activity Permission Disabled

Steps:

1. Disable Live Activities for Drift in iOS Settings if the setting appears.
2. Start a Drift In session.
3. Watch Xcode logs.
4. Re-enable Live Activities and try again.

Expected:

- Drift In session still works inside the app.
- App does not crash when `startDriftInLiveActivity` returns disabled/unavailable.
- After re-enabling, Live Activity starts normally.

### P2-6. Shortcuts/App Intent Appears

Goal: prove the `DriftIntents` extension is installed and discoverable.

Steps:

1. Build and run Drift with `DriftIntents` target embedded.
2. Open the iOS Shortcuts app.
3. Create a new Shortcut.
4. Search for Drift.
5. Find `Earn Drift Time From Steps`.

Expected:

- Drift action appears in Shortcuts.
- Action exposes parameters:
   - Step Goal
   - Minutes To Earn
- Running the action prompts for Health permission if not already granted.

Fail if:

- Drift action does not appear.
- Shortcut appears but crashes immediately.
- Health permission text is missing.

### P2-7. HealthKit Step Goal Below Threshold

Steps:

1. In Shortcuts, run `Earn Drift Time From Steps`.
2. Set Step Goal higher than today's actual step count.
3. Set Minutes To Earn to a small value, such as 1 or 5.
4. Run the Shortcut.

Expected:

- Shortcut reads today's step count.
- It reports the current steps and says the goal has not been reached.
- It does not add pending earned time.
- Opening Drift does not increase balance.

### P2-8. HealthKit Step Goal Earns Pending Time

Steps:

1. In Shortcuts, run `Earn Drift Time From Steps`.
2. Set Step Goal lower than today's actual step count.
3. Set Minutes To Earn to a clear value, such as 10.
4. Run the Shortcut.
5. Do not open Drift yet.
6. Then open or foreground Drift.

Expected:

- Shortcut says the minutes are ready to claim in Drift.
- Opening/foregrounding Drift claims the pending earned seconds.
- Drift balance increases by the configured minutes.
- Server/profile balance syncs so relaunch does not lose the earned time.
- The pending earn is consumed once and does not apply repeatedly on every launch.

Capture:

- Shortcut result dialog.
- Drift balance before opening.
- Drift balance after opening.
- Result after force-quitting and reopening Drift again.

### P2-9. Health Permission Denied

Steps:

1. Revoke Health permission for Drift/Shortcuts if possible.
2. Run the Drift Shortcuts action.
3. Deny Health permission when prompted.

Expected:

- Shortcut fails gracefully or reports that Health access is unavailable/denied.
- Drift does not crash.
- No pending earned time is created.

### P2-10. Phase 2 App Group Cross-Target Check

Goal: prove all Phase 2 targets share the same App Group.

Steps:

1. Main app earns balance.
2. Widget reads the balance.
3. Shortcut writes pending earned time.
4. Main app consumes pending earned time.
5. Start Drift In and verify Live Activity uses the same shared activity attributes.

Expected:

- Widget, main app, Live Activity, and App Intent all agree on state.
- No feature behaves like it has a separate empty store.

Likely cause if this fails:

- One of `Drift`, `DriftMonitor`, `DriftWidgets`, or `DriftIntents` is missing `group.com.sanghani.drift.shared`.

## Camera, Photo, and AI Verification Tests

### 26. AI Check With Text Proof

Steps:

1. Open a task that supports AI Check.
2. Enter text proof only.
3. Submit.

Expected:

- Loading state appears.
- Supabase Edge Function responds.
- Verified result lets the user claim credits.
- Not verified result lets the user try again.
- Subscription/paywall and rate-limit responses are shown clearly if applicable.

### 27. AI Check With Camera Photo

Steps:

1. Open AI Check.
2. Tap Take Photo.
3. Grant camera permission.
4. Take a photo.
5. Submit.

Expected:

- Camera permission prompt appears.
- Captured photo previews in the modal.
- Image is resized/compressed.
- Submit succeeds or fails with a useful message.

### 28. AI Check With Photo Library Upload

Steps:

1. Open AI Check.
2. Tap Upload.
3. Grant photo library permission.
4. Pick a photo.
5. Remove the photo.
6. Pick another photo.
7. Submit.

Expected:

- Photo library permission works.
- Preview appears.
- Remove works.
- Large photo does not crash the app.

### 29. Denied Camera/Photo Permission

Steps:

1. Deny camera permission.
2. Try Take Photo again.
3. Deny photo permission.
4. Try Upload again.

Expected:

- Drift shows permission denied messages.
- App does not crash.
- User can recover through iOS Settings.

## Pose Detection Tests

### 30. VisionCamera and MoveNet Load

Steps:

1. Find a challenge/exercise flow that opens `PoseCamera`.
2. Choose one of these pose-counted exercises:
   - pushups
   - dips
   - squats
   - lunges
   - situps
   - burpees
   - jacks
3. Grant camera permission.
4. Wait for the model to load.

Expected:

- Front camera opens.
- No native crash.
- MoveNet model loads from `assets/movenet.tflite`.
- Skeleton overlay appears when a body is visible.
- HUD shows metric/phase.

### 31. Rep Counting

Steps:

1. Test at least three exercises:
   - squats
   - pushups
   - jumping jacks
2. Perform slow, clear reps.
3. Try bad framing and then good framing.

Expected:

- Reps count only after down/up phases.
- Counter does not jump wildly.
- App gives useful visual feedback.
- Bad lighting/framing may reduce accuracy, but should not crash.

Capture:

- Screen recording for each exercise.
- Whether front camera mirroring affects the overlay.
- Approximate false positives/false negatives.

## Task, Balance, and Persistence Tests

### 32. Add/Complete/Delete Task

Steps:

1. Add a normal task.
2. Complete it.
3. Confirm XP and balance increase.
4. Delete another task.
5. Relaunch Drift.

Expected:

- Task appears immediately.
- Completion persists.
- Deleted task disappears from UI.
- Relaunch restores from Supabase/cache correctly.
- Balance is not duplicated by relaunching.

### 33. Offline Task Flow

Steps:

1. Sign in while online.
2. Turn on Airplane Mode.
3. Add and complete a task.
4. Force-quit and relaunch.
5. Turn network back on.
6. Relaunch/foreground and wait.

Expected:

- UI remains usable offline where possible.
- Local cache restores.
- When online, data syncs back to Supabase.
- No duplicate credit entries or impossible balance jumps.

### 34. Balance Does Not Resurrect

Steps:

1. Earn balance.
2. Drain or reduce it to zero.
3. Force-quit.
4. Relaunch.
5. Sign out and sign back in.

Expected:

- Balance stays zero after relaunch/sign-in.
- Server state does not restore an older positive balance.

## Profile Tests

### 35. Avatar Photo

Steps:

1. Open Profile.
2. Tap avatar/photo control.
3. Pick image from library if supported.
4. Save.
5. Relaunch.

Expected:

- Photo permission works.
- Upload succeeds if Supabase storage is configured.
- Avatar persists.
- If storage is missing, app shows the setup error instead of crashing.

### 36. Username Change

Steps:

1. Change username to a valid unused username.
2. Try an invalid username.
3. Try a known taken username.

Expected:

- Valid username saves.
- Invalid format is rejected.
- Taken username is rejected.
- Profile updates across relaunch.

### 37. Legal and Feedback Links

Steps:

1. Open Profile.
2. Tap feedback.
3. Tap privacy and terms.

Expected:

- Mail app opens for feedback.
- Legal links open correctly.
- Returning to Drift works.

### 38. Delete Account

Only use a disposable account.

Steps:

1. Open Profile.
2. Tap Delete account.
3. Confirm.

Expected:

- Supabase `delete-account` function runs.
- User is signed out.
- Account data is anonymized/soft-deleted according to server behavior.
- The app does not crash or remain signed in.

## Social and Challenge Tests

Use two test accounts on two devices if possible. If only one iPhone is available, sign in/out between two accounts, but note that realtime behavior is harder to test.

### 39. Friend Request

Steps:

1. Account A searches for Account B by username.
2. Send friend request.
3. Account B accepts.
4. Both accounts refresh/reopen Social.

Expected:

- Request appears.
- Accept works.
- Both users see each other as friends.
- Today's screen time appears.

### 40. Challenge Send/Accept/Decline

Steps:

1. Account A challenges Account B.
2. Account B accepts one challenge.
3. Account B declines another.
4. Account A cancels an outgoing challenge.

Expected:

- Challenge appears in realtime or after refresh.
- Accept/decline/cancel states are correct.
- Cancel is soft-delete/cancelled in behavior, not a hard crash.

### 41. Challenge Completion

Steps:

1. Send a challenge requiring completion.
2. Complete it manually or through AI Check if required.
3. Confirm winner/outcome.
4. Check both accounts' XP/balance impacts.

Expected:

- Completion updates both sides.
- Winner/outcome modal appears.
- Penalty/reward minutes are correct.
- Past challenges list updates.

## Paywall, Pro, and Gating Tests

> ⚠️ **SKIP tests 42 and 43 — they are obsolete.** All payments were removed and
> every feature is free (see the "payments removed" note in `Drift.jsx`; `PaywallScreen`
> and `useSubscription` are no longer wired into the shell). There is no paywall to
> open, so "paywall opens instead of broken feature" can no longer pass. Report these
> as N/A rather than failures. The RevenueCat machinery is dormant but still present,
> which is why App Review still applies subscription rules to the listing.

### 42. Free Account Gating

Steps:

1. Use a non-Pro test account.
2. Try Pro-gated features:
   - AI Check if gated
   - challenges if gated
   - blocked hours
   - recurring tasks

Expected:

- Paywall opens instead of broken feature.
- Free user cannot bypass premium gates.
- App messaging is clear.

### 43. Pro/Beta Account

Steps:

1. Use an account marked Pro or beta if available.
2. Open the same gated features.

Expected:

- Pro features open.
- No incorrect paywall.
- Server state remains the source of truth.

## iOS Settings Recovery Tests

### 44. Toggle Permissions After Install

Steps:

1. Deny or revoke Camera.
2. Deny or revoke Photos.
3. Deny or revoke Notifications.
4. Revoke Screen Time access.
5. Return to Drift and retry each feature.

Expected:

- Drift gives recoverable errors.
- No crash.
- Opening iOS Settings from alerts works where offered.

### 45. Delete and Reinstall

Steps:

1. Delete Drift from the iPhone.
2. Reinstall from Xcode.
3. Sign in.

Expected:

- User data restores from Supabase.
- Device-local Screen Time app selection may need to be picked again; note what actually happens.
- SecureStore session from old install should not cause stale-token crashes.

## Debugging Native Screen Time Issues

If blocking does not work, check in this order:

1. Real iPhone, not simulator.
2. Custom dev/standalone build, not Expo Go.
3. iOS 16 or newer.
4. Screen Time access approved in iOS Settings.
5. Family Controls entitlement enabled for the main app identifier.
6. Family Controls entitlement enabled for the extension identifier.
7. App Group enabled for both identifiers.
8. App Group string exactly `group.com.sanghani.drift.shared`.
9. `DriftMonitor.appex` is embedded in the main app.
10. The selected blocked app/category/domain was actually picked in Apple's picker.
11. Main app and extension bundle IDs match the Apple Developer portal.
12. Xcode build used the expected provisioning profiles.

Useful files:

- `ios/Drift/ScreenTimeModule.swift`
- `ios/Drift/ScreenTimeModule.m`
- `ios/DriftMonitor/DriftMonitor.swift`
- `ios/DriftPhase2/Shared/DriftPhase2Shared.swift`
- `ios/DriftPhase2/DriftWidgets/DriftWidgetBundle.swift`
- `ios/DriftPhase2/DriftWidgets/DriftBalanceWidget.swift`
- `ios/DriftPhase2/DriftWidgets/DriftInLiveActivityWidget.swift`
- `ios/DriftPhase2/DriftIntents/DriftEarnTimeIntent.swift`
- `ios/Drift/Drift.entitlements`
- `ios/DriftMonitor/DriftMonitor.entitlements`
- `ios/DriftPhase2/DriftWidgets/DriftWidgets.entitlements`
- `ios/DriftPhase2/DriftIntents/DriftIntents.entitlements`
- `screenTime.js`
- `blockedApps.js`
- `backgroundRefresh.js`
- `Drift.jsx`

Useful Xcode breakpoints:

- `ScreenTimeModule.requestAuthorization`
- `ScreenTimeModule.presentFamilyActivityPicker`
- `ScreenTimeModule.applyShield`
- `ScreenTimeModule.clearShield`
- `ScreenTimeModule.startBalanceMonitoring`
- `ScreenTimeModule.updateSharedBalance`
- `ScreenTimeModule.consumePendingHealthEarn`
- `ScreenTimeModule.startDriftInLiveActivity`
- `ScreenTimeModule.updateDriftInLiveActivity`
- `ScreenTimeModule.endDriftInLiveActivity`
- `ScreenTimeModule.getDiagnostics`
- `DriftMonitor.eventDidReachThreshold`
- `DriftMonitor.intervalDidStart`
- `DriftMonitor.intervalDidEnd`
- `DriftMonitor.notifyOutOfTime`
- `DriftEarnFromStepsIntent.perform`

Useful Console.app filters while the phone is connected:

- Process contains `Drift`
- Process contains `DriftMonitor`
- Process contains `DriftWidgets`
- Process contains `DriftIntents`
- Message contains `DeviceActivity`
- Message contains `ManagedSettings`
- Message contains `FamilyControls`
- Message contains `ActivityKit`
- Message contains `WidgetKit`
- Message contains `AppIntents`
- Message contains `HealthKit`

If `DriftMonitor.eventDidReachThreshold` never fires:

- Use at least a 15-minute earned balance test.
- Keep using the selected app actively.
- Do not reopen Drift during the force-quit test.
- Confirm Low Power Mode is off.
- Confirm the selected app is covered by the FamilyActivityPicker selection.
- Confirm the extension target has the same App Group.

If the widget does not appear or always shows placeholder data:

- Confirm `DriftWidgets` exists as a Widget Extension target.
- Confirm `DriftWidgetBundle.swift` is the widget target entry point.
- Confirm all widget files have `DriftWidgets` target membership.
- Confirm `DriftPhase2Shared.swift` is included in both the main app and widget targets.
- Confirm the widget target has App Groups enabled with `group.com.sanghani.drift.shared`.
- Earn/spend balance in Drift, then remove and re-add the widget to force a fresh snapshot.

If Live Activity does not appear:

- Confirm iOS is 16.1 or newer.
- Confirm Live Activities are enabled for Drift in iOS Settings.
- Confirm `NSSupportsLiveActivities` is true in the main app Info.plist.
- Confirm `DriftInLiveActivityWidget.swift` is in the `DriftWidgets` target.
- Confirm `DriftPhase2Shared.swift` is in both main app and widget targets.
- Check whether `startDriftInLiveActivity` returns `disabled`, `unavailable`, or `live_activity_error`.

If the Shortcut/App Intent does not appear:

- Confirm `DriftIntents` exists as an App Intents Extension target.
- Confirm `DriftEarnTimeIntent.swift` has `DriftIntents` target membership.
- Confirm the extension has HealthKit and App Groups capabilities.
- Confirm `NSHealthShareUsageDescription` exists.
- Rebuild, reinstall, then reopen the Shortcuts app.

## Known Timing Expectations

Screen Time enforcement is not a stopwatch. Apple does not reliably fire thresholds below about 15 minutes. For short QA tests, use zero-balance shielding or Drift In to verify immediate shielding. For extension tests, use a 15+ minute balance and write down the actual time it takes.

Expected behavior by scenario:

- Balance is zero: selected apps should be shielded.
- Balance is positive: selected apps should be unshielded while iOS monitors usage.
- Drift In active: selected apps should be shielded regardless of balance.
- Blocked hours active: selected apps should be shielded regardless of balance.
- Drift force-quit with positive balance: iOS extension should eventually shield after the usage threshold.
- DriftMonitor depletion: selected apps should shield and an extension-side "Time's up" notification should appear if notifications are allowed.
- Screen Time permission revoked: Drift should stop claiming it can enforce blocking and should ask for access again.
- Widget balance: Home Screen widget should eventually mirror App Group balance written by Drift.
- Drift In Live Activity: Lock Screen/Dynamic Island should start, update, and end with the session.
- Health/Shortcuts earning: Shortcut writes pending earned seconds; Drift claims them once on launch/foreground.

## Final Report Template

Send this back after testing.

```text
Tester:
Date:
Commit tested:
Build source: Xcode Debug / EAS development / preview / production
Mac model:
Xcode version:
iPhone model:
iOS version:
Apple Developer team:
Main app bundle ID:
DriftMonitor extension bundle ID:
Widget extension bundle ID:
App Intents extension bundle ID:
App Group:

Overall result:

Build:
- Clean build:
- Install/run:
- Native module available:

Signing/capabilities:
- Main Family Controls:
- Extension Family Controls:
- Main App Group:
- Extension App Group:
- DriftMonitor embedded:
- DriftWidgets target exists/embedded:
- DriftWidgets App Group:
- DriftIntents target exists/embedded:
- DriftIntents App Group:
- DriftIntents HealthKit:
- URL scheme drift:
- Background modes:
- Live Activities support:

Auth:
- Email signup:
- Email verification deep link:
- Email sign in:
- Google sign in:
- Session persistence:

Screen Time:
- Authorization prompt:
- Authorization revoke/retry:
- Apple picker:
- Selection persistence:
- Zero-balance shield:
- Earned-time shield clear:
- Spend-to-zero shield return:
- Force-quit DeviceActivity test:
- Reboot recovery:
- App Group persistence:

Focus/blocked hours:
- Drift In no selected apps:
- Drift In selected apps:
- Blocked hours current window:
- Overnight blocked hours:

Notifications:
- Permission:
- Out-of-time:
- Extension-side out-of-time:
- Low-time:
- Daily reminder:

Phase 2:
- Widget appears in gallery:
- Widget balance matches Drift:
- Widget updates after earn/spend:
- Live Activity Lock Screen starts:
- Live Activity updates:
- Live Activity ends:
- Dynamic Island compact/expanded:
- Shortcut action appears:
- Shortcut below-goal result:
- Shortcut successful earn:
- Health permission denied path:
- Pending health earn consumed once:

Camera/AI:
- Text proof:
- Take photo:
- Upload photo:
- Denied permissions:

Pose detection:
- Camera opens:
- Model loads:
- Skeleton overlay:
- Rep counting:

Tasks/persistence:
- Add/complete/delete:
- Offline flow:
- Balance does not resurrect:

Profile:
- Avatar:
- Username:
- Feedback/legal links:
- Delete disposable account:

Social/challenges:
- Friend request:
- Challenge send/accept/decline:
- Challenge completion:

Paywall/Pro:
- Free gating:
- Pro/beta access:

Failures:
1.
2.
3.

Screenshots/recordings attached:

Xcode logs attached:

Notes:
```
