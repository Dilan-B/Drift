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

// Same App Group used by the main app. MUST match exactly.
let APP_GROUP = "group.com.sanghani.drift.shared"
let SELECTION_KEY = "drift_family_activity_selection"
let STORE_NAME_RAW = "driftFocus"

@available(iOS 16.0, *)
func storeName() -> ManagedSettingsStore.Name { ManagedSettingsStore.Name(STORE_NAME_RAW) }

@available(iOS 16.0, *)
class DriftMonitor: DeviceActivityMonitor {

  // Called each time the user hits a 1-minute chunk of blocked-app usage.
  // We track cumulative consumed time and re-arm for the next chunk, or
  // apply the shield when the full balance is used up.
  override func eventDidReachThreshold(
    _ event: DeviceActivityEvent.Name,
    activity: DeviceActivityName
  ) {
    super.eventDidReachThreshold(event, activity: activity)
    let defaults = UserDefaults(suiteName: APP_GROUP)

    let armedTotal = defaults?.integer(forKey: "drift_balance_armed_seconds") ?? 0
    let chunk = defaults?.integer(forKey: "drift_balance_chunk_size") ?? 5
    let consumed = (defaults?.integer(forKey: "drift_usage_consumed_seconds") ?? 0) + chunk
    defaults?.set(consumed, forKey: "drift_usage_consumed_seconds")
    defaults?.set(Date().timeIntervalSince1970, forKey: "drift_last_fired_at")
    let count = (defaults?.integer(forKey: "drift_fire_count") ?? 0) + 1
    defaults?.set(count, forKey: "drift_fire_count")

    let remaining = armedTotal - consumed
    if remaining <= 0 {
      // Balance fully depleted — lock them out.
      applyShieldFromSelection()
      defaults?.set(true, forKey: "drift_balance_depleted")
      DeviceActivityCenter().stopMonitoring([DeviceActivityName("drift.balance")])
    } else {
      // Re-arm for the next chunk (up to 60s).
      rearmMonitor(remainingSeconds: remaining)
    }
  }

  private func rearmMonitor(remainingSeconds: Int) {
    guard let defaults = UserDefaults(suiteName: APP_GROUP),
          let data = defaults.data(forKey: SELECTION_KEY),
          let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
    else { return }

    let chunk = min(5, remainingSeconds)
    let schedule = DeviceActivitySchedule(
      intervalStart: DateComponents(hour: 0, minute: 0),
      intervalEnd:   DateComponents(hour: 23, minute: 59),
      repeats: true
    )
    let threshold = DateComponents(second: chunk)
    let event = DeviceActivityEvent(
      applications: selection.applicationTokens,
      categories:   selection.categoryTokens,
      webDomains:   selection.webDomainTokens,
      threshold:    threshold
    )
    let center = DeviceActivityCenter()
    center.stopMonitoring([DeviceActivityName("drift.balance")])
    do {
      try center.startMonitoring(
        DeviceActivityName("drift.balance"),
        during: schedule,
        events: [DeviceActivityEvent.Name("drift.balanceDepleted"): event]
      )
    } catch {}
  }

  // Called when the monitoring window starts (a new day, in our schedule).
  // We don't shield here by default — the shield state is whatever Drift left it.
  override func intervalDidStart(for activity: DeviceActivityName) {
    super.intervalDidStart(for: activity)
    let defaults = UserDefaults(suiteName: APP_GROUP)
    defaults?.set(Date().timeIntervalSince1970, forKey: "drift_interval_start_at")
    let armedDay = defaults?.string(forKey: "drift_balance_armed_day")
    if armedDay != localDayKey() {
      applyShieldFromSelection()
      defaults?.set(true, forKey: "drift_balance_depleted")
      defaults?.set(Date().timeIntervalSince1970, forKey: "drift_last_fired_at")
    }
  }

  // Called at end of monitoring window (e.g. midnight). Reset for the new day.
  override func intervalDidEnd(for activity: DeviceActivityName) {
    super.intervalDidEnd(for: activity)
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

  private func localDayKey(_ date: Date = Date()) -> String {
    let formatter = DateFormatter()
    formatter.calendar = Calendar.current
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone.current
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
  }
}
