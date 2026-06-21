//
// DriftMonitor.swift
// DeviceActivityMonitor extension. iOS runs this independently of the main
// Drift app — when a scheduled event fires, the OS wakes this extension,
// reads the saved selection from the shared App Group, and applies the
// ManagedSettings shield. The user can have Drift force-quit, phone locked,
// in airplane mode — Apple still fires the callback.
//
import DeviceActivity
import ManagedSettings
import FamilyControls
import Foundation
import UserNotifications

// Same App Group used by the main app. MUST match exactly.
let APP_GROUP = "group.com.sanghani.drift.shared"
let SELECTION_KEY = "drift_family_activity_selection"
let STORE_NAME_RAW = "driftFocus"

@available(iOS 16.0, *)
func storeName() -> ManagedSettingsStore.Name { ManagedSettingsStore.Name(STORE_NAME_RAW) }

@available(iOS 16.0, *)
class DriftMonitor: DeviceActivityMonitor {

  // Fires ONCE, after the user has spent their entire earned balance on
  // blocked apps. (iOS won't deliver sub-15-minute thresholds, so there is
  // no per-chunk re-arming — the single threshold == the whole balance.)
  // When it fires, the balance is gone: shield the apps. This runs in the
  // extension's own process, so it works even when Drift is force-quit.
  override func eventDidReachThreshold(
    _ event: DeviceActivityEvent.Name,
    activity: DeviceActivityName
  ) {
    super.eventDidReachThreshold(event, activity: activity)
    let defaults = UserDefaults(suiteName: APP_GROUP)

    if event.rawValue.hasPrefix("drift.balanceCheckpoint.") {
      let raw = event.rawValue.replacingOccurrences(of: "drift.balanceCheckpoint.", with: "")
      let checkpointSec = Int(raw) ?? 0
      let previous = defaults?.integer(forKey: "drift_usage_consumed_total_seconds") ?? 0
      defaults?.set(max(previous, checkpointSec), forKey: "drift_usage_consumed_total_seconds")
      defaults?.set(Date().timeIntervalSince1970, forKey: "drift_last_fired_at")
      let count = (defaults?.integer(forKey: "drift_fire_count") ?? 0) + 1
      defaults?.set(count, forKey: "drift_fire_count")
      return
    }

    let thresholdSec = defaults?.integer(forKey: "drift_balance_threshold_seconds") ?? 900
    let previous = defaults?.integer(forKey: "drift_usage_consumed_total_seconds") ?? 0
    defaults?.set(max(previous, thresholdSec), forKey: "drift_usage_consumed_total_seconds")
    defaults?.set(thresholdSec, forKey: "drift_usage_consumed_seconds")
    defaults?.set(Date().timeIntervalSince1970, forKey: "drift_last_fired_at")
    let count = (defaults?.integer(forKey: "drift_fire_count") ?? 0) + 1
    defaults?.set(count, forKey: "drift_fire_count")

    // Balance fully depleted — lock them out and stop monitoring until the
    // app re-arms with a fresh balance.
    applyShieldFromSelection()
    notifyOutOfTime()
    defaults?.set(true, forKey: "drift_balance_depleted")
    defaults?.set(false, forKey: "drift_balance_failsafe_active")
    DeviceActivityCenter().stopMonitoring([
      DeviceActivityName("drift.balance"),
      DeviceActivityName("drift.balance.failsafe")
    ])
  }

  // Called when the monitoring window starts (a new day, in our schedule).
  // We don't shield here by default — the shield state is whatever Drift left it.
  override func intervalDidStart(for activity: DeviceActivityName) {
    super.intervalDidStart(for: activity)
    guard activity.rawValue == "drift.balance" else { return }
    let defaults = UserDefaults(suiteName: APP_GROUP)
    defaults?.set(Date().timeIntervalSince1970, forKey: "drift_interval_start_at")
    let armedDay = defaults?.string(forKey: "drift_balance_armed_day")
    if armedDay != localDayKey() {
      applyShieldFromSelection()
      notifyOutOfTime()
      defaults?.set(true, forKey: "drift_balance_depleted")
      defaults?.set(Date().timeIntervalSince1970, forKey: "drift_last_fired_at")
    }
  }

  // Called at end of monitoring window (e.g. midnight). Reset for the new day.
  override func intervalDidEnd(for activity: DeviceActivityName) {
    super.intervalDidEnd(for: activity)
    if activity.rawValue == "drift.balance.failsafe" {
      let defaults = UserDefaults(suiteName: APP_GROUP)
      guard defaults?.bool(forKey: "drift_balance_failsafe_active") == true else { return }
      let armedSec = defaults?.integer(forKey: "drift_balance_armed_seconds") ?? 0
      applyShieldFromSelection()
      notifyOutOfTime()
      let previous = defaults?.integer(forKey: "drift_usage_consumed_total_seconds") ?? 0
      defaults?.set(max(previous, max(0, armedSec)), forKey: "drift_usage_consumed_total_seconds")
      defaults?.set(max(0, armedSec), forKey: "drift_usage_consumed_seconds")
      defaults?.set(true, forKey: "drift_balance_depleted")
      defaults?.set(false, forKey: "drift_balance_failsafe_active")
      defaults?.set(Date().timeIntervalSince1970, forKey: "drift_last_fired_at")
      let count = (defaults?.integer(forKey: "drift_fire_count") ?? 0) + 1
      defaults?.set(count, forKey: "drift_fire_count")
      DeviceActivityCenter().stopMonitoring([
        DeviceActivityName("drift.balance"),
        DeviceActivityName("drift.balance.failsafe")
      ])
      return
    }
    // Optional: clear the shield at midnight so user starts the day with a
    // fresh slate. Comment this out if you'd rather keep the shield sticky.
    // clearShield()
  }

  // ── Helpers ─────────────────────────────────────────────────
  private func applyShieldFromSelection() {
    guard let defaults = UserDefaults(suiteName: APP_GROUP),
          let data = defaults.data(forKey: SELECTION_KEY),
          let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
    else { return }

    let store = ManagedSettingsStore(named: storeName())
    store.shield.applications = selection.applicationTokens.isEmpty
      ? nil : selection.applicationTokens
    store.shield.applicationCategories = selection.categoryTokens.isEmpty
      ? nil : .specific(selection.categoryTokens)
    store.shield.webDomains = selection.webDomainTokens.isEmpty
      ? nil : selection.webDomainTokens
  }

  private func clearShield() {
    let store = ManagedSettingsStore(named: storeName())
    store.shield.applications = nil
    store.shield.applicationCategories = nil
    store.shield.webDomains = nil
  }

  private func notifyOutOfTime() {
    let content = UNMutableNotificationContent()
    content.title = "Time's up"
    content.body = "You're out of earned time. Complete a task to unlock your apps."
    content.sound = .default

    let request = UNNotificationRequest(
      identifier: "drift.monitor.out_of_time.\(Int(Date().timeIntervalSince1970))",
      content: content,
      trigger: nil
    )
    UNUserNotificationCenter.current().add(request)
  }

  private func localDayKey(_ date: Date = Date()) -> String {
    let formatter = DateFormatter()
    formatter.calendar = Calendar.current
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone.current
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
  }
}
