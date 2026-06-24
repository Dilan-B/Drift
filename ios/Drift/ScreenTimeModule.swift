//
// ScreenTimeModule.swift
// Drift — native bridge to Apple Screen Time (FamilyControls + ManagedSettings
// + DeviceActivity). Methods exposed to JS:
//
//   requestAuthorization()              -> "approved" | "denied" | "notDetermined"
//   getAuthorizationStatus()            -> string
//   presentFamilyActivityPicker()       -> void (Apple's secure app picker)
//   applyShield()                       -> void
//   clearShield()                       -> void
//   startBalanceMonitoring(seconds:N)   -> void  (iOS-enforced timer)
//   stopBalanceMonitoring()             -> void
//
// The user's selection (apps/categories/web domains) is persisted to the
// shared App Group's UserDefaults, so the DriftMonitor extension can read it
// even when the main app is force-quit.
//
import Foundation
import UIKit
import React

#if canImport(ActivityKit)
import ActivityKit
#endif

#if canImport(FamilyControls) && canImport(ManagedSettings)
import FamilyControls
import ManagedSettings
import DeviceActivity
import SwiftUI
import Combine

// Must match the extension exactly.
let DRIFT_APP_GROUP    = "group.com.sanghani.drift.shared"
let DRIFT_SELECTION_KEY = "drift_family_activity_selection"
let DRIFT_STORE_NAME_RAW = "driftFocus"
let DRIFT_SHARED_BALANCE_SECONDS_KEY = "drift_widget_balance_seconds"
let DRIFT_SHARED_BALANCE_UPDATED_AT_KEY = "drift_widget_balance_updated_at"
let DRIFT_SHARED_LAST_SESSION_TITLE_KEY = "drift_widget_last_session_title"

@available(iOS 16.0, *)
func driftStoreName() -> ManagedSettingsStore.Name { ManagedSettingsStore.Name(DRIFT_STORE_NAME_RAW) }

@available(iOS 16.0, *)
extension DeviceActivityName {
  static let driftBalance = Self("drift.balance")
  static let driftBalanceFailsafe = Self("drift.balance.failsafe")
}

@available(iOS 16.0, *)
extension DeviceActivityEvent.Name {
  static let balanceDepleted = Self("drift.balanceDepleted")
  static func balanceCheckpoint(_ seconds: Int) -> Self {
    Self("drift.balanceCheckpoint.\(seconds)")
  }
}

@available(iOS 16.0, *)
final class ScreenTimeSelectionStore: ObservableObject {
  static let shared = ScreenTimeSelectionStore()
  private var groupDefaults: UserDefaults? {
    UserDefaults(suiteName: DRIFT_APP_GROUP)
  }

  @Published var selection: FamilyActivitySelection = FamilyActivitySelection() {
    didSet { persist() }
  }

  init() { load() }

  private func load() {
    guard let data = groupDefaults?.data(forKey: DRIFT_SELECTION_KEY),
          let decoded = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
    else { return }
    selection = decoded
  }

  private func persist() {
    if let data = try? JSONEncoder().encode(selection) {
      groupDefaults?.set(data, forKey: DRIFT_SELECTION_KEY)
    }
  }
}

@available(iOS 16.0, *)
struct FamilyPickerView: View {
  @ObservedObject var store = ScreenTimeSelectionStore.shared
  var onDone: () -> Void

  var body: some View {
    NavigationView {
      FamilyActivityPicker(selection: $store.selection)
        .navigationTitle("Apps to block")
        .navigationBarItems(trailing: Button("Done", action: onDone))
    }
  }
}
#endif

@objc(ScreenTimeModule)
class ScreenTimeModule: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool { return true }

  @objc func constantsToExport() -> [AnyHashable: Any]! {
    return ["available": isAvailable()]
  }

  private func isAvailable() -> Bool {
    if #available(iOS 16.0, *) {
      #if canImport(FamilyControls)
      return true
      #else
      return false
      #endif
    }
    return false
  }

  // ── Authorization ───────────────────────────────────────────
  @objc(requestAuthorization:rejecter:)
  func requestAuthorization(_ resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
    #if canImport(FamilyControls)
    if #available(iOS 16.0, *) {
      Task {
        do {
          try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
          resolve(statusString(AuthorizationCenter.shared.authorizationStatus))
        } catch {
          reject("auth_error", error.localizedDescription, error)
        }
      }
      return
    }
    #endif
    reject("unavailable", "Screen Time API requires iOS 16+", nil)
  }

  @objc(getAuthorizationStatus:rejecter:)
  func getAuthorizationStatus(_ resolve: RCTPromiseResolveBlock,
                              rejecter reject: RCTPromiseRejectBlock) {
    #if canImport(FamilyControls)
    if #available(iOS 16.0, *) {
      resolve(statusString(AuthorizationCenter.shared.authorizationStatus))
      return
    }
    #endif
    resolve("unavailable")
  }

  // ── Picker ──────────────────────────────────────────────────
  @objc(presentFamilyActivityPicker:rejecter:)
  func presentFamilyActivityPicker(_ resolve: @escaping RCTPromiseResolveBlock,
                                   rejecter reject: @escaping RCTPromiseRejectBlock) {
    #if canImport(FamilyControls)
    if #available(iOS 16.0, *) {
      DispatchQueue.main.async {
        guard let root = Self.topViewController() else {
          reject("no_vc", "No root view controller", nil); return
        }
        let host = UIHostingController(rootView: FamilyPickerView(onDone: {
          root.dismiss(animated: true) { resolve(nil) }
        }))
        host.modalPresentationStyle = .formSheet
        root.present(host, animated: true, completion: nil)
      }
      return
    }
    #endif
    reject("unavailable", "Screen Time API requires iOS 16+", nil)
  }

  // ── Shield apply / clear ────────────────────────────────────
  @objc(applyShield:rejecter:)
  func applyShield(_ resolve: RCTPromiseResolveBlock,
                   rejecter reject: RCTPromiseRejectBlock) {
    #if canImport(FamilyControls) && canImport(ManagedSettings)
    if #available(iOS 16.0, *) {
      let selection = ScreenTimeSelectionStore.shared.selection
      let store = ManagedSettingsStore(named: driftStoreName())
      store.shield.applications = selection.applicationTokens.isEmpty
        ? nil : selection.applicationTokens
      store.shield.applicationCategories = selection.categoryTokens.isEmpty
        ? nil : .specific(selection.categoryTokens)
      store.shield.webDomains = selection.webDomainTokens.isEmpty
        ? nil : selection.webDomainTokens
      resolve(nil)
      return
    }
    #endif
    reject("unavailable", "Screen Time API requires iOS 16+", nil)
  }

  @objc(applyShieldCategories:rejecter:)
  func applyShieldCategories(_ resolve: RCTPromiseResolveBlock,
                             rejecter reject: RCTPromiseRejectBlock) {
    #if canImport(FamilyControls) && canImport(ManagedSettings)
    if #available(iOS 16.0, *) {
      let store = ManagedSettingsStore(named: driftStoreName())
      // Block social + entertainment categories (free tier)
      // Also apply any user-picked apps on top
      let selection = ScreenTimeSelectionStore.shared.selection
      store.shield.applications = selection.applicationTokens.isEmpty
        ? nil : selection.applicationTokens
      // Free tier: block ALL app categories. The user's specific picks
      // are applied on top. Messages, Phone, and system apps are excluded
      // by iOS automatically (Apple never shields essential system apps).
      store.shield.applicationCategories = .all(except: Set())
      store.shield.webDomains = selection.webDomainTokens.isEmpty
        ? nil : selection.webDomainTokens
      resolve(nil)
      return
    }
    #endif
    reject("unavailable", "Screen Time API requires iOS 16+", nil)
  }

  @objc(clearShield:rejecter:)
  func clearShield(_ resolve: RCTPromiseResolveBlock,
                   rejecter reject: RCTPromiseRejectBlock) {
    #if canImport(ManagedSettings)
    if #available(iOS 16.0, *) {
      let store = ManagedSettingsStore(named: driftStoreName())
      store.shield.applications = nil
      store.shield.applicationCategories = nil
      store.shield.webDomains = nil
      resolve(nil)
      return
    }
    #endif
    resolve(nil)
  }

  // ── DeviceActivityMonitor: iOS-enforced balance timer ───────
  // Tell iOS to count usage of the user's selected apps. After `minutes` of
  // usage, the extension fires and re-applies the shield. This works even
  // when Drift is force-quit.
  @objc(startBalanceMonitoring:resolver:rejecter:)
  func startBalanceMonitoring(_ seconds: NSNumber,
                              resolver resolve: RCTPromiseResolveBlock,
                              rejecter reject: RCTPromiseRejectBlock) {
    #if canImport(DeviceActivity) && canImport(FamilyControls)
    if #available(iOS 16.0, *) {
      let selection = ScreenTimeSelectionStore.shared.selection
      let appCount = selection.applicationTokens.count
      let catCount = selection.categoryTokens.count
      let webCount = selection.webDomainTokens.count
      if appCount == 0 && catCount == 0 && webCount == 0 {
        reject("no_selection", "No apps selected. Pick apps to block first.", nil)
        return
      }

      // Daily schedule: midnight → 11:59pm, repeating.
      let schedule = DeviceActivitySchedule(
        intervalStart: DateComponents(hour: 0,  minute: 0),
        intervalEnd:   DateComponents(hour: 23, minute: 59),
        repeats: true
      )

      // IMPORTANT — Apple constraint: DeviceActivityEvent thresholds below
      // ~15 minutes are NOT delivered by iOS. A second-level threshold
      // (the old `DateComponents(second: 5)`) never fired, which is why the
      // extension never woke and nothing was enforced when Drift was closed.
      //
      // We arm one usage event at the user's exact balance when it is above
      // Apple's minimum. For shorter balances, iOS may not deliver a usage
      // threshold, so we also arm a one-shot wall-clock failsafe that shields
      // at the deadline. That is stricter than usage-only counting, but it
      // prevents over-limit use while Drift is closed.
      let totalSec = max(60, seconds.intValue)
      let APPLE_MIN_THRESHOLD_MIN = 15
      let APPLE_MIN_THRESHOLD_SEC = APPLE_MIN_THRESHOLD_MIN * 60
      let balanceMin = Int(ceil(Double(totalSec) / 60.0))
      let thresholdMin = max(APPLE_MIN_THRESHOLD_MIN, balanceMin)
      let thresholdSec = max(APPLE_MIN_THRESHOLD_SEC, totalSec)
      let threshold = DateComponents(minute: thresholdSec / 60, second: thresholdSec % 60)
      let needsFailsafe = totalSec < APPLE_MIN_THRESHOLD_SEC

      var events: [DeviceActivityEvent.Name: DeviceActivityEvent] = [:]
      if totalSec > APPLE_MIN_THRESHOLD_SEC {
        var checkpointSec = APPLE_MIN_THRESHOLD_SEC
        while checkpointSec < totalSec {
          events[.balanceCheckpoint(checkpointSec)] = DeviceActivityEvent(
            applications: selection.applicationTokens,
            categories:   selection.categoryTokens,
            webDomains:   selection.webDomainTokens,
            threshold:    DateComponents(minute: checkpointSec / 60, second: checkpointSec % 60)
          )
          checkpointSec += APPLE_MIN_THRESHOLD_SEC
        }
      }
      events[.balanceDepleted] = DeviceActivityEvent(
        applications: selection.applicationTokens,
        categories:   selection.categoryTokens,
        webDomains:   selection.webDomainTokens,
        threshold:    threshold
      )

      let center = DeviceActivityCenter()
      // Always stop any existing monitor before restarting — DeviceActivity
      // doesn't replace events automatically.
      center.stopMonitoring([.driftBalance, .driftBalanceFailsafe])
      do {
        let defaults = UserDefaults(suiteName: DRIFT_APP_GROUP)
        defaults?.set(Self.localDayKey(), forKey: "drift_balance_armed_day")
        defaults?.set(totalSec, forKey: "drift_balance_armed_seconds")
        defaults?.set(thresholdMin, forKey: "drift_balance_threshold_min")
        defaults?.set(thresholdSec, forKey: "drift_balance_threshold_seconds")
        defaults?.set(needsFailsafe, forKey: "drift_balance_failsafe_active")
        defaults?.set(Date().addingTimeInterval(TimeInterval(totalSec)).timeIntervalSince1970, forKey: "drift_balance_failsafe_deadline")
        defaults?.set(0, forKey: "drift_usage_consumed_total_seconds")
        defaults?.set(0, forKey: "drift_usage_reported_seconds")
        defaults?.set(0, forKey: "drift_usage_consumed_seconds")
        // Keep chunk for diagnostics only; the extension no longer re-arms
        // at sub-minute granularity (impossible on iOS).
        defaults?.set(thresholdSec, forKey: "drift_balance_chunk_size")
        try center.startMonitoring(
          .driftBalance,
          during: schedule,
          events: events
        )
        if needsFailsafe {
          // Best-effort only: iOS rejects DeviceActivity schedules shorter than
          // 15 minutes, so this throws for sub-15-min balances. Isolate it in
          // its own do/catch so a failsafe failure does NOT tear down the main
          // .driftBalance monitor. Previously a thrown failsafe hit the outer
          // catch and stopped BOTH monitors, leaving small balances with NO
          // background enforcement — the "doesn't block until you reopen" bug.
          do {
            try center.startMonitoring(
              .driftBalanceFailsafe,
              during: Self.oneShotSchedule(afterSeconds: totalSec)
            )
          } catch {
            UserDefaults(suiteName: DRIFT_APP_GROUP)?.set(false, forKey: "drift_balance_failsafe_active")
          }
        }
        resolve(nil)
      } catch {
        center.stopMonitoring([.driftBalance, .driftBalanceFailsafe])
        UserDefaults(suiteName: DRIFT_APP_GROUP)?.set(false, forKey: "drift_balance_failsafe_active")
        reject("schedule_error", error.localizedDescription, error)
      }
      return
    }
    #endif
    reject("unavailable", "DeviceActivity requires iOS 16+", nil)
  }

  @objc(stopBalanceMonitoring:rejecter:)
  func stopBalanceMonitoring(_ resolve: RCTPromiseResolveBlock,
                             rejecter reject: RCTPromiseRejectBlock) {
    #if canImport(DeviceActivity)
    if #available(iOS 16.0, *) {
      DeviceActivityCenter().stopMonitoring([.driftBalance, .driftBalanceFailsafe])
      let defaults = UserDefaults(suiteName: DRIFT_APP_GROUP)
      defaults?.removeObject(forKey: "drift_balance_armed_day")
      defaults?.removeObject(forKey: "drift_balance_armed_seconds")
      defaults?.removeObject(forKey: "drift_balance_threshold_seconds")
      defaults?.set(false, forKey: "drift_balance_failsafe_active")
      defaults?.removeObject(forKey: "drift_balance_failsafe_deadline")
      resolve(nil)
      return
    }
    #endif
    resolve(nil)
  }

  // Returns how many seconds of blocked-app usage iOS has counted since arming,
  // then resets the counter (so JS doesn't double-count on next foreground).
  @objc(consumeUsedSeconds:rejecter:)
  func consumeUsedSeconds(_ resolve: RCTPromiseResolveBlock,
                          rejecter reject: RCTPromiseRejectBlock) {
    let defaults = UserDefaults(suiteName: DRIFT_APP_GROUP)
    let total = max(
      defaults?.integer(forKey: "drift_usage_consumed_total_seconds") ?? 0,
      defaults?.integer(forKey: "drift_usage_consumed_seconds") ?? 0
    )
    let reported = defaults?.integer(forKey: "drift_usage_reported_seconds") ?? 0
    let delta = max(0, total - reported)
    if delta > 0 {
      defaults?.set(total, forKey: "drift_usage_reported_seconds")
      defaults?.set(0, forKey: "drift_usage_consumed_seconds")
    }
    resolve(delta)
  }

  // Returns true if the DriftMonitor extension fired its threshold callback
  // (meaning iOS already drained the user's balance to zero while Drift was
  // closed). Also clears the flag.
  @objc(consumeDepletedFlag:rejecter:)
  func consumeDepletedFlag(_ resolve: RCTPromiseResolveBlock,
                           rejecter reject: RCTPromiseRejectBlock) {
    let defaults = UserDefaults(suiteName: DRIFT_APP_GROUP)
    let depleted = defaults?.bool(forKey: "drift_balance_depleted") ?? false
    if depleted { defaults?.set(false, forKey: "drift_balance_depleted") }
    resolve(depleted)
  }

  @objc(updateSharedBalance:resolver:rejecter:)
  func updateSharedBalance(_ seconds: NSNumber,
                           resolver resolve: RCTPromiseResolveBlock,
                           rejecter reject: RCTPromiseRejectBlock) {
    guard let defaults = UserDefaults(suiteName: DRIFT_APP_GROUP) else {
      reject("app_group_unavailable", "Shared App Group storage is unavailable.", nil)
      return
    }
    defaults.set(max(0, seconds.intValue), forKey: DRIFT_SHARED_BALANCE_SECONDS_KEY)
    defaults.set(Date().timeIntervalSince1970, forKey: DRIFT_SHARED_BALANCE_UPDATED_AT_KEY)
    resolve(nil)
  }

  @objc(setProStatus:resolver:rejecter:)
  func setProStatus(_ isPro: Bool,
                    resolver resolve: RCTPromiseResolveBlock,
                    rejecter reject: RCTPromiseRejectBlock) {
    let defaults = UserDefaults(suiteName: DRIFT_APP_GROUP)
    defaults?.set(isPro, forKey: "drift_pro_access")
    resolve(nil)
  }

  @objc(consumePendingHealthEarn:rejecter:)
  func consumePendingHealthEarn(_ resolve: RCTPromiseResolveBlock,
                                rejecter reject: RCTPromiseRejectBlock) {
    guard let defaults = UserDefaults(suiteName: DRIFT_APP_GROUP) else {
      resolve(0)
      return
    }
    let seconds = max(0, defaults.integer(forKey: "drift_health_earn_pending_seconds"))
    if seconds > 0 {
      defaults.removeObject(forKey: "drift_health_earn_pending_seconds")
      defaults.removeObject(forKey: "drift_health_earn_updated_at")
    }
    resolve(seconds)
  }

  @objc(startDriftInLiveActivity:seconds:resolver:rejecter:)
  func startDriftInLiveActivity(_ title: NSString,
                                seconds: NSNumber,
                                resolver resolve: @escaping RCTPromiseResolveBlock,
                                rejecter reject: @escaping RCTPromiseRejectBlock) {
    #if canImport(ActivityKit)
    if #available(iOS 16.1, *) {
      guard ActivityAuthorizationInfo().areActivitiesEnabled else {
        resolve(["started": false, "reason": "disabled"])
        return
      }
      Task {
        do {
          for activity in Activity<DriftInActivityAttributes>.activities {
            let finalState = DriftInActivityAttributes.ContentState(
              remainingSeconds: 0,
              isComplete: true
            )
            await activity.end(using: finalState, dismissalPolicy: .immediate)
          }
          let duration = max(60, seconds.intValue)
          let safeTitle = String(title).trimmingCharacters(in: .whitespacesAndNewlines)
          let attributes = DriftInActivityAttributes(
            taskTitle: safeTitle.isEmpty ? "Drift In" : String(safeTitle.prefix(64)),
            totalSeconds: duration
          )
          let state = DriftInActivityAttributes.ContentState(
            remainingSeconds: duration,
            isComplete: false
          )
          _ = try Activity.request(
            attributes: attributes,
            contentState: state,
            pushType: nil
          )
          UserDefaults(suiteName: DRIFT_APP_GROUP)?
            .set(attributes.taskTitle, forKey: DRIFT_SHARED_LAST_SESSION_TITLE_KEY)
          resolve(["started": true])
        } catch {
          reject("live_activity_error", error.localizedDescription, error)
        }
      }
      return
    }
    #endif
    resolve(["started": false, "reason": "unavailable"])
  }

  @objc(updateDriftInLiveActivity:resolver:rejecter:)
  func updateDriftInLiveActivity(_ seconds: NSNumber,
                                 resolver resolve: @escaping RCTPromiseResolveBlock,
                                 rejecter reject: @escaping RCTPromiseRejectBlock) {
    #if canImport(ActivityKit)
    if #available(iOS 16.1, *) {
      Task {
        let remaining = max(0, seconds.intValue)
        let state = DriftInActivityAttributes.ContentState(
          remainingSeconds: remaining,
          isComplete: remaining == 0
        )
        for activity in Activity<DriftInActivityAttributes>.activities {
          await activity.update(using: state)
        }
        resolve(nil)
      }
      return
    }
    #endif
    resolve(nil)
  }

  @objc(endDriftInLiveActivity:rejecter:)
  func endDriftInLiveActivity(_ resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
    #if canImport(ActivityKit)
    if #available(iOS 16.1, *) {
      Task {
        for activity in Activity<DriftInActivityAttributes>.activities {
          let state = DriftInActivityAttributes.ContentState(
            remainingSeconds: 0,
            isComplete: true
          )
          await activity.end(using: state, dismissalPolicy: .after(Date().addingTimeInterval(60)))
        }
        resolve(nil)
      }
      return
    }
    #endif
    resolve(nil)
  }

  // Diagnostics — read every state we care about so we can debug why the
  // extension isn't firing on a given device.
  @objc(getDiagnostics:rejecter:)
  func getDiagnostics(_ resolve: RCTPromiseResolveBlock,
                      rejecter reject: RCTPromiseRejectBlock) {
    let defaults = UserDefaults(suiteName: DRIFT_APP_GROUP)
    var info: [String: Any] = [:]
    info["appGroupAvailable"]  = defaults != nil
    info["selectionStored"]    = (defaults?.data(forKey: DRIFT_SELECTION_KEY)?.count ?? 0) > 0
    info["selectionBytes"]     = defaults?.data(forKey: DRIFT_SELECTION_KEY)?.count ?? 0
    info["intervalStartAt"]    = defaults?.double(forKey: "drift_interval_start_at") ?? 0
    info["lastFiredAt"]        = defaults?.double(forKey: "drift_last_fired_at") ?? 0
    info["fireCount"]          = defaults?.integer(forKey: "drift_fire_count") ?? 0
    info["depletedFlag"]       = defaults?.bool(forKey: "drift_balance_depleted") ?? false
    info["thresholdSeconds"]   = defaults?.integer(forKey: "drift_balance_threshold_seconds") ?? 0
    info["consumedTotalSeconds"] = defaults?.integer(forKey: "drift_usage_consumed_total_seconds") ?? 0
    info["reportedSeconds"]    = defaults?.integer(forKey: "drift_usage_reported_seconds") ?? 0
    info["failsafeActive"]     = defaults?.bool(forKey: "drift_balance_failsafe_active") ?? false
    info["failsafeDeadline"]   = defaults?.double(forKey: "drift_balance_failsafe_deadline") ?? 0

    #if canImport(FamilyControls)
    if #available(iOS 16.0, *) {
      info["authStatus"] = statusString(AuthorizationCenter.shared.authorizationStatus)
      let sel = ScreenTimeSelectionStore.shared.selection
      info["pickedAppCount"]      = sel.applicationTokens.count
      info["pickedCategoryCount"] = sel.categoryTokens.count
      info["pickedWebCount"]      = sel.webDomainTokens.count
    }
    #endif
    #if canImport(DeviceActivity)
    if #available(iOS 16.0, *) {
      let activeNames = DeviceActivityCenter().activities.map { $0.rawValue }
      info["activeMonitors"] = activeNames
    }
    #endif
    resolve(info)
  }

  // ── Helpers ─────────────────────────────────────────────────
  #if canImport(FamilyControls)
  @available(iOS 16.0, *)
  private func statusString(_ status: AuthorizationStatus) -> String {
    switch status {
    case .approved:      return "approved"
    case .denied:        return "denied"
    case .notDetermined: return "notDetermined"
    @unknown default:    return "unknown"
    }
  }
  #endif

  private static func localDayKey(_ date: Date = Date()) -> String {
    let formatter = DateFormatter()
    formatter.calendar = Calendar.current
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone.current
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
  }

  @available(iOS 16.0, *)
  private static func oneShotSchedule(afterSeconds seconds: Int) -> DeviceActivitySchedule {
    let calendar = Calendar.current
    let start = Date()
    let end = start.addingTimeInterval(TimeInterval(max(60, seconds)))
    return DeviceActivitySchedule(
      intervalStart: calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: start),
      intervalEnd: calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: end),
      repeats: false
    )
  }

  private static func topViewController(_ base: UIViewController? =
    UIApplication.shared.connectedScenes
      .compactMap { ($0 as? UIWindowScene)?.keyWindow }
      .first?.rootViewController) -> UIViewController? {
    if let nav = base as? UINavigationController { return topViewController(nav.visibleViewController) }
    if let tab = base as? UITabBarController, let sel = tab.selectedViewController {
      return topViewController(sel)
    }
    if let presented = base?.presentedViewController { return topViewController(presented) }
    return base
  }
}

