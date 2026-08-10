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

  /// LIGHT — warm cream ground, deep forest ink, strong contrast.
  private let light = Palette(
    ground:      UIColor(red: 0.969, green: 0.969, blue: 0.957, alpha: 1), // #F7F7F4
    title:       UIColor(red: 0.043, green: 0.102, blue: 0.067, alpha: 1), // #0B1A11 near-black
    subtitle:    UIColor(red: 0.350, green: 0.420, blue: 0.370, alpha: 1), // darker mid
    icon:        UIColor(red: 0.227, green: 0.420, blue: 0.278, alpha: 1), // #3A6B47 sage
    buttonBg:    UIColor(red: 0.227, green: 0.420, blue: 0.310, alpha: 1), // #3A6B4F
    buttonLabel: UIColor.white
  )

  /// DARK — near-black ground, bright white title for max contrast, mint accent.
  private let dark = Palette(
    ground:      UIColor(red: 0.020, green: 0.027, blue: 0.024, alpha: 1), // #050706 near-black
    title:       UIColor.white,                                             // pure white
    subtitle:    UIColor(red: 0.750, green: 0.820, blue: 0.760, alpha: 1), // brighter sage
    icon:        UIColor(red: 0.498, green: 0.890, blue: 0.647, alpha: 1), // #7FE3A5 mint
    buttonBg:    UIColor(red: 0.776, green: 0.949, blue: 0.627, alpha: 1), // #C6F2A0
    buttonLabel: UIColor(red: 0.020, green: 0.027, blue: 0.024, alpha: 1)  // #050706
  )

  // ── Voice: rotating themes ──────────────────────────────────
  private struct ShieldVoice {
    let title: String
    let subtitle: String
  }

  private let earnVoices: [ShieldVoice] = [
    ShieldVoice(title: "Not yet.", subtitle: "Earn screen time by completing a task in Drift."),
    ShieldVoice(title: "Not yet.", subtitle: "One task is all it takes."),
    ShieldVoice(title: "Not yet.", subtitle: "Nothing here that can't wait."),
    ShieldVoice(title: "Breathe.", subtitle: "This moment is yours, not your phone's."),
    ShieldVoice(title: "Breathe.", subtitle: "Stillness is productive too."),
    ShieldVoice(title: "Blocked.", subtitle: "Complete a task in Drift to unlock."),
    ShieldVoice(title: "Blocked.", subtitle: "No balance. One task changes that."),
    ShieldVoice(title: "Not yet.", subtitle: "You set this boundary for a reason."),
  ]

  private let focusVoices: [ShieldVoice] = [
    ShieldVoice(title: "Focus.", subtitle: "Your session is still running. Stay with it."),
    ShieldVoice(title: "Focus.", subtitle: "Finish first. This will still be here."),
    ShieldVoice(title: "Not now.", subtitle: "You chose depth over distraction."),
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
