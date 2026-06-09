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

  // Called when the user has used the blocked apps for the threshold amount
  // of time (their earned balance). We apply the shield so they're locked
  // out until they earn more time in Drift.
  override func eventDidReachThreshold(
    _ event: DeviceActivityEvent.Name,
    activity: DeviceActivityName
  ) {
    super.eventDidReachThreshold(event, activity: activity)
    applyShieldFromSelection()
    let defaults = UserDefaults(suiteName: APP_GROUP)
    defaults?.set(true, forKey: "drift_balance_depleted")
    // Diagnostics: when did the extension actually fire?
    defaults?.set(Date().timeIntervalSince1970, forKey: "drift_last_fired_at")
    let count = (defaults?.integer(forKey: "drift_fire_count") ?? 0) + 1
    defaults?.set(count, forKey: "drift_fire_count")
  }

  // Called when the monitoring window starts (a new day, in our schedule).
  // We don't shield here by default — the shield state is whatever Drift left it.
  override func intervalDidStart(for activity: DeviceActivityName) {
    super.intervalDidStart(for: activity)
    UserDefaults(suiteName: APP_GROUP)?.set(Date().timeIntervalSince1970,
                                            forKey: "drift_interval_start_at")
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
}
