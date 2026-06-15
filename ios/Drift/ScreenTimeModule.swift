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
//   startBalanceMonitoring(minutes:N)   -> void  (NEW: iOS-enforced timer)
//   stopBalanceMonitoring()             -> void
//
// The user's selection (apps/categories/web domains) is persisted to the
// shared App Group's UserDefaults, so the DriftMonitor extension can read it
// even when the main app is force-quit.
//
import Foundation
import UIKit
import React

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

@available(iOS 16.0, *)
func driftStoreName() -> ManagedSettingsStore.Name { ManagedSettingsStore.Name(DRIFT_STORE_NAME_RAW) }

@available(iOS 16.0, *)
extension DeviceActivityName {
  static let driftBalance = Self("drift.balance")
}

@available(iOS 16.0, *)
extension DeviceActivityEvent.Name {
  static let balanceDepleted = Self("drift.balanceDepleted")
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
      if appCount == 0 && catCount == 0 {
        reject("no_selection", "No apps selected. Pick apps to block first.", nil)
        return
      }

      // Daily schedule: midnight → 11:59pm, repeating.
      let schedule = DeviceActivitySchedule(
        intervalStart: DateComponents(hour: 0,  minute: 0),
        intervalEnd:   DateComponents(hour: 23, minute: 59),
        repeats: true
      )

      // Fire every 5s of blocked-app usage so JS can show near-live progress.
      let totalSec = max(5, seconds.intValue)
      let chunk = min(5, totalSec)
      let threshold = DateComponents(second: chunk)

      let event = DeviceActivityEvent(
        applications: selection.applicationTokens,
        categories:   selection.categoryTokens,
        webDomains:   selection.webDomainTokens,
        threshold:    threshold
      )

      let center = DeviceActivityCenter()
      // Always stop any existing monitor before restarting — DeviceActivity
      // doesn't replace events automatically.
      center.stopMonitoring([.driftBalance])
      do {
        let defaults = UserDefaults(suiteName: DRIFT_APP_GROUP)
        defaults?.set(Self.localDayKey(), forKey: "drift_balance_armed_day")
        defaults?.set(totalSec, forKey: "drift_balance_armed_seconds")
        defaults?.set(0, forKey: "drift_usage_consumed_seconds")
        defaults?.set(chunk, forKey: "drift_balance_chunk_size")
        try center.startMonitoring(
          .driftBalance,
          during: schedule,
          events: [.balanceDepleted: event]
        )
        resolve(nil)
      } catch {
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
      DeviceActivityCenter().stopMonitoring([.driftBalance])
      let defaults = UserDefaults(suiteName: DRIFT_APP_GROUP)
      defaults?.removeObject(forKey: "drift_balance_armed_day")
      defaults?.removeObject(forKey: "drift_balance_armed_seconds")
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
    let consumed = defaults?.integer(forKey: "drift_usage_consumed_seconds") ?? 0
    if consumed > 0 { defaults?.set(0, forKey: "drift_usage_consumed_seconds") }
    resolve(consumed)
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
