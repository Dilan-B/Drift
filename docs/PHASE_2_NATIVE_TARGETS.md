# Drift Phase 2 Native Targets

Phase 2 adds the iOS-native surfaces that need Xcode on a Mac:

- Home Screen widget showing earned balance.
- Live Activity / Dynamic Island for Drift-In sessions.
- Shortcuts + HealthKit intent for step-goal earning.
- Extension-side "time's up" local notification from `DriftMonitor`.

The app-side bridge and source files are now in the repo, but the new extension
targets still need to be created in Xcode.

## App-Side Code Already Added

- `ios/Drift/ScreenTimeModule.swift`
  - `updateSharedBalance(seconds:)`
  - `startDriftInLiveActivity(title:seconds:)`
  - `updateDriftInLiveActivity(seconds:)`
  - `endDriftInLiveActivity()`
  - `consumePendingHealthEarn()`
- `screenTime.js`
  - JS wrappers for those native methods.
- `Drift.jsx`
  - Syncs current balance to App Group storage.
  - Starts/updates/ends the Drift-In Live Activity.
  - Claims pending Health/Shortcuts earned seconds on launch/foreground.
- `ios/DriftMonitor/DriftMonitor.swift`
  - Posts a local "Time's up" notification when the extension depletes balance.

## Create Widget Extension Target

In Xcode:

1. Open `ios/Drift.xcworkspace`.
2. File -> New -> Target -> Widget Extension.
3. Product Name: `DriftWidgets`.
4. Include Configuration Intent: off.
5. Bundle identifier: main app bundle + `.DriftWidgets`.
6. Add App Groups capability with `group.com.sanghani.drift.shared`.
7. Add the following files to the `DriftWidgets` target:
   - `ios/DriftPhase2/Shared/DriftPhase2Shared.swift`
   - `ios/DriftPhase2/DriftWidgets/DriftWidgetBundle.swift`
   - `ios/DriftPhase2/DriftWidgets/DriftBalanceWidget.swift`
   - `ios/DriftPhase2/DriftWidgets/DriftInLiveActivityWidget.swift`
   - `ios/DriftPhase2/DriftWidgets/Info.plist`
   - `ios/DriftPhase2/DriftWidgets/DriftWidgets.entitlements`
8. Confirm `NSSupportsLiveActivities` is present in the main app `Info.plist`.

Important: `ios/DriftPhase2/Shared/DriftPhase2Shared.swift` is also registered
with the main app target so ActivityKit uses the same attributes on both sides.

## Create App Intents Extension Target

In Xcode:

1. File -> New -> Target -> App Intents Extension.
2. Product Name: `DriftIntents`.
3. Bundle identifier: main app bundle + `.DriftIntents`.
4. Add App Groups capability with `group.com.sanghani.drift.shared`.
5. Add HealthKit capability.
6. Add these files to the `DriftIntents` target:
   - `ios/DriftPhase2/Shared/DriftPhase2Shared.swift`
   - `ios/DriftPhase2/DriftIntents/DriftEarnTimeIntent.swift`
   - `ios/DriftPhase2/DriftIntents/Info.plist`
   - `ios/DriftPhase2/DriftIntents/DriftIntents.entitlements`

The intent writes pending earned seconds into the App Group. The main app
claims them on launch/foreground through `consumePendingHealthEarn()`, then
syncs `profiles.balance_seconds`.

## Main App Capabilities

Confirm these on the `Drift` target:

- App Groups: `group.com.sanghani.drift.shared`
- Live Activities capability, if shown by Xcode for the selected SDK/account.
- HealthKit is only required on the App Intents extension unless the main app
  later reads HealthKit directly.

## Test Checklist

Use a real iPhone.

1. Build and run the app from Xcode.
2. Earn any balance and verify the Home Screen widget shows the same minutes.
3. Start a Drift-In session and verify:
   - Live Activity appears on Lock Screen.
   - Dynamic Island/compact view updates once per second.
   - Activity ends after collect/abandon.
4. Spend balance while Drift is closed until the monitor fires.
   - Apps shield.
   - Local "Time's up" notification appears.
5. Run the Shortcut/App Intent after meeting a step goal.
   - It writes pending earned time.
   - Opening Drift claims it and updates the balance/server snapshot.

## Known Constraints

- These files cannot be fully verified from Windows.
- WidgetKit, ActivityKit, AppIntents, HealthKit, App Groups, and extension
  embedding must be validated in Xcode with the correct Apple Developer team.
- If the bundle identifier mismatch noted in `docs/RIAAN_XCODE_TESTING.md`
  still exists, resolve that before adding the new targets.
