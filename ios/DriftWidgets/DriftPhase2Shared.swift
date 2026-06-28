import Foundation
import ActivityKit

enum DriftShared {
  static let appGroup = "group.com.sanghani.drift.shared"

  static let balanceSecondsKey = "drift_widget_balance_seconds"
  static let balanceUpdatedAtKey = "drift_widget_balance_updated_at"
  static let lastSessionTitleKey = "drift_widget_last_session_title"
  static let healthEarnPendingSecondsKey = "drift_health_earn_pending_seconds"
  static let healthEarnUpdatedAtKey = "drift_health_earn_updated_at"

  static var defaults: UserDefaults? {
    UserDefaults(suiteName: appGroup)
  }

  static func balanceSeconds() -> Int {
    max(0, defaults?.integer(forKey: balanceSecondsKey) ?? 0)
  }

  static func updatedAt() -> Date {
    let raw = defaults?.double(forKey: balanceUpdatedAtKey) ?? 0
    return raw > 0 ? Date(timeIntervalSince1970: raw) : .distantPast
  }

  static func format(seconds: Int) -> String {
    let safe = max(0, seconds)
    let hours = safe / 3600
    let minutes = (safe % 3600) / 60
    let secs = safe % 60
    if hours > 0 { return "\(hours)h \(minutes)m" }
    return "\(minutes)m \(String(format: "%02d", secs))s"
  }
}

@available(iOS 16.1, *)
struct DriftInActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var remainingSeconds: Int
    var isComplete: Bool
  }

  var taskTitle: String
  var totalSeconds: Int
}
