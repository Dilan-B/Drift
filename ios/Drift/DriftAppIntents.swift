import AppIntents
import Foundation

// ── App Intents ──────────────────────────────────────────────
// Register Drift actions with Siri and Shortcuts. Users can say
// "Hey Siri, check my Drift balance" or chain these into
// multi-step Shortcuts. App Intents is the iOS 17+ replacement
// for SiriKit and the mechanism behind on-screen awareness.
//
// All intents read/write via the shared App Group so they work
// even when the main RN app hasn't booted yet.

private let APP_GROUP = "group.com.sanghani.drift.shared"

private func sharedDefaults() -> UserDefaults? {
  UserDefaults(suiteName: APP_GROUP)
}

private func formatTime(_ seconds: Int) -> String {
  let s = max(0, seconds)
  let h = s / 3600
  let m = (s % 3600) / 60
  if h > 0 { return "\(h)h \(m)m" }
  return "\(m)m"
}

// ── Check Balance ────────────────────────────────────────────
@available(iOS 16.0, *)
struct CheckBalanceIntent: AppIntent {
  static var title: LocalizedStringResource = "Check Drift Balance"
  static var description = IntentDescription("See how much screen time you've earned today.")
  static var openAppWhenRun: Bool = false

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let seconds = sharedDefaults()?.integer(forKey: "drift_widget_balance_seconds") ?? 0
    if seconds <= 0 {
      return .result(dialog: "You have no screen time balance. Complete a task in Drift to earn some.")
    }
    return .result(dialog: "You have \(formatTime(seconds)) of screen time remaining.")
  }
}

// ── Create Task (opens the app to the add-task screen) ───────
@available(iOS 16.0, *)
struct CreateTaskIntent: AppIntent {
  static var title: LocalizedStringResource = "Create Drift Task"
  static var description = IntentDescription("Open Drift to create a new task and earn screen time.")
  static var openAppWhenRun: Bool = true

  @Parameter(title: "Task Name")
  var taskName: String?

  func perform() async throws -> some IntentResult & ProvidesDialog {
    if let name = taskName, !name.isEmpty {
      sharedDefaults()?.set(name, forKey: "drift_siri_pending_task")
    }
    return .result(dialog: "Opening Drift to create your task.")
  }
}

// ── Start Drift In Session ───────────────────────────────────
@available(iOS 16.0, *)
struct StartDriftInIntent: AppIntent {
  static var title: LocalizedStringResource = "Start Drift In Session"
  static var description = IntentDescription("Open Drift and start a focused Drift In session.")
  static var openAppWhenRun: Bool = true

  @Parameter(title: "Minutes", default: 25)
  var minutes: Int

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let mins = max(5, min(180, minutes))
    sharedDefaults()?.set(mins, forKey: "drift_siri_start_driftin")
    return .result(dialog: "Starting a \(mins)-minute Drift In session.")
  }
}

// ── Today's Progress ─────────────────────────────────────────
@available(iOS 16.0, *)
struct TodayProgressIntent: AppIntent {
  static var title: LocalizedStringResource = "Drift Today Progress"
  static var description = IntentDescription("See today's earned and spent screen time.")
  static var openAppWhenRun: Bool = false

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let defaults = sharedDefaults()
    let balance = defaults?.integer(forKey: "drift_widget_balance_seconds") ?? 0
    if balance > 0 {
      return .result(dialog: "You have \(formatTime(balance)) of earned screen time available.")
    } else {
      return .result(dialog: "No balance right now. Open Drift and complete a task to earn screen time.")
    }
  }
}

// ── Shortcuts Provider ───────────────────────────────────────
// Surfaces these intents in the Shortcuts app and Siri suggestions.
@available(iOS 16.0, *)
struct DriftShortcutsProvider: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: CheckBalanceIntent(),
      phrases: [
        "Check my \(.applicationName) balance",
        "How much screen time do I have in \(.applicationName)",
        "What's my \(.applicationName) balance",
      ],
      shortTitle: "Check Balance",
      systemImageName: "clock"
    )
    AppShortcut(
      intent: CreateTaskIntent(),
      phrases: [
        "Create a task in \(.applicationName)",
        "Add a task to \(.applicationName)",
        "New \(.applicationName) task",
      ],
      shortTitle: "Create Task",
      systemImageName: "plus.circle"
    )
    AppShortcut(
      intent: StartDriftInIntent(),
      phrases: [
        "Start a \(.applicationName) session",
        "Start Drift In",
        "Focus session in \(.applicationName)",
      ],
      shortTitle: "Start Session",
      systemImageName: "leaf"
    )
    AppShortcut(
      intent: TodayProgressIntent(),
      phrases: [
        "\(.applicationName) progress today",
        "How am I doing in \(.applicationName)",
        "Show my \(.applicationName) stats",
      ],
      shortTitle: "Today's Progress",
      systemImageName: "chart.bar"
    )
  }
}
