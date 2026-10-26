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

  // ── Naming the blocked thing ────────────────────────────────
  // ShieldConfigurationDataSource is the ONE place iOS tells a third-party app
  // which app the user just tried to open: "The system provides your extension
  // with the display names, bundle identifiers, and domains for each
  // application, website, or category it shields."
  //
  // PRIVACY BOUNDARY — do not cross it. The same documentation states this
  // extension "runs in a sandbox [that] prevents your extension from making
  // network requests or moving sensitive content outside the extension's
  // address space." So the name is used to draw THIS screen and nothing else:
  // never written to the App Group, never persisted, never sent anywhere. If a
  // future change wants the host app to know which app was blocked, that is not
  // a thing to route through here.
  //
  // The name is optional in practice: shielding a whole category, or a token
  // whose app is uninstalled, can leave it empty. Every voice therefore has a
  // generic counterpart, and an empty/whitespace name falls back to it.

  private func earnVoices(_ name: String?) -> [ShieldVoice] {
    guard let n = named(name) else {
      return [
        ShieldVoice(title: driftL("Not yet."), subtitle: driftL("Earn screen time by completing a task in Drift.")),
        ShieldVoice(title: driftL("Not yet."), subtitle: driftL("One task is all it takes.")),
        ShieldVoice(title: driftL("Not yet."), subtitle: driftL("Nothing here that can't wait.")),
        ShieldVoice(title: driftL("Breathe."), subtitle: driftL("This moment is yours, not your phone's.")),
        ShieldVoice(title: driftL("Breathe."), subtitle: driftL("Stillness is productive too.")),
        ShieldVoice(title: driftL("Blocked."), subtitle: driftL("Complete a task in Drift to unlock.")),
        ShieldVoice(title: driftL("Blocked."), subtitle: driftL("No balance. One task changes that.")),
        ShieldVoice(title: driftL("Not yet."), subtitle: driftL("You set this boundary for a reason.")),
      ]
    }
    return [
      ShieldVoice(title: driftL("Not yet."), subtitle: driftL("{{name}} unlocks when you complete a task in Drift.", ["name": n])),
      ShieldVoice(title: driftL("Is {{name}} the move right now?", ["name": n]), subtitle: driftL("One task in Drift and it's yours.")),
      ShieldVoice(title: driftL("{{name}} can wait.", ["name": n]), subtitle: driftL("Complete a task to earn your time back.")),
      ShieldVoice(title: driftL("Breathe."), subtitle: driftL("{{name}} will still be there in ten minutes.", ["name": n])),
      ShieldVoice(title: driftL("{{name}} is blocked.", ["name": n]), subtitle: driftL("No balance. One task changes that.")),
      ShieldVoice(title: driftL("Not yet."), subtitle: driftL("You blocked {{name}} for a reason.", ["name": n])),
    ]
  }

  private func focusVoices(_ name: String?) -> [ShieldVoice] {
    guard let n = named(name) else {
      return [
        ShieldVoice(title: driftL("Focus."), subtitle: driftL("Your session is still running. Stay with it.")),
        ShieldVoice(title: driftL("Focus."), subtitle: driftL("Finish first. This will still be here.")),
        ShieldVoice(title: driftL("Not now."), subtitle: driftL("You chose depth over distraction.")),
      ]
    }
    return [
      ShieldVoice(title: driftL("Focus."), subtitle: driftL("Session's still running. {{name}} can wait.", ["name": n])),
      ShieldVoice(title: driftL("Not now."), subtitle: driftL("Finish up. {{name}} will still be there.", ["name": n])),
      ShieldVoice(title: driftL("Not now."), subtitle: driftL("You chose depth over {{name}}.", ["name": n])),
    ]
  }

  /// Trimmed, length-capped display name, or nil when there's nothing usable.
  /// Capped because the shield's title is a fixed-size system label and a long
  /// name would truncate mid-word.
  private func named(_ raw: String?) -> String? {
    guard let t = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { return nil }
    return t.count <= 24 ? t : nil
  }

  override func configuration(shielding application: Application) -> ShieldConfiguration {
    buildConfig(name: application.localizedDisplayName)
  }

  override func configuration(shielding application: Application, in category: ActivityCategory) -> ShieldConfiguration {
    // Still name the specific app — the category is just how it got shielded.
    buildConfig(name: application.localizedDisplayName)
  }

  override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration {
    buildConfig(name: webDomain.domain)
  }

  override func configuration(shielding webDomain: WebDomain, in category: ActivityCategory) -> ShieldConfiguration {
    buildConfig(name: webDomain.domain)
  }

  private func makeIcon(_ p: Palette) -> UIImage? {
    let config = UIImage.SymbolConfiguration(pointSize: 46, weight: .regular)
    let image = UIImage(systemName: "leaf.fill", withConfiguration: config)
    return image?.withTintColor(p.icon, renderingMode: .alwaysOriginal)
  }

  private func buildConfig(name: String? = nil) -> ShieldConfiguration {
    let defaults = UserDefaults(suiteName: appGroup)
    // Follow the app's own theme toggle. `object(forKey:)` (not `bool`) so a
    // never-written key falls back to light instead of reading as false-dark.
    let isDark = (defaults?.object(forKey: "drift_dark_mode") as? Bool) ?? false
    let p = isDark ? dark : light

    let balanceSec = defaults?.integer(forKey: "drift_widget_balance_seconds") ?? 0
    let voices = balanceSec > 0 ? focusVoices(name) : earnVoices(name)
    let voice = voices[Int.random(in: 0..<voices.count)]

    // `nil` here draws an opaque colour. That looks correct while the shield is
    // on screen, but in the app switcher the blocked app's own window showed as
    // a white border around the card — that snapshot is of THEIR window, not
    // ours, and every blocked app did it regardless of Drift's theme.
    //
    // A material makes iOS composite the shield across the whole snapshot, so
    // the white goes. The obvious risk is translucency: a blur could let the
    // blocked app show through the shield during normal use, which is the
    // screen that actually matters. It does not, because backgroundColor is
    // drawn over the material and our grounds are fully opaque.
    //
    // Verified on device 2026-09-17, dark mode: solid in use, no white in the
    // switcher. Match the style to the theme — a dark material under the light
    // ground would darken the edges of the cream shield.
    return ShieldConfiguration(
      backgroundBlurStyle: isDark ? .systemUltraThinMaterialDark : .systemUltraThinMaterialLight,
      backgroundColor: p.ground,
      icon: makeIcon(p),
      title: ShieldConfiguration.Label(text: voice.title, color: p.title),
      subtitle: ShieldConfiguration.Label(text: voice.subtitle, color: p.subtitle),
      primaryButtonLabel: ShieldConfiguration.Label(text: driftL("I'll come back later"), color: p.buttonLabel),
      primaryButtonBackgroundColor: p.buttonBg,
      secondaryButtonLabel: nil
    )
  }
}

// BEGIN GENERATED L10N (tools/i18n/build.js) — do not edit by hand
// Extensions can't see the app's JS catalogs, so each carries its own table.
// Language: what the app last wrote to the App Group (ScreenTimeModule
// .setLanguage), else the device's preferred language, else English.
fileprivate let DRIFT_L10N: [String: [String: String]] = [
  "zh-Hans": [
    "{{name}} unlocks when you complete a task in Drift.": "在 Drift 完成一个任务即可解锁 {{name}}。",
    "{{name}} will still be there in ten minutes.": "十分钟后 {{name}} 还会在那里。",
    "Session's still running. {{name}} can wait.": "专注还在进行。{{name}} 可以等等。",
    "Finish up. {{name}} will still be there.": "先做完。{{name}} 还会在那里。",
    "You blocked {{name}} for a reason.": "你屏蔽 {{name}} 是有原因的。",
    "Is {{name}} the move right now?": "现在该用 {{name}} 吗？",
    "You chose depth over {{name}}.": "你选择了深度，而不是 {{name}}。",
    "{{name}} is blocked.": "{{name}} 已被屏蔽。",
    "{{name}} can wait.": "{{name}} 可以等等。",
    "Earn screen time by completing a task in Drift.": "在 Drift 完成任务来赚取屏幕时间。",
    "Your session is still running. Stay with it.": "专注还在进行，坚持住。",
    "This moment is yours, not your phone's.": "这一刻属于你，不属于你的手机。",
    "Complete a task to earn your time back.": "完成一个任务，把时间赚回来。",
    "Finish first. This will still be here.": "先做完，这里还会在。",
    "Complete a task in Drift to unlock.": "在 Drift 完成一个任务即可解锁。",
    "You set this boundary for a reason.": "你设下这个界限是有原因的。",
    "No balance. One task changes that.": "余额为零。完成一个任务就能改变。",
    "One task in Drift and it's yours.": "在 Drift 完成一个任务，它就是你的。",
    "You chose depth over distraction.": "你选择了深度，而不是分心。",
    "Nothing here that can't wait.": "这里没有什么不能等的。",
    "Stillness is productive too.": "静止也是一种效率。",
    "One task is all it takes.": "一个任务就够了。",
    "Blocked.": "已屏蔽。",
    "Not yet.": "还没。",
    "Not now.": "以后再说。",
    "Breathe.": "深呼吸。",
    "Focus.": "专注。",
    "I'll come back later": "我待会儿再来",
  ],
  "zh-Hant": [
    "{{name}} unlocks when you complete a task in Drift.": "在 Drift 完成一個任務即可解鎖 {{name}}。",
    "{{name}} will still be there in ten minutes.": "十分鐘後 {{name}} 還會在那裡。",
    "Session's still running. {{name}} can wait.": "專注還在進行。{{name}} 可以等等。",
    "Finish up. {{name}} will still be there.": "先做完。{{name}} 還會在那裡。",
    "You blocked {{name}} for a reason.": "你封鎖 {{name}} 是有原因的。",
    "Is {{name}} the move right now?": "現在該用 {{name}} 嗎？",
    "You chose depth over {{name}}.": "你選擇了深度，而不是 {{name}}。",
    "{{name}} is blocked.": "{{name}} 已被封鎖。",
    "{{name}} can wait.": "{{name}} 可以等等。",
    "Earn screen time by completing a task in Drift.": "在 Drift 完成任務來賺取螢幕使用時間。",
    "Your session is still running. Stay with it.": "專注還在進行，撐住。",
    "This moment is yours, not your phone's.": "這一刻屬於你，不屬於你的手機。",
    "Complete a task to earn your time back.": "完成一個任務，把時間賺回來。",
    "Finish first. This will still be here.": "先做完，這裡還會在。",
    "Complete a task in Drift to unlock.": "在 Drift 完成一個任務即可解鎖。",
    "You set this boundary for a reason.": "你設下這個界線是有原因的。",
    "No balance. One task changes that.": "餘額為零。完成一個任務就能改變。",
    "One task in Drift and it's yours.": "在 Drift 完成一個任務，它就是你的。",
    "You chose depth over distraction.": "你選擇了深度，而不是分心。",
    "Nothing here that can't wait.": "這裡沒有什麼不能等的。",
    "Stillness is productive too.": "靜止也是一種效率。",
    "One task is all it takes.": "一個任務就夠了。",
    "Blocked.": "已封鎖。",
    "Not yet.": "還沒。",
    "Not now.": "以後再說。",
    "Breathe.": "深呼吸。",
    "Focus.": "專注。",
    "I'll come back later": "我等等再來",
  ],
  "hi": [
    "{{name}} unlocks when you complete a task in Drift.": "Drift में काम पूरा करने पर {{name}} खुलेगा।",
    "{{name}} will still be there in ten minutes.": "{{name}} दस मिनट बाद भी वहीं होगा।",
    "Session's still running. {{name}} can wait.": "सत्र अभी चल रहा है। {{name}} इंतज़ार कर सकता है।",
    "Finish up. {{name}} will still be there.": "पूरा कर लें। {{name}} वहीं रहेगा।",
    "You blocked {{name}} for a reason.": "आपने {{name}} को किसी वजह से ब्लॉक किया था।",
    "Is {{name}} the move right now?": "क्या अभी {{name}} का समय है?",
    "You chose depth over {{name}}.": "आपने {{name}} की जगह गहराई चुनी।",
    "{{name}} is blocked.": "{{name}} ब्लॉक है।",
    "{{name}} can wait.": "{{name}} इंतज़ार कर सकता है।",
    "Earn screen time by completing a task in Drift.": "Drift में काम पूरा करके स्क्रीन टाइम कमाएँ।",
    "Your session is still running. Stay with it.": "आपका सत्र अभी चल रहा है। डटे रहें।",
    "This moment is yours, not your phone's.": "यह पल आपका है, आपके फ़ोन का नहीं।",
    "Complete a task to earn your time back.": "अपना समय वापस कमाने के लिए एक काम पूरा करें।",
    "Finish first. This will still be here.": "पहले पूरा करें। यह यहीं रहेगा।",
    "Complete a task in Drift to unlock.": "अनलॉक करने के लिए Drift में एक काम पूरा करें।",
    "You set this boundary for a reason.": "आपने यह सीमा किसी वजह से तय की थी।",
    "No balance. One task changes that.": "बैलेंस ख़त्म। एक काम सब बदल देगा।",
    "One task in Drift and it's yours.": "Drift में एक काम और यह आपका।",
    "You chose depth over distraction.": "आपने भटकाव की जगह गहराई चुनी।",
    "Nothing here that can't wait.": "यहाँ ऐसा कुछ नहीं जो इंतज़ार न कर सके।",
    "Stillness is productive too.": "ठहराव भी उपयोगी है।",
    "One task is all it takes.": "बस एक काम काफ़ी है।",
    "Blocked.": "ब्लॉक।",
    "Not yet.": "अभी नहीं।",
    "Not now.": "अभी नहीं।",
    "Breathe.": "साँस लें।",
    "Focus.": "फ़ोकस।",
    "I'll come back later": "मैं बाद में आऊँगा",
  ],
  "es": [
    "{{name}} unlocks when you complete a task in Drift.": "{{name}} se desbloquea cuando completas una tarea en Drift.",
    "{{name}} will still be there in ten minutes.": "{{name}} seguirá ahí dentro de diez minutos.",
    "Session's still running. {{name}} can wait.": "La sesión sigue en marcha. {{name}} puede esperar.",
    "Finish up. {{name}} will still be there.": "Termina. {{name}} seguirá ahí.",
    "You blocked {{name}} for a reason.": "Bloqueaste {{name}} por algo.",
    "Is {{name}} the move right now?": "¿{{name}} es lo que toca ahora?",
    "You chose depth over {{name}}.": "Elegiste profundidad en vez de {{name}}.",
    "{{name}} is blocked.": "{{name}} está bloqueada.",
    "{{name}} can wait.": "{{name}} puede esperar.",
    "Earn screen time by completing a task in Drift.": "Gana tiempo de pantalla completando una tarea en Drift.",
    "Your session is still running. Stay with it.": "Tu sesión sigue en marcha. Mantente en ella.",
    "This moment is yours, not your phone's.": "Este momento es tuyo, no de tu teléfono.",
    "Complete a task to earn your time back.": "Completa una tarea para recuperar tu tiempo.",
    "Finish first. This will still be here.": "Termina primero. Esto seguirá aquí.",
    "Complete a task in Drift to unlock.": "Completa una tarea en Drift para desbloquear.",
    "You set this boundary for a reason.": "Pusiste este límite por algo.",
    "No balance. One task changes that.": "Sin saldo. Una tarea lo cambia.",
    "One task in Drift and it's yours.": "Una tarea en Drift y es tuyo.",
    "You chose depth over distraction.": "Elegiste profundidad en vez de distracción.",
    "Nothing here that can't wait.": "Aquí no hay nada que no pueda esperar.",
    "Stillness is productive too.": "Estar quieto también es productivo.",
    "One task is all it takes.": "Basta con una tarea.",
    "Blocked.": "Bloqueada.",
    "Not yet.": "Todavía no.",
    "Not now.": "Ahora no.",
    "Breathe.": "Respira.",
    "Focus.": "Concéntrate.",
    "I'll come back later": "Volveré más tarde",
  ],
  "fr": [
    "{{name}} unlocks when you complete a task in Drift.": "{{name}} se déverrouille quand vous terminez une tâche dans Drift.",
    "{{name}} will still be there in ten minutes.": "{{name}} sera toujours là dans dix minutes.",
    "Session's still running. {{name}} can wait.": "La session continue. {{name}} peut attendre.",
    "Finish up. {{name}} will still be there.": "Finissez. {{name}} sera toujours là.",
    "You blocked {{name}} for a reason.": "Vous avez bloqué {{name}} pour une raison.",
    "Is {{name}} the move right now?": "Est-ce vraiment le moment pour {{name}} ?",
    "You chose depth over {{name}}.": "Vous avez choisi la profondeur plutôt que {{name}}.",
    "{{name}} is blocked.": "{{name}} est bloquée.",
    "{{name}} can wait.": "{{name}} peut attendre.",
    "Earn screen time by completing a task in Drift.": "Gagnez du temps d’écran en terminant une tâche dans Drift.",
    "Your session is still running. Stay with it.": "Votre session est toujours en cours. Restez-y.",
    "This moment is yours, not your phone's.": "Ce moment est à vous, pas à votre téléphone.",
    "Complete a task to earn your time back.": "Terminez une tâche pour regagner votre temps.",
    "Finish first. This will still be here.": "Finissez d’abord. Ce sera toujours là.",
    "Complete a task in Drift to unlock.": "Terminez une tâche dans Drift pour déverrouiller.",
    "You set this boundary for a reason.": "Vous avez fixé cette limite pour une raison.",
    "No balance. One task changes that.": "Plus de solde. Une tâche change tout.",
    "One task in Drift and it's yours.": "Une tâche dans Drift et c’est à vous.",
    "You chose depth over distraction.": "Vous avez choisi la profondeur plutôt que la distraction.",
    "Nothing here that can't wait.": "Rien ici qui ne puisse attendre.",
    "Stillness is productive too.": "L’immobilité aussi est productive.",
    "One task is all it takes.": "Une seule tâche suffit.",
    "Blocked.": "Bloquée.",
    "Not yet.": "Pas encore.",
    "Not now.": "Pas maintenant.",
    "Breathe.": "Respirez.",
    "Focus.": "Concentration.",
    "I'll come back later": "Je reviendrai plus tard",
  ],
  "ar": [
    "{{name}} unlocks when you complete a task in Drift.": "يُفتح {{name}} عندما تكمل مهمة في Drift.",
    "{{name}} will still be there in ten minutes.": "{{name}} سيبقى هناك بعد عشر دقائق.",
    "Session's still running. {{name}} can wait.": "ما زالت الجلسة جارية. {{name}} يمكنه الانتظار.",
    "Finish up. {{name}} will still be there.": "أكمل ما بدأت. {{name}} سيبقى هناك.",
    "You blocked {{name}} for a reason.": "حظرت {{name}} لسبب.",
    "Is {{name}} the move right now?": "هل هذا وقت {{name}}؟",
    "You chose depth over {{name}}.": "اخترت العمق بدل {{name}}.",
    "{{name}} is blocked.": "{{name}} محظور.",
    "{{name}} can wait.": "{{name}} يمكنه الانتظار.",
    "Earn screen time by completing a task in Drift.": "اكسب وقت شاشة بإكمال مهمة في Drift.",
    "Your session is still running. Stay with it.": "ما زالت جلستك جارية. ابقَ معها.",
    "This moment is yours, not your phone's.": "هذه اللحظة لك، وليست لهاتفك.",
    "Complete a task to earn your time back.": "أكمل مهمة لتستعيد وقتك.",
    "Finish first. This will still be here.": "أنهِ أولًا. هذا سيبقى هنا.",
    "Complete a task in Drift to unlock.": "أكمل مهمة في Drift لفتح القفل.",
    "You set this boundary for a reason.": "وضعت هذا الحد لسبب.",
    "No balance. One task changes that.": "لا رصيد. مهمة واحدة تغيّر ذلك.",
    "One task in Drift and it's yours.": "مهمة واحدة في Drift ويصبح لك.",
    "You chose depth over distraction.": "اخترت العمق بدل التشتت.",
    "Nothing here that can't wait.": "لا شيء هنا لا يمكنه الانتظار.",
    "Stillness is productive too.": "السكون منتج أيضًا.",
    "One task is all it takes.": "مهمة واحدة تكفي.",
    "Blocked.": "محظور.",
    "Not yet.": "ليس بعد.",
    "Not now.": "ليس الآن.",
    "Breathe.": "تنفّس.",
    "Focus.": "ركّز.",
    "I'll come back later": "سأعود لاحقًا",
  ],
  "pt": [
    "{{name}} unlocks when you complete a task in Drift.": "{{name}} desbloqueia quando você conclui uma tarefa no Drift.",
    "{{name}} will still be there in ten minutes.": "{{name}} vai continuar aí daqui a dez minutos.",
    "Session's still running. {{name}} can wait.": "A sessão continua. {{name}} pode esperar.",
    "Finish up. {{name}} will still be there.": "Termine. {{name}} vai continuar aí.",
    "You blocked {{name}} for a reason.": "Você bloqueou {{name}} por um motivo.",
    "Is {{name}} the move right now?": "{{name}} é o que importa agora?",
    "You chose depth over {{name}}.": "Você escolheu profundidade em vez de {{name}}.",
    "{{name}} is blocked.": "{{name}} está bloqueado.",
    "{{name}} can wait.": "{{name}} pode esperar.",
    "Earn screen time by completing a task in Drift.": "Ganhe tempo de tela concluindo uma tarefa no Drift.",
    "Your session is still running. Stay with it.": "Sua sessão continua. Fique nela.",
    "This moment is yours, not your phone's.": "Este momento é seu, não do seu celular.",
    "Complete a task to earn your time back.": "Conclua uma tarefa para recuperar seu tempo.",
    "Finish first. This will still be here.": "Termine primeiro. Isto vai continuar aqui.",
    "Complete a task in Drift to unlock.": "Conclua uma tarefa no Drift para desbloquear.",
    "You set this boundary for a reason.": "Você definiu este limite por um motivo.",
    "No balance. One task changes that.": "Sem saldo. Uma tarefa muda isso.",
    "One task in Drift and it's yours.": "Uma tarefa no Drift e é seu.",
    "You chose depth over distraction.": "Você escolheu profundidade em vez de distração.",
    "Nothing here that can't wait.": "Nada aqui que não possa esperar.",
    "Stillness is productive too.": "Ficar parado também é produtivo.",
    "One task is all it takes.": "Uma tarefa já basta.",
    "Blocked.": "Bloqueado.",
    "Not yet.": "Ainda não.",
    "Not now.": "Agora não.",
    "Breathe.": "Respire.",
    "Focus.": "Foco.",
    "I'll come back later": "Volto mais tarde",
  ],
  "ru": [
    "{{name}} unlocks when you complete a task in Drift.": "{{name}} откроется, когда вы выполните задачу в Drift.",
    "{{name}} will still be there in ten minutes.": "{{name}} никуда не денется и через десять минут.",
    "Session's still running. {{name}} can wait.": "Сессия ещё идёт. {{name}} подождёт.",
    "Finish up. {{name}} will still be there.": "Доделайте. {{name}} никуда не денется.",
    "You blocked {{name}} for a reason.": "Вы не зря заблокировали {{name}}.",
    "Is {{name}} the move right now?": "Сейчас время для {{name}}?",
    "You chose depth over {{name}}.": "Вы выбрали глубину вместо {{name}}.",
    "{{name}} is blocked.": "{{name}} заблокировано.",
    "{{name}} can wait.": "{{name}} подождёт.",
    "Earn screen time by completing a task in Drift.": "Зарабатывайте экранное время, выполняя задачи в Drift.",
    "Your session is still running. Stay with it.": "Сессия ещё идёт. Не отвлекайтесь.",
    "This moment is yours, not your phone's.": "Этот момент ваш, а не телефона.",
    "Complete a task to earn your time back.": "Выполните задачу, чтобы вернуть время.",
    "Finish first. This will still be here.": "Сначала закончите. Это никуда не денется.",
    "Complete a task in Drift to unlock.": "Выполните задачу в Drift, чтобы разблокировать.",
    "You set this boundary for a reason.": "Вы не зря поставили эту границу.",
    "No balance. One task changes that.": "Баланс пуст. Одна задача это исправит.",
    "One task in Drift and it's yours.": "Одна задача в Drift — и это ваше.",
    "You chose depth over distraction.": "Вы выбрали глубину вместо отвлечений.",
    "Nothing here that can't wait.": "Здесь нет ничего, что не может подождать.",
    "Stillness is productive too.": "Покой — тоже продуктивно.",
    "One task is all it takes.": "Хватит одной задачи.",
    "Blocked.": "Заблокировано.",
    "Not yet.": "Пока нет.",
    "Not now.": "Не сейчас.",
    "Breathe.": "Дышите.",
    "Focus.": "Фокус.",
    "I'll come back later": "Вернусь позже",
  ],
  "id": [
    "{{name}} unlocks when you complete a task in Drift.": "{{name}} terbuka saat kamu menyelesaikan tugas di Drift.",
    "{{name}} will still be there in ten minutes.": "{{name}} masih ada sepuluh menit lagi.",
    "Session's still running. {{name}} can wait.": "Sesi masih berjalan. {{name}} bisa menunggu.",
    "Finish up. {{name}} will still be there.": "Selesaikan. {{name}} masih akan ada.",
    "You blocked {{name}} for a reason.": "Kamu memblokir {{name}} karena suatu alasan.",
    "Is {{name}} the move right now?": "Apakah {{name}} yang perlu sekarang?",
    "You chose depth over {{name}}.": "Kamu memilih kedalaman daripada {{name}}.",
    "{{name}} is blocked.": "{{name}} diblokir.",
    "{{name}} can wait.": "{{name}} bisa menunggu.",
    "Earn screen time by completing a task in Drift.": "Dapatkan waktu layar dengan menyelesaikan tugas di Drift.",
    "Your session is still running. Stay with it.": "Sesimu masih berjalan. Tetap fokus.",
    "This moment is yours, not your phone's.": "Momen ini milikmu, bukan milik ponselmu.",
    "Complete a task to earn your time back.": "Selesaikan tugas untuk mendapatkan waktumu kembali.",
    "Finish first. This will still be here.": "Selesaikan dulu. Ini tetap di sini.",
    "Complete a task in Drift to unlock.": "Selesaikan tugas di Drift untuk membuka.",
    "You set this boundary for a reason.": "Kamu menetapkan batas ini karena suatu alasan.",
    "No balance. One task changes that.": "Saldo habis. Satu tugas mengubahnya.",
    "One task in Drift and it's yours.": "Satu tugas di Drift dan ini milikmu.",
    "You chose depth over distraction.": "Kamu memilih kedalaman daripada distraksi.",
    "Nothing here that can't wait.": "Tidak ada di sini yang tidak bisa menunggu.",
    "Stillness is productive too.": "Diam pun produktif.",
    "One task is all it takes.": "Satu tugas sudah cukup.",
    "Blocked.": "Diblokir.",
    "Not yet.": "Belum.",
    "Not now.": "Jangan sekarang.",
    "Breathe.": "Tarik napas.",
    "Focus.": "Fokus.",
    "I'll come back later": "Nanti saya kembali",
  ],
  "de": [
    "{{name}} unlocks when you complete a task in Drift.": "{{name}} wird frei, wenn du eine Aufgabe in Drift erledigst.",
    "{{name}} will still be there in ten minutes.": "{{name}} ist in zehn Minuten immer noch da.",
    "Session's still running. {{name}} can wait.": "Die Sitzung läuft noch. {{name}} kann warten.",
    "Finish up. {{name}} will still be there.": "Mach fertig. {{name}} ist dann noch da.",
    "You blocked {{name}} for a reason.": "Du hast {{name}} aus gutem Grund gesperrt.",
    "Is {{name}} the move right now?": "Ist {{name}} gerade dran?",
    "You chose depth over {{name}}.": "Du hast Tiefe statt {{name}} gewählt.",
    "{{name}} is blocked.": "{{name}} ist gesperrt.",
    "{{name}} can wait.": "{{name}} kann warten.",
    "Earn screen time by completing a task in Drift.": "Verdiene Bildschirmzeit, indem du eine Aufgabe in Drift erledigst.",
    "Your session is still running. Stay with it.": "Deine Sitzung läuft noch. Bleib dabei.",
    "This moment is yours, not your phone's.": "Dieser Moment gehört dir, nicht deinem Handy.",
    "Complete a task to earn your time back.": "Erledige eine Aufgabe, um dir deine Zeit zurückzuholen.",
    "Finish first. This will still be here.": "Erst fertig machen. Das hier bleibt.",
    "Complete a task in Drift to unlock.": "Erledige eine Aufgabe in Drift, um zu entsperren.",
    "You set this boundary for a reason.": "Du hast diese Grenze aus gutem Grund gesetzt.",
    "No balance. One task changes that.": "Kein Guthaben. Eine Aufgabe ändert das.",
    "One task in Drift and it's yours.": "Eine Aufgabe in Drift und es gehört dir.",
    "You chose depth over distraction.": "Du hast Tiefe statt Ablenkung gewählt.",
    "Nothing here that can't wait.": "Hier gibt es nichts, was nicht warten kann.",
    "Stillness is productive too.": "Stillsein ist auch produktiv.",
    "One task is all it takes.": "Eine Aufgabe reicht.",
    "Blocked.": "Gesperrt.",
    "Not yet.": "Noch nicht.",
    "Not now.": "Nicht jetzt.",
    "Breathe.": "Atme.",
    "Focus.": "Fokus.",
    "I'll come back later": "Ich komme später wieder",
  ],
  "ja": [
    "{{name}} unlocks when you complete a task in Drift.": "Driftでタスクを完了すると{{name}}が解除されます。",
    "{{name}} will still be there in ten minutes.": "{{name}}は10分後もそこにあります。",
    "Session's still running. {{name}} can wait.": "セッションはまだ続いています。{{name}}は待てます。",
    "Finish up. {{name}} will still be there.": "やり切ろう。{{name}}はなくなりません。",
    "You blocked {{name}} for a reason.": "{{name}}をブロックしたのには理由があります。",
    "Is {{name}} the move right now?": "今は{{name}}の時間？",
    "You chose depth over {{name}}.": "あなたは{{name}}より深い集中を選びました。",
    "{{name}} is blocked.": "{{name}}はブロック中です。",
    "{{name}} can wait.": "{{name}}は待てます。",
    "Earn screen time by completing a task in Drift.": "Driftでタスクを完了してスクリーンタイムを獲得しましょう。",
    "Your session is still running. Stay with it.": "セッションはまだ続いています。そのまま集中しましょう。",
    "This moment is yours, not your phone's.": "この瞬間はあなたのもの。スマホのものではありません。",
    "Complete a task to earn your time back.": "タスクを完了して時間を取り戻しましょう。",
    "Finish first. This will still be here.": "まずは終わらせて。これはなくなりません。",
    "Complete a task in Drift to unlock.": "Driftでタスクを完了すると解除されます。",
    "You set this boundary for a reason.": "この境界線を決めたのには理由があります。",
    "No balance. One task changes that.": "残高ゼロ。タスク1つで変わります。",
    "One task in Drift and it's yours.": "Driftでタスクを1つやれば、あなたのもの。",
    "You chose depth over distraction.": "あなたは気晴らしより深い集中を選びました。",
    "Nothing here that can't wait.": "ここに、待てないものはありません。",
    "Stillness is productive too.": "じっとしているのも生産的。",
    "One task is all it takes.": "タスク1つで十分。",
    "Blocked.": "ブロック中。",
    "Not yet.": "まだ。",
    "Not now.": "今はしない。",
    "Breathe.": "深呼吸。",
    "Focus.": "集中。",
    "I'll come back later": "また後で",
  ],
  "tr": [
    "{{name}} unlocks when you complete a task in Drift.": "Drift'te bir görev tamamladığında {{name}} açılır.",
    "{{name}} will still be there in ten minutes.": "{{name}} on dakika sonra da orada olacak.",
    "Session's still running. {{name}} can wait.": "Oturum hâlâ sürüyor. {{name}} bekleyebilir.",
    "Finish up. {{name}} will still be there.": "Bitir. {{name}} orada olacak.",
    "You blocked {{name}} for a reason.": "{{name}} uygulamasını bir sebeple engelledin.",
    "Is {{name}} the move right now?": "Şimdi {{name}} zamanı mı?",
    "You chose depth over {{name}}.": "{{name}} yerine derinliği seçtin.",
    "{{name}} is blocked.": "{{name}} engelli.",
    "{{name}} can wait.": "{{name}} bekleyebilir.",
    "Earn screen time by completing a task in Drift.": "Drift'te bir görev tamamlayarak ekran süresi kazan.",
    "Your session is still running. Stay with it.": "Oturumun hâlâ sürüyor. Devam et.",
    "This moment is yours, not your phone's.": "Bu an senin, telefonunun değil.",
    "Complete a task to earn your time back.": "Zamanını geri kazanmak için bir görev tamamla.",
    "Finish first. This will still be here.": "Önce bitir. Bu burada olacak.",
    "Complete a task in Drift to unlock.": "Kilidi açmak için Drift'te bir görev tamamla.",
    "You set this boundary for a reason.": "Bu sınırı bir sebeple koydun.",
    "No balance. One task changes that.": "Bakiye yok. Bir görev bunu değiştirir.",
    "One task in Drift and it's yours.": "Drift'te bir görev ve senin.",
    "You chose depth over distraction.": "Dağınıklık yerine derinliği seçtin.",
    "Nothing here that can't wait.": "Burada bekleyemeyecek bir şey yok.",
    "Stillness is productive too.": "Durgunluk da verimliliktir.",
    "One task is all it takes.": "Tek bir görev yeter.",
    "Blocked.": "Engelli.",
    "Not yet.": "Henüz değil.",
    "Not now.": "Şimdi değil.",
    "Breathe.": "Nefes al.",
    "Focus.": "Odaklan.",
    "I'll come back later": "Sonra geleceğim",
  ],
  "vi": [
    "{{name}} unlocks when you complete a task in Drift.": "{{name}} mở khóa khi bạn hoàn thành một việc trong Drift.",
    "{{name}} will still be there in ten minutes.": "{{name}} vẫn còn đó sau mười phút nữa.",
    "Session's still running. {{name}} can wait.": "Phiên vẫn đang chạy. {{name}} có thể đợi.",
    "Finish up. {{name}} will still be there.": "Làm cho xong. {{name}} vẫn còn đó.",
    "You blocked {{name}} for a reason.": "Bạn chặn {{name}} là có lý do.",
    "Is {{name}} the move right now?": "Bây giờ là lúc cho {{name}} sao?",
    "You chose depth over {{name}}.": "Bạn đã chọn chiều sâu thay vì {{name}}.",
    "{{name}} is blocked.": "{{name}} đang bị chặn.",
    "{{name}} can wait.": "{{name}} có thể đợi.",
    "Earn screen time by completing a task in Drift.": "Kiếm thời gian màn hình bằng cách hoàn thành việc trong Drift.",
    "Your session is still running. Stay with it.": "Phiên vẫn đang chạy. Cứ tiếp tục nhé.",
    "This moment is yours, not your phone's.": "Khoảnh khắc này là của bạn, không phải của điện thoại.",
    "Complete a task to earn your time back.": "Hoàn thành một việc để lấy lại thời gian.",
    "Finish first. This will still be here.": "Làm xong trước. Thứ này vẫn ở đây.",
    "Complete a task in Drift to unlock.": "Hoàn thành một việc trong Drift để mở khóa.",
    "You set this boundary for a reason.": "Bạn đặt giới hạn này là có lý do.",
    "No balance. One task changes that.": "Hết số dư. Một việc sẽ thay đổi điều đó.",
    "One task in Drift and it's yours.": "Một việc trong Drift là của bạn.",
    "You chose depth over distraction.": "Bạn đã chọn chiều sâu thay vì xao nhãng.",
    "Nothing here that can't wait.": "Không có gì ở đây là không thể đợi.",
    "Stillness is productive too.": "Tĩnh lặng cũng là năng suất.",
    "One task is all it takes.": "Chỉ cần một việc.",
    "Blocked.": "Đã chặn.",
    "Not yet.": "Chưa.",
    "Not now.": "Để sau.",
    "Breathe.": "Hít thở.",
    "Focus.": "Tập trung.",
    "I'll come back later": "Để sau",
  ],
  "ko": [
    "{{name}} unlocks when you complete a task in Drift.": "Drift에서 할 일을 완료하면 {{name}}이(가) 열려요.",
    "{{name}} will still be there in ten minutes.": "{{name}}은(는) 10분 뒤에도 거기 있어요.",
    "Session's still running. {{name}} can wait.": "세션이 아직 진행 중이에요. {{name}}은(는) 기다릴 수 있어요.",
    "Finish up. {{name}} will still be there.": "마무리하세요. {{name}}은(는) 그대로 있어요.",
    "You blocked {{name}} for a reason.": "{{name}}을(를) 차단한 데는 이유가 있어요.",
    "Is {{name}} the move right now?": "지금 {{name}}을(를) 할 때인가요?",
    "You chose depth over {{name}}.": "{{name}} 대신 몰입을 택했어요.",
    "{{name}} is blocked.": "{{name}}이(가) 차단됐어요.",
    "{{name}} can wait.": "{{name}}은(는) 기다릴 수 있어요.",
    "Earn screen time by completing a task in Drift.": "Drift에서 할 일을 완료해 스크린 타임을 버세요.",
    "Your session is still running. Stay with it.": "세션이 아직 진행 중이에요. 계속 집중하세요.",
    "This moment is yours, not your phone's.": "이 순간은 휴대폰이 아니라 당신의 것이에요.",
    "Complete a task to earn your time back.": "할 일을 완료해서 시간을 되찾으세요.",
    "Finish first. This will still be here.": "먼저 끝내세요. 이건 그대로 있어요.",
    "Complete a task in Drift to unlock.": "Drift에서 할 일을 완료하면 잠금이 풀려요.",
    "You set this boundary for a reason.": "이 경계를 정한 데는 이유가 있어요.",
    "No balance. One task changes that.": "잔액이 없어요. 할 일 하나면 달라져요.",
    "One task in Drift and it's yours.": "Drift에서 할 일 하나면 당신 거예요.",
    "You chose depth over distraction.": "산만함 대신 몰입을 택했어요.",
    "Nothing here that can't wait.": "여기엔 기다릴 수 없는 게 없어요.",
    "Stillness is productive too.": "가만히 있는 것도 생산적이에요.",
    "One task is all it takes.": "할 일 하나면 충분해요.",
    "Blocked.": "차단됨.",
    "Not yet.": "아직이에요.",
    "Not now.": "나중에.",
    "Breathe.": "숨 쉬세요.",
    "Focus.": "집중.",
    "I'll come back later": "나중에 다시 올게요",
  ],
  "it": [
    "{{name}} unlocks when you complete a task in Drift.": "{{name}} si sblocca quando completi un'attività in Drift.",
    "{{name}} will still be there in ten minutes.": "{{name}} sarà ancora lì tra dieci minuti.",
    "Session's still running. {{name}} can wait.": "La sessione è ancora in corso. {{name}} può aspettare.",
    "Finish up. {{name}} will still be there.": "Finisci. {{name}} sarà ancora lì.",
    "You blocked {{name}} for a reason.": "Hai bloccato {{name}} per un motivo.",
    "Is {{name}} the move right now?": "{{name}} è la scelta giusta adesso?",
    "You chose depth over {{name}}.": "Hai scelto la profondità invece di {{name}}.",
    "{{name}} is blocked.": "{{name}} è bloccata.",
    "{{name}} can wait.": "{{name}} può aspettare.",
    "Earn screen time by completing a task in Drift.": "Guadagna tempo di utilizzo completando un'attività in Drift.",
    "Your session is still running. Stay with it.": "La sessione è ancora in corso. Resta concentrato.",
    "This moment is yours, not your phone's.": "Questo momento è tuo, non del tuo telefono.",
    "Complete a task to earn your time back.": "Completa un'attività per riavere il tuo tempo.",
    "Finish first. This will still be here.": "Prima finisci. Questo resterà qui.",
    "Complete a task in Drift to unlock.": "Completa un'attività in Drift per sbloccare.",
    "You set this boundary for a reason.": "Hai fissato questo limite per un motivo.",
    "No balance. One task changes that.": "Saldo esaurito. Un'attività cambia tutto.",
    "One task in Drift and it's yours.": "Un'attività in Drift ed è tua.",
    "You chose depth over distraction.": "Hai scelto la profondità invece della distrazione.",
    "Nothing here that can't wait.": "Qui non c'è niente che non possa aspettare.",
    "Stillness is productive too.": "Anche stare fermi è produttivo.",
    "One task is all it takes.": "Basta un'attività.",
    "Blocked.": "Bloccata.",
    "Not yet.": "Non ancora.",
    "Not now.": "Non ora.",
    "Breathe.": "Respira.",
    "Focus.": "Concentrati.",
    "I'll come back later": "Torno più tardi",
  ],
  "pl": [
    "{{name}} unlocks when you complete a task in Drift.": "{{name}} odblokuje się, gdy ukończysz zadanie w Drift.",
    "{{name}} will still be there in ten minutes.": "{{name}} będzie tam też za dziesięć minut.",
    "Session's still running. {{name}} can wait.": "Sesja wciąż trwa. {{name}} może poczekać.",
    "Finish up. {{name}} will still be there.": "Dokończ. {{name}} nigdzie nie ucieknie.",
    "You blocked {{name}} for a reason.": "Zablokowałeś(-aś) {{name}} nie bez powodu.",
    "Is {{name}} the move right now?": "Czy teraz czas na {{name}}?",
    "You chose depth over {{name}}.": "Wybrałeś(-aś) głębię zamiast {{name}}.",
    "{{name}} is blocked.": "{{name}} jest zablokowane.",
    "{{name}} can wait.": "{{name}} może poczekać.",
    "Earn screen time by completing a task in Drift.": "Zdobądź czas przed ekranem, kończąc zadanie w Drift.",
    "Your session is still running. Stay with it.": "Sesja wciąż trwa. Wytrwaj.",
    "This moment is yours, not your phone's.": "Ta chwila należy do ciebie, nie do telefonu.",
    "Complete a task to earn your time back.": "Ukończ zadanie, aby odzyskać czas.",
    "Finish first. This will still be here.": "Najpierw skończ. To tu poczeka.",
    "Complete a task in Drift to unlock.": "Ukończ zadanie w Drift, aby odblokować.",
    "You set this boundary for a reason.": "Ustaliłeś(-aś) tę granicę nie bez powodu.",
    "No balance. One task changes that.": "Brak salda. Jedno zadanie to zmieni.",
    "One task in Drift and it's yours.": "Jedno zadanie w Drift i jest twoje.",
    "You chose depth over distraction.": "Wybrałeś(-aś) głębię zamiast rozproszenia.",
    "Nothing here that can't wait.": "Nie ma tu nic, co nie może poczekać.",
    "Stillness is productive too.": "Bezruch też jest produktywny.",
    "One task is all it takes.": "Wystarczy jedno zadanie.",
    "Blocked.": "Zablokowane.",
    "Not yet.": "Jeszcze nie.",
    "Not now.": "Nie teraz.",
    "Breathe.": "Oddychaj.",
    "Focus.": "Skup się.",
    "I'll come back later": "Wrócę później",
  ],
  "uk": [
    "{{name}} unlocks when you complete a task in Drift.": "{{name}} відкриється, коли ви виконаєте завдання в Drift.",
    "{{name}} will still be there in ten minutes.": "{{name}} нікуди не дінеться й за десять хвилин.",
    "Session's still running. {{name}} can wait.": "Сесія ще триває. {{name}} зачекає.",
    "Finish up. {{name}} will still be there.": "Доробіть. {{name}} нікуди не дінеться.",
    "You blocked {{name}} for a reason.": "Ви недарма заблокували {{name}}.",
    "Is {{name}} the move right now?": "Зараз час для {{name}}?",
    "You chose depth over {{name}}.": "Ви обрали глибину замість {{name}}.",
    "{{name}} is blocked.": "{{name}} заблоковано.",
    "{{name}} can wait.": "{{name}} зачекає.",
    "Earn screen time by completing a task in Drift.": "Заробляйте екранний час, виконуючи завдання в Drift.",
    "Your session is still running. Stay with it.": "Сесія ще триває. Не відволікайтеся.",
    "This moment is yours, not your phone's.": "Ця мить ваша, а не телефона.",
    "Complete a task to earn your time back.": "Виконайте завдання, щоб повернути час.",
    "Finish first. This will still be here.": "Спершу завершіть. Це нікуди не дінеться.",
    "Complete a task in Drift to unlock.": "Виконайте завдання в Drift, щоб розблокувати.",
    "You set this boundary for a reason.": "Ви недарма поставили цю межу.",
    "No balance. One task changes that.": "Баланс порожній. Одне завдання це виправить.",
    "One task in Drift and it's yours.": "Одне завдання в Drift — і це ваше.",
    "You chose depth over distraction.": "Ви обрали глибину замість відволікань.",
    "Nothing here that can't wait.": "Тут немає нічого, що не може почекати.",
    "Stillness is productive too.": "Спокій — теж продуктивно.",
    "One task is all it takes.": "Вистачить одного завдання.",
    "Blocked.": "Заблоковано.",
    "Not yet.": "Поки ні.",
    "Not now.": "Не зараз.",
    "Breathe.": "Дихайте.",
    "Focus.": "Фокус.",
    "I'll come back later": "Повернуся пізніше",
  ],
  "th": [
    "{{name}} unlocks when you complete a task in Drift.": "{{name}} จะปลดล็อกเมื่อคุณทำงานใน Drift เสร็จ",
    "{{name}} will still be there in ten minutes.": "{{name}} ยังอยู่ที่เดิมในอีกสิบนาที",
    "Session's still running. {{name}} can wait.": "เซสชันยังดำเนินอยู่ {{name}} รอได้",
    "Finish up. {{name}} will still be there.": "ทำให้เสร็จ {{name}} ยังอยู่ที่เดิม",
    "You blocked {{name}} for a reason.": "คุณบล็อก {{name}} ไว้มีเหตุผล",
    "Is {{name}} the move right now?": "ตอนนี้เป็นเวลาของ {{name}} เหรอ?",
    "You chose depth over {{name}}.": "คุณเลือกความลึกซึ้งแทน {{name}}",
    "{{name}} is blocked.": "{{name}} ถูกบล็อก",
    "{{name}} can wait.": "{{name}} รอได้",
    "Earn screen time by completing a task in Drift.": "หาเวลาหน้าจอด้วยการทำงานใน Drift ให้เสร็จ",
    "Your session is still running. Stay with it.": "เซสชันยังดำเนินอยู่ อยู่กับมันต่อ",
    "This moment is yours, not your phone's.": "ช่วงเวลานี้เป็นของคุณ ไม่ใช่ของโทรศัพท์",
    "Complete a task to earn your time back.": "ทำงานให้เสร็จเพื่อเอาเวลาคืน",
    "Finish first. This will still be here.": "ทำให้เสร็จก่อน สิ่งนี้ยังอยู่ตรงนี้",
    "Complete a task in Drift to unlock.": "ทำงานใน Drift ให้เสร็จเพื่อปลดล็อก",
    "You set this boundary for a reason.": "คุณตั้งขอบเขตนี้ไว้มีเหตุผล",
    "No balance. One task changes that.": "ยอดหมด งานเดียวเปลี่ยนได้",
    "One task in Drift and it's yours.": "งานเดียวใน Drift แล้วเป็นของคุณ",
    "You chose depth over distraction.": "คุณเลือกความลึกซึ้งแทนสิ่งรบกวน",
    "Nothing here that can't wait.": "ไม่มีอะไรที่นี่ที่รอไม่ได้",
    "Stillness is productive too.": "ความนิ่งก็คือการทำงานอย่างหนึ่ง",
    "One task is all it takes.": "งานเดียวก็พอ",
    "Blocked.": "บล็อกอยู่",
    "Not yet.": "ยังไม่",
    "Not now.": "ไว้ทีหลัง",
    "Breathe.": "หายใจ",
    "Focus.": "โฟกัส",
    "I'll come back later": "ไว้กลับมาทีหลัง",
  ],
  "nl": [
    "{{name}} unlocks when you complete a task in Drift.": "{{name}} gaat open als je een taak in Drift voltooit.",
    "{{name}} will still be there in ten minutes.": "{{name}} is er over tien minuten ook nog.",
    "Session's still running. {{name}} can wait.": "De sessie loopt nog. {{name}} kan wachten.",
    "Finish up. {{name}} will still be there.": "Maak het af. {{name}} is er straks nog.",
    "You blocked {{name}} for a reason.": "Je hebt {{name}} niet voor niets geblokkeerd.",
    "Is {{name}} the move right now?": "Is {{name}} nu wat je wilt?",
    "You chose depth over {{name}}.": "Je koos diepgang boven {{name}}.",
    "{{name}} is blocked.": "{{name}} is geblokkeerd.",
    "{{name}} can wait.": "{{name}} kan wachten.",
    "Earn screen time by completing a task in Drift.": "Verdien schermtijd door een taak in Drift te voltooien.",
    "Your session is still running. Stay with it.": "Je sessie loopt nog. Blijf erbij.",
    "This moment is yours, not your phone's.": "Dit moment is van jou, niet van je telefoon.",
    "Complete a task to earn your time back.": "Voltooi een taak om je tijd terug te verdienen.",
    "Finish first. This will still be here.": "Eerst afmaken. Dit is er straks nog.",
    "Complete a task in Drift to unlock.": "Voltooi een taak in Drift om te ontgrendelen.",
    "You set this boundary for a reason.": "Je hebt deze grens niet voor niets gesteld.",
    "No balance. One task changes that.": "Geen saldo. Eén taak verandert dat.",
    "One task in Drift and it's yours.": "Eén taak in Drift en het is van jou.",
    "You chose depth over distraction.": "Je koos diepgang boven afleiding.",
    "Nothing here that can't wait.": "Niets hier dat niet kan wachten.",
    "Stillness is productive too.": "Stilte is ook productief.",
    "One task is all it takes.": "Eén taak is genoeg.",
    "Blocked.": "Geblokkeerd.",
    "Not yet.": "Nog niet.",
    "Not now.": "Niet nu.",
    "Breathe.": "Adem in.",
    "Focus.": "Focus.",
    "I'll come back later": "Ik kom later terug",
  ],
]

fileprivate func driftLanguage() -> String {
  if let code = UserDefaults(suiteName: "group.com.sanghani.drift.shared")?.string(forKey: "drift_language"),
     !code.isEmpty { return code }
  let pref = Locale.preferredLanguages.first ?? "en"
  if pref.hasPrefix("zh") { return (pref.contains("Hant") || pref.contains("TW") || pref.contains("HK")) ? "zh-Hant" : "zh-Hans" }
  return String(pref.split(separator: "-").first ?? "en")
}

fileprivate func driftL(_ key: String, _ params: [String: String] = [:]) -> String {
  var s = DRIFT_L10N[driftLanguage()]?[key] ?? key
  for (k, v) in params { s = s.replacingOccurrences(of: "{{\(k)}}", with: v) }
  return s
}
// END GENERATED L10N
