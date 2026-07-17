import ManagedSettings
import ManagedSettingsUI
import UIKit

/// The screen iOS draws over a blocked app.
///
/// Design: "quiet paper" — the shield renders in Drift's own theme (cream
/// parchment in light mode, greenhouse-night forest in dark), so hitting the
/// wall feels like a page of the app interrupting rather than a punishment
/// card. The voice is calm and spare: state the deal, no snark, no guilt.
///
/// The app writes its in-app theme toggle to the shared App Group
/// (`drift_dark_mode`, via ScreenTimeModule.setAppearance); we read it here.
/// If the key has never been written (fresh install, pre-update build) we
/// default to light, matching the app's own default.
///
/// Apple constrains this surface to: background color/blur, one icon, title,
/// subtitle, and button labels/colors — system font only, fixed layout.
class ShieldConfigurationExtension: ShieldConfigurationDataSource {

  private let appGroup = "group.com.sanghani.drift.shared"

  // ── Palette (mirrors theme.js LIGHT / DARK) ─────────────────
  private struct Palette {
    let ground:      UIColor
    let title:       UIColor
    let subtitle:    UIColor
    let icon:        UIColor
    let buttonBg:    UIColor
    let buttonLabel: UIColor
  }

  /// LIGHT — paper.warm ground, forest ink, deep-forest button.
  private let light = Palette(
    ground:      UIColor(red: 0.969, green: 0.969, blue: 0.957, alpha: 1), // #F7F7F4
    title:       UIColor(red: 0.102, green: 0.157, blue: 0.125, alpha: 1), // #1A2820
    subtitle:    UIColor(red: 0.420, green: 0.478, blue: 0.431, alpha: 1), // #6B7A6E
    icon:        UIColor(red: 0.243, green: 0.420, blue: 0.306, alpha: 1), // #3E6B4E sage
    buttonBg:    UIColor(red: 0.122, green: 0.227, blue: 0.165, alpha: 1), // #1F3A2A
    buttonLabel: UIColor(red: 0.980, green: 0.965, blue: 0.933, alpha: 1)  // #FAF6EE
  )

  /// DARK — greenhouse-at-night forest ground, paper-white ink, mint button.
  private let dark = Palette(
    ground:      UIColor(red: 0.055, green: 0.102, blue: 0.075, alpha: 1), // #0E1A13
    title:       UIColor(red: 0.941, green: 0.969, blue: 0.918, alpha: 1), // #F0F7EA
    subtitle:    UIColor(red: 0.663, green: 0.769, blue: 0.671, alpha: 1), // #A9C4AB
    icon:        UIColor(red: 0.498, green: 0.890, blue: 0.647, alpha: 1), // #7FE3A5 mint
    buttonBg:    UIColor(red: 0.776, green: 0.949, blue: 0.627, alpha: 1), // #C6F2A0
    buttonLabel: UIColor(red: 0.086, green: 0.149, blue: 0.110, alpha: 1)  // #16261C
  )

  // ── Voice: rotating themes ──────────────────────────────────
  private struct ShieldVoice {
    let title: String
    let subtitle: String
  }

  private let earnVoices: [ShieldVoice] = [
    // Zen garden — minimal, meditative
    ShieldVoice(title: "breathe.", subtitle: "this moment is yours, not your phone's."),
    ShieldVoice(title: "breathe.", subtitle: "there is nothing here that can't wait."),
    ShieldVoice(title: "breathe.", subtitle: "stillness is productive too."),

    // Greenhouse — organic, growth-forward
    ShieldVoice(title: "growing.", subtitle: "your sprout is growing — don't pull it up to check."),
    ShieldVoice(title: "growing.", subtitle: "every minute away from here is a minute it grows."),
    ShieldVoice(title: "growing.", subtitle: "the greenhouse doesn't need you scrolling."),

    // Scoreboard — clear, data-driven
    ShieldVoice(title: "0 minutes.", subtitle: "complete a task in Drift to earn screen time."),
    ShieldVoice(title: "0 minutes.", subtitle: "no balance. one task changes that."),
    ShieldVoice(title: "0 minutes.", subtitle: "the counter starts when you do."),

    // Gentle wall — warm, literary
    ShieldVoice(title: "not yet.", subtitle: "the best things come to those who wait."),
    ShieldVoice(title: "not yet.", subtitle: "patience is a form of action."),
    ShieldVoice(title: "not yet.", subtitle: "what you resist today rewards you tomorrow."),

    // Mirror — self-aware, honest
    ShieldVoice(title: "again?", subtitle: "you know why you set this boundary."),
    ShieldVoice(title: "again?", subtitle: "this is the part where you prove it to yourself."),
    ShieldVoice(title: "again?", subtitle: "future you will be glad you stayed away."),
  ]

  private let focusVoices: [ShieldVoice] = [
    ShieldVoice(title: "not now.", subtitle: "you're mid-focus. this can wait until you surface."),
    ShieldVoice(title: "growing.", subtitle: "your focus session is still running. stay with it."),
    ShieldVoice(title: "breathe.", subtitle: "you chose depth over distraction. keep going."),
    ShieldVoice(title: "almost.", subtitle: "finish your session first. this will still be here."),
  ]

  override func configuration(shielding application: Application) -> ShieldConfiguration {
    buildConfig()
  }

  override func configuration(shielding application: Application, in category: ActivityCategory) -> ShieldConfiguration {
    buildConfig()
  }

  override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration {
    buildConfig()
  }

  override func configuration(shielding webDomain: WebDomain, in category: ActivityCategory) -> ShieldConfiguration {
    buildConfig()
  }

  private func makeIcon(_ p: Palette) -> UIImage? {
    let config = UIImage.SymbolConfiguration(pointSize: 46, weight: .regular)
    let image = UIImage(systemName: "leaf.fill", withConfiguration: config)
    return image?.withTintColor(p.icon, renderingMode: .alwaysOriginal)
  }

  private func buildConfig() -> ShieldConfiguration {
    let defaults = UserDefaults(suiteName: appGroup)
    // Follow the app's own theme toggle. `object(forKey:)` (not `bool`) so a
    // never-written key falls back to light instead of reading as false-dark.
    let isDark = (defaults?.object(forKey: "drift_dark_mode") as? Bool) ?? false
    let p = isDark ? dark : light

    let balanceSec = defaults?.integer(forKey: "drift_widget_balance_seconds") ?? 0
    let voice = balanceSec > 0
      ? focusVoices[Int.random(in: 0..<focusVoices.count)]
      : earnVoices[Int.random(in: 0..<earnVoices.count)]

    return ShieldConfiguration(
      backgroundBlurStyle: nil,
      backgroundColor: p.ground,
      icon: makeIcon(p),
      title: ShieldConfiguration.Label(text: voice.title, color: p.title),
      subtitle: ShieldConfiguration.Label(text: voice.subtitle, color: p.subtitle),
      primaryButtonLabel: ShieldConfiguration.Label(text: "I'll come back later", color: p.buttonLabel),
      primaryButtonBackgroundColor: p.buttonBg,
      secondaryButtonLabel: nil
    )
  }
}
