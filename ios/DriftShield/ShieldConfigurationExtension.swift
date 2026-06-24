import ManagedSettings
import ManagedSettingsUI
import UIKit

class ShieldConfigurationExtension: ShieldConfigurationDataSource {

  private let appGroup = "group.com.sanghani.drift.shared"

  private let paperWarm = UIColor(red: 0.957, green: 0.976, blue: 0.965, alpha: 1)
  private let inkVoid   = UIColor(red: 0.043, green: 0.102, blue: 0.067, alpha: 1)
  private let inkMid    = UIColor(red: 0.420, green: 0.541, blue: 0.471, alpha: 1)
  private let earnTerra = UIColor(red: 0.184, green: 0.671, blue: 0.447, alpha: 1)

  private let titles: [String] = [
    "Nope.",
    "Not yet.",
    "Nice try.",
    "Caught you.",
    "Nah.",
    "Hold up.",
    "Blocked.",
    "Not happening.",
    "Patience.",
    "Easy there.",
  ]

  private let nudges: [String] = [
    "You didn't earn this yet. Go do something real.",
    "This app will still be here after you finish a task.",
    "Put the phone down. Your future self is watching.",
    "You're better than mindless scrolling. Prove it.",
    "Touch grass, not glass.",
    "Every minute here is a minute you didn't earn.",
    "The dopamine can wait. Your goals can't.",
    "Remember why you downloaded Drift?",
    "One task. That's all it takes.",
    "Your screen time balance says no. Drift says earn it.",
    "This is the part where you grow.",
    "Bored? Good. Go be productive.",
    "You set this boundary. Respect it.",
    "Would the best version of you open this right now?",
    "Plot twist: you don't actually need to check this.",
    "Scrolling won't fix anything. A task might.",
    "30 minutes of work = 15 minutes of this. Fair trade.",
    "Your thumbs deserve better than doomscrolling.",
    "Breaking: nothing happened since you last checked.",
    "The urge will pass. The regret won't.",
  ]

  override func configuration(shielding application: Application) -> ShieldConfiguration {
    buildConfig(name: application.localizedDisplayName)
  }

  override func configuration(shielding application: Application, in category: ActivityCategory) -> ShieldConfiguration {
    buildConfig(name: application.localizedDisplayName ?? category.localizedDisplayName)
  }

  override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration {
    buildConfig(name: webDomain.domain)
  }

  override func configuration(shielding webDomain: WebDomain, in category: ActivityCategory) -> ShieldConfiguration {
    buildConfig(name: webDomain.domain ?? category.localizedDisplayName)
  }

  private func makeIcon() -> UIImage? {
    let symbols = ["leaf.fill", "flame.fill", "bolt.fill", "star.fill", "trophy.fill"]
    let pick = symbols[Int.random(in: 0..<symbols.count)]
    let config = UIImage.SymbolConfiguration(pointSize: 52, weight: .medium)
    let image = UIImage(systemName: pick, withConfiguration: config)
    return image?.withTintColor(earnTerra, renderingMode: .alwaysOriginal)
  }

  private func buildConfig(name: String?) -> ShieldConfiguration {
    let defaults = UserDefaults(suiteName: appGroup)
    let balanceSec = defaults?.integer(forKey: "drift_widget_balance_seconds") ?? 0
    let appName = name ?? "This app"

    let title = ShieldConfiguration.Label(
      text: titles[Int.random(in: 0..<titles.count)],
      color: .white
    )

    let nudge = nudges[Int.random(in: 0..<nudges.count)]
    let cta = balanceSec <= 0
      ? "Open Drift \u{2192} complete a task \u{2192} earn your time."
      : "\(appName) is locked. Earn more time in Drift."

    let subtitle = ShieldConfiguration.Label(
      text: "\(nudge)\n\n\(cta)",
      color: UIColor(red: 0.75, green: 0.82, blue: 0.78, alpha: 1)
    )

    let primaryButton = ShieldConfiguration.Label(
      text: "I'll go be productive",
      color: .white
    )

    return ShieldConfiguration(
      backgroundBlurStyle: nil,
      backgroundColor: UIColor(red: 0.067, green: 0.133, blue: 0.086, alpha: 1),
      icon: makeIcon(),
      title: title,
      subtitle: subtitle,
      primaryButtonLabel: primaryButton,
      primaryButtonBackgroundColor: earnTerra,
      secondaryButtonLabel: nil
    )
  }
}
