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
      // The user is mid-session on their blocked apps and still has balance.
      // This is the only moment iOS actually tells us that, so it's where the
      // "is this still the move?" nudge belongs.
      nudgeStillTheMove(minutesIn: checkpointSec / 60)
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

  // Extra intervention points. DeviceActivityMonitor defines these alongside
  // eventDidReachThreshold; we previously overrode none of them, so the only
  // signal we ever acted on was "threshold crossed". Each one below is a
  // separate chance to catch the user mid-session.
  //
  // NOTE: delivery of the *warning* callbacks depends on a warningTime being
  // configured on the event/schedule, which we do not currently set — so these
  // may never fire today. They are cheap to keep: an override that iOS never
  // calls costs nothing, and wiring warningTime later needs no extension change.
  override func eventWillReachThresholdWarning(
    _ event: DeviceActivityEvent.Name,
    activity: DeviceActivityName
  ) {
    super.eventWillReachThresholdWarning(event, activity: activity)
    // Raw string, not the .balanceDepleted symbol — that DeviceActivityEvent.Name
    // extension lives in the main app target and is not visible here.
    guard event.rawValue == "drift.balanceDepleted" else { return }
    let content = UNMutableNotificationContent()
    content.title = driftL("Almost out of time")
    content.body = driftL("Your earned time is nearly gone. Wrap up, or complete a task to keep going.")
    content.sound = nil
    UNUserNotificationCenter.current().add(
      UNNotificationRequest(
        identifier: "drift.monitor.warn.\(Int(Date().timeIntervalSince1970))",
        content: content,
        trigger: nil
      )
    )
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

    // Mirrors applyBlocking() in blockedApps.js: the user's own picks win for
    // everyone, and Pro only matters when nothing is picked — a non-Pro user
    // with an empty selection falls back to every category. This used to force
    // .all for any non-Pro user, so the background shield blocked far more
    // than the foreground one the user had just seen.
    let isPro = defaults.bool(forKey: "drift_pro_access")
    let picked = !selection.applicationTokens.isEmpty
      || !selection.categoryTokens.isEmpty
      || !selection.webDomainTokens.isEmpty
    let store = ManagedSettingsStore(named: storeName())
    store.shield.applications = selection.applicationTokens.isEmpty
      ? nil : selection.applicationTokens
    if picked || isPro {
      store.shield.applicationCategories = selection.categoryTokens.isEmpty
        ? nil : .specific(selection.categoryTokens)
    } else {
      store.shield.applicationCategories = .all(except: Set())
    }
    store.shield.webDomains = selection.webDomainTokens.isEmpty
      ? nil : selection.webDomainTokens
  }

  private func clearShield() {
    let store = ManagedSettingsStore(named: storeName())
    store.shield.applications = nil
    store.shield.applicationCategories = nil
    store.shield.webDomains = nil
  }

  /// Mid-session nudge: "you've been at this a while — still worth it?"
  ///
  /// IMPORTANT — what we can and cannot know here. FamilyActivitySelection hands
  /// us opaque ApplicationTokens; Apple deliberately never exposes the bundle id
  /// or display name, and there is no API that reports which app is foregrounded.
  /// So this CANNOT say "Instagram" on its own. If the user has told Drift what
  /// their own biggest time-sink is, we echo that string back; otherwise the copy
  /// stays app-agnostic. Never guess an app name.
  ///
  /// Capped per day so this reads as a nudge and not as nagging — a user who
  /// earned three hours would otherwise get twelve of these.
  private func nudgeStillTheMove(minutesIn: Int) {
    let defaults = UserDefaults(suiteName: APP_GROUP)

    // Respect the user's opt-out.
    guard defaults?.object(forKey: "drift_nudges_enabled") as? Bool ?? true else { return }

    let today = localDayKey()
    if defaults?.string(forKey: "drift_nudge_day") != today {
      defaults?.set(today, forKey: "drift_nudge_day")
      defaults?.set(0, forKey: "drift_nudge_count")
    }
    let sent = defaults?.integer(forKey: "drift_nudge_count") ?? 0
    guard sent < 4 else { return }
    defaults?.set(sent + 1, forKey: "drift_nudge_count")

    // Optional user-supplied label, e.g. "Instagram". Set in-app; absent by default.
    let label = (defaults?.string(forKey: "drift_distraction_label") ?? "")
      .trimmingCharacters(in: .whitespacesAndNewlines)

    let content = UNMutableNotificationContent()
    if !label.isEmpty {
      content.title = driftL("Is {{label}} really the move right now?", ["label": label])
    } else {
      content.title = driftL("Is this really the move right now?")
    }
    let mins = max(1, minutesIn)
    let bodies = [
      driftL("You're {{mins}} minutes in. No judgment, just checking.", ["mins": "\(mins)"]),
      driftL("{{mins}} minutes gone. Still worth it?", ["mins": "\(mins)"]),
      driftL("That's {{mins}} minutes of your earned time. Your call.", ["mins": "\(mins)"]),
      driftL("{{mins}} minutes in. There's a task waiting if you'd rather.", ["mins": "\(mins)"]),
    ]
    content.body = bodies[min(sent, bodies.count - 1)]
    content.sound = nil  // silent — a buzz mid-scroll is the wrong texture

    UNUserNotificationCenter.current().add(
      UNNotificationRequest(
        identifier: "drift.monitor.nudge.\(Int(Date().timeIntervalSince1970))",
        content: content,
        trigger: nil
      )
    )
  }

  private func notifyOutOfTime() {
    let content = UNMutableNotificationContent()
    content.title = driftL("Time's up")
    content.body = driftL("You're out of earned time. Complete a task to unlock your apps.")
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

// BEGIN GENERATED L10N (tools/i18n/build.js) — do not edit by hand
// Extensions can't see the app's JS catalogs, so each carries its own table.
// Language: what the app last wrote to the App Group (ScreenTimeModule
// .setLanguage), else the device's preferred language, else English.
fileprivate let DRIFT_L10N: [String: [String: String]] = [
  "zh-Hans": [
    "Almost out of time": "时间快用完了",
    "Your earned time is nearly gone. Wrap up, or complete a task to keep going.": "已赚取的时间快用完了。收个尾，或完成一个任务继续。",
    "Is {{label}} really the move right now?": "现在真的该用 {{label}} 吗？",
    "Is this really the move right now?": "现在真的该做这个吗？",
    "You're {{mins}} minutes in. No judgment, just checking.": "已经 {{mins}} 分钟了。不评判，只是确认一下。",
    "{{mins}} minutes gone. Still worth it?": "已经过去 {{mins}} 分钟了。还值得吗？",
    "That's {{mins}} minutes of your earned time. Your call.": "这是你已赚取时间中的 {{mins}} 分钟。你来决定。",
    "{{mins}} minutes in. There's a task waiting if you'd rather.": "已经 {{mins}} 分钟了。如果你愿意，还有个任务在等你。",
    "Time's up": "时间到",
    "You're out of earned time. Complete a task to unlock your apps.": "你已赚取的时间用完了。完成一个任务来解锁 App。",
  ],
  "zh-Hant": [
    "Almost out of time": "時間快用完了",
    "Your earned time is nearly gone. Wrap up, or complete a task to keep going.": "賺到的時間快用完了。收個尾，或完成一個任務繼續。",
    "Is {{label}} really the move right now?": "現在真的該用 {{label}} 嗎？",
    "Is this really the move right now?": "現在真的該做這個嗎？",
    "You're {{mins}} minutes in. No judgment, just checking.": "已經 {{mins}} 分鐘了。不評判，只是確認一下。",
    "{{mins}} minutes gone. Still worth it?": "已經過了 {{mins}} 分鐘。還值得嗎？",
    "That's {{mins}} minutes of your earned time. Your call.": "這是你已賺時間中的 {{mins}} 分鐘。你決定。",
    "{{mins}} minutes in. There's a task waiting if you'd rather.": "已經 {{mins}} 分鐘了。如果你願意，還有個任務在等你。",
    "Time's up": "時間到",
    "You're out of earned time. Complete a task to unlock your apps.": "你賺到的時間用完了。完成一個任務來解鎖 App。",
  ],
  "hi": [
    "Almost out of time": "समय लगभग ख़त्म",
    "Your earned time is nearly gone. Wrap up, or complete a task to keep going.": "आपका कमाया समय लगभग ख़त्म। समेटें, या आगे बढ़ने के लिए एक काम पूरा करें।",
    "Is {{label}} really the move right now?": "क्या अभी सच में {{label}} खोलना है?",
    "Is this really the move right now?": "क्या अभी सच में यही करना है?",
    "You're {{mins}} minutes in. No judgment, just checking.": "आपको {{mins}} मिनट हो गए। कोई टोका-टाकी नहीं, बस पूछ रहे हैं।",
    "{{mins}} minutes gone. Still worth it?": "{{mins}} मिनट गए। अब भी इसके लायक है?",
    "That's {{mins}} minutes of your earned time. Your call.": "यह आपके कमाए समय के {{mins}} मिनट हैं। फ़ैसला आपका।",
    "{{mins}} minutes in. There's a task waiting if you'd rather.": "{{mins}} मिनट हो गए। चाहें तो एक काम इंतज़ार कर रहा है।",
    "Time's up": "समय ख़त्म",
    "You're out of earned time. Complete a task to unlock your apps.": "आपका कमाया समय ख़त्म। ऐप अनलॉक करने के लिए एक काम पूरा करें।",
  ],
  "es": [
    "Almost out of time": "Casi sin tiempo",
    "Your earned time is nearly gone. Wrap up, or complete a task to keep going.": "Tu tiempo ganado casi se ha agotado. Termina o completa una tarea para seguir.",
    "Is {{label}} really the move right now?": "¿De verdad {{label}} es lo que toca ahora?",
    "Is this really the move right now?": "¿De verdad es lo que toca ahora?",
    "You're {{mins}} minutes in. No judgment, just checking.": "Llevas {{mins}} minutos. Sin juzgar, solo preguntamos.",
    "{{mins}} minutes gone. Still worth it?": "{{mins}} minutos ya. ¿Sigue mereciendo la pena?",
    "That's {{mins}} minutes of your earned time. Your call.": "Son {{mins}} minutos de tu tiempo ganado. Tú decides.",
    "{{mins}} minutes in. There's a task waiting if you'd rather.": "{{mins}} minutos ya. Hay una tarea esperando si lo prefieres.",
    "Time's up": "Se acabó el tiempo",
    "You're out of earned time. Complete a task to unlock your apps.": "Te has quedado sin tiempo ganado. Completa una tarea para desbloquear tus apps.",
  ],
  "fr": [
    "Almost out of time": "Presque plus de temps",
    "Your earned time is nearly gone. Wrap up, or complete a task to keep going.": "Votre temps gagné est presque épuisé. Finissez, ou terminez une tâche pour continuer.",
    "Is {{label}} really the move right now?": "Est-ce vraiment le moment pour {{label}} ?",
    "Is this really the move right now?": "Est-ce vraiment le bon moment ?",
    "You're {{mins}} minutes in. No judgment, just checking.": "Ça fait {{mins}} minutes. Sans jugement, on vérifie juste.",
    "{{mins}} minutes gone. Still worth it?": "{{mins}} minutes passées. Ça en vaut toujours la peine ?",
    "That's {{mins}} minutes of your earned time. Your call.": "Ça fait {{mins}} minutes de votre temps gagné. À vous de voir.",
    "{{mins}} minutes in. There's a task waiting if you'd rather.": "{{mins}} minutes déjà. Une tâche vous attend si vous préférez.",
    "Time's up": "C’est fini",
    "You're out of earned time. Complete a task to unlock your apps.": "Vous n’avez plus de temps gagné. Terminez une tâche pour déverrouiller vos apps.",
  ],
  "ar": [
    "Almost out of time": "الوقت يكاد ينفد",
    "Your earned time is nearly gone. Wrap up, or complete a task to keep going.": "وقتك المكتسب على وشك النفاد. اختم ما تفعله، أو أكمل مهمة لتستمر.",
    "Is {{label}} really the move right now?": "هل {{label}} فعلًا ما يجب فعله الآن؟",
    "Is this really the move right now?": "هل هذا فعلًا ما يجب فعله الآن؟",
    "You're {{mins}} minutes in. No judgment, just checking.": "مرّت {{mins}} دقيقة. بلا حكم، مجرد سؤال.",
    "{{mins}} minutes gone. Still worth it?": "مضت {{mins}} دقيقة. هل ما زال يستحق؟",
    "That's {{mins}} minutes of your earned time. Your call.": "هذه {{mins}} دقيقة من وقتك المكتسب. القرار لك.",
    "{{mins}} minutes in. There's a task waiting if you'd rather.": "مرّت {{mins}} دقيقة. هناك مهمة بانتظارك إن أردت.",
    "Time's up": "انتهى الوقت",
    "You're out of earned time. Complete a task to unlock your apps.": "نفد وقتك المكتسب. أكمل مهمة لفتح تطبيقاتك.",
  ],
  "pt": [
    "Almost out of time": "Quase sem tempo",
    "Your earned time is nearly gone. Wrap up, or complete a task to keep going.": "Seu tempo ganho está quase acabando. Finalize, ou conclua uma tarefa para continuar.",
    "Is {{label}} really the move right now?": "{{label}} é mesmo o que importa agora?",
    "Is this really the move right now?": "É isso mesmo que importa agora?",
    "You're {{mins}} minutes in. No judgment, just checking.": "Já são {{mins}} minutos. Sem julgamento, só checando.",
    "{{mins}} minutes gone. Still worth it?": "{{mins}} minutos se foram. Ainda vale a pena?",
    "That's {{mins}} minutes of your earned time. Your call.": "São {{mins}} minutos do seu tempo ganho. Você decide.",
    "{{mins}} minutes in. There's a task waiting if you'd rather.": "Já são {{mins}} minutos. Tem uma tarefa esperando, se preferir.",
    "Time's up": "Acabou o tempo",
    "You're out of earned time. Complete a task to unlock your apps.": "Seu tempo ganho acabou. Conclua uma tarefa para desbloquear seus apps.",
  ],
  "ru": [
    "Almost out of time": "Время почти вышло",
    "Your earned time is nearly gone. Wrap up, or complete a task to keep going.": "Заработанное время почти кончилось. Закругляйтесь или выполните задачу, чтобы продолжить.",
    "Is {{label}} really the move right now?": "Сейчас точно время для {{label}}?",
    "Is this really the move right now?": "Сейчас точно время для этого?",
    "You're {{mins}} minutes in. No judgment, just checking.": "Уже {{mins}} мин. Без осуждения, просто проверяем.",
    "{{mins}} minutes gone. Still worth it?": "Прошло {{mins}} мин. Оно того стоит?",
    "That's {{mins}} minutes of your earned time. Your call.": "Это {{mins}} мин вашего заработанного времени. Решать вам.",
    "{{mins}} minutes in. There's a task waiting if you'd rather.": "Уже {{mins}} мин. Если хотите, вас ждёт задача.",
    "Time's up": "Время вышло",
    "You're out of earned time. Complete a task to unlock your apps.": "Заработанное время закончилось. Выполните задачу, чтобы разблокировать приложения.",
  ],
  "id": [
    "Almost out of time": "Waktu hampir habis",
    "Your earned time is nearly gone. Wrap up, or complete a task to keep going.": "Waktu yang kamu dapat hampir habis. Selesaikan, atau kerjakan tugas untuk lanjut.",
    "Is {{label}} really the move right now?": "Apakah {{label}} benar-benar yang perlu sekarang?",
    "Is this really the move right now?": "Apakah ini benar-benar yang perlu sekarang?",
    "You're {{mins}} minutes in. No judgment, just checking.": "Sudah {{mins}} menit. Tanpa menghakimi, cuma mengecek.",
    "{{mins}} minutes gone. Still worth it?": "{{mins}} menit berlalu. Masih sepadan?",
    "That's {{mins}} minutes of your earned time. Your call.": "Itu {{mins}} menit dari waktu yang kamu dapat. Terserah kamu.",
    "{{mins}} minutes in. There's a task waiting if you'd rather.": "Sudah {{mins}} menit. Ada tugas yang menunggu kalau kamu mau.",
    "Time's up": "Waktu habis",
    "You're out of earned time. Complete a task to unlock your apps.": "Waktu yang kamu dapat sudah habis. Selesaikan tugas untuk membuka app-mu.",
  ],
  "de": [
    "Almost out of time": "Fast keine Zeit mehr",
    "Your earned time is nearly gone. Wrap up, or complete a task to keep going.": "Deine verdiente Zeit ist fast aufgebraucht. Komm zum Ende oder erledige eine Aufgabe, um weiterzumachen.",
    "Is {{label}} really the move right now?": "Ist {{label}} gerade wirklich dran?",
    "Is this really the move right now?": "Ist das gerade wirklich dran?",
    "You're {{mins}} minutes in. No judgment, just checking.": "Du bist seit {{mins}} Minuten dabei. Kein Urteil, nur ein Check.",
    "{{mins}} minutes gone. Still worth it?": "{{mins}} Minuten weg. Lohnt es sich noch?",
    "That's {{mins}} minutes of your earned time. Your call.": "Das sind {{mins}} Minuten deiner verdienten Zeit. Deine Entscheidung.",
    "{{mins}} minutes in. There's a task waiting if you'd rather.": "{{mins}} Minuten drin. Eine Aufgabe wartet, wenn dir das lieber ist.",
    "Time's up": "Zeit ist um",
    "You're out of earned time. Complete a task to unlock your apps.": "Deine verdiente Zeit ist aufgebraucht. Erledige eine Aufgabe, um deine Apps zu entsperren.",
  ],
  "ja": [
    "Almost out of time": "時間がもうすぐなくなります",
    "Your earned time is nearly gone. Wrap up, or complete a task to keep going.": "獲得した時間がもうすぐなくなります。切り上げるか、タスクを完了して続けましょう。",
    "Is {{label}} really the move right now?": "本当に今{{label}}を開く？",
    "Is this really the move right now?": "本当に今それをする？",
    "You're {{mins}} minutes in. No judgment, just checking.": "{{mins}}分経ちました。責めているわけではなく、確認です。",
    "{{mins}} minutes gone. Still worth it?": "{{mins}}分経過。まだ見る価値ある？",
    "That's {{mins}} minutes of your earned time. Your call.": "獲得した時間のうち{{mins}}分です。決めるのはあなた。",
    "{{mins}} minutes in. There's a task waiting if you'd rather.": "{{mins}}分経ちました。よければタスクが待っています。",
    "Time's up": "時間切れ",
    "You're out of earned time. Complete a task to unlock your apps.": "獲得した時間がなくなりました。タスクを完了してAppのロックを解除しましょう。",
  ],
  "tr": [
    "Almost out of time": "Süre neredeyse bitti",
    "Your earned time is nearly gone. Wrap up, or complete a task to keep going.": "Kazandığın süre neredeyse bitti. Toparla ya da devam etmek için bir görev tamamla.",
    "Is {{label}} really the move right now?": "Şu an gerçekten {{label}} mi?",
    "Is this really the move right now?": "Şu an gerçekten bunu mu yapmalısın?",
    "You're {{mins}} minutes in. No judgment, just checking.": "{{mins}} dakika oldu. Yargı yok, sadece soruyoruz.",
    "{{mins}} minutes gone. Still worth it?": "{{mins}} dakika geçti. Hâlâ değer mi?",
    "That's {{mins}} minutes of your earned time. Your call.": "Bu, kazandığın sürenin {{mins}} dakikası. Karar senin.",
    "{{mins}} minutes in. There's a task waiting if you'd rather.": "{{mins}} dakika oldu. İstersen bekleyen bir görev var.",
    "Time's up": "Süre doldu",
    "You're out of earned time. Complete a task to unlock your apps.": "Kazandığın süre bitti. Uygulamalarının kilidini açmak için bir görev tamamla.",
  ],
  "vi": [
    "Almost out of time": "Sắp hết giờ",
    "Your earned time is nearly gone. Wrap up, or complete a task to keep going.": "Thời gian đã kiếm sắp hết. Kết thúc đi, hoặc hoàn thành một việc để tiếp tục.",
    "Is {{label}} really the move right now?": "Bây giờ có thực sự nên mở {{label}}?",
    "Is this really the move right now?": "Bây giờ có thực sự nên làm việc này?",
    "You're {{mins}} minutes in. No judgment, just checking.": "Đã {{mins}} phút rồi. Không phán xét, chỉ hỏi thôi.",
    "{{mins}} minutes gone. Still worth it?": "Đã trôi qua {{mins}} phút. Vẫn đáng chứ?",
    "That's {{mins}} minutes of your earned time. Your call.": "Đó là {{mins}} phút trong thời gian bạn đã kiếm. Bạn quyết định.",
    "{{mins}} minutes in. There's a task waiting if you'd rather.": "Đã {{mins}} phút rồi. Có một việc đang đợi nếu bạn muốn.",
    "Time's up": "Hết giờ",
    "You're out of earned time. Complete a task to unlock your apps.": "Bạn đã hết thời gian đã kiếm. Hoàn thành một việc để mở khóa ứng dụng.",
  ],
  "ko": [
    "Almost out of time": "시간이 거의 없어요",
    "Your earned time is nearly gone. Wrap up, or complete a task to keep going.": "번 시간이 거의 다 떨어졌어요. 마무리하거나 할 일을 완료해 계속하세요.",
    "Is {{label}} really the move right now?": "지금 정말 {{label}}을(를) 할 때인가요?",
    "Is this really the move right now?": "지금 정말 이걸 할 때인가요?",
    "You're {{mins}} minutes in. No judgment, just checking.": "{{mins}}분째예요. 비난이 아니라 그냥 확인이에요.",
    "{{mins}} minutes gone. Still worth it?": "{{mins}}분이 지났어요. 아직 그럴 가치가 있나요?",
    "That's {{mins}} minutes of your earned time. Your call.": "번 시간 중 {{mins}}분이에요. 선택은 당신 몫이에요.",
    "{{mins}} minutes in. There's a task waiting if you'd rather.": "{{mins}}분째예요. 원하면 할 일이 기다리고 있어요.",
    "Time's up": "시간 종료",
    "You're out of earned time. Complete a task to unlock your apps.": "번 시간을 다 썼어요. 할 일을 완료해 앱 잠금을 푸세요.",
  ],
  "it": [
    "Almost out of time": "Quasi finito il tempo",
    "Your earned time is nearly gone. Wrap up, or complete a task to keep going.": "Il tempo guadagnato sta per finire. Chiudi, oppure completa un'attività per continuare.",
    "Is {{label}} really the move right now?": "{{label}} è davvero la scelta giusta adesso?",
    "Is this really the move right now?": "È davvero il momento giusto?",
    "You're {{mins}} minutes in. No judgment, just checking.": "Sei a {{mins}} minuti. Nessun giudizio, solo un controllo.",
    "{{mins}} minutes gone. Still worth it?": "{{mins}} minuti andati. Ne vale ancora la pena?",
    "That's {{mins}} minutes of your earned time. Your call.": "Sono {{mins}} minuti del tempo che hai guadagnato. Decidi tu.",
    "{{mins}} minutes in. There's a task waiting if you'd rather.": "Sei a {{mins}} minuti. C'è un'attività che ti aspetta, se preferisci.",
    "Time's up": "Tempo scaduto",
    "You're out of earned time. Complete a task to unlock your apps.": "Hai finito il tempo guadagnato. Completa un'attività per sbloccare le app.",
  ],
  "pl": [
    "Almost out of time": "Czas prawie się skończył",
    "Your earned time is nearly gone. Wrap up, or complete a task to keep going.": "Zdobyty czas prawie się skończył. Kończ albo wykonaj zadanie, aby kontynuować.",
    "Is {{label}} really the move right now?": "Czy teraz naprawdę czas na {{label}}?",
    "Is this really the move right now?": "Czy to naprawdę ten moment?",
    "You're {{mins}} minutes in. No judgment, just checking.": "Mija {{mins}} min. Bez oceniania, tylko pytamy.",
    "{{mins}} minutes gone. Still worth it?": "Minęło {{mins}} min. Wciąż warto?",
    "That's {{mins}} minutes of your earned time. Your call.": "To {{mins}} min twojego zdobytego czasu. Twoja decyzja.",
    "{{mins}} minutes in. There's a task waiting if you'd rather.": "Już {{mins}} min. Jeśli wolisz, czeka zadanie.",
    "Time's up": "Czas minął",
    "You're out of earned time. Complete a task to unlock your apps.": "Skończył się zdobyty czas. Ukończ zadanie, aby odblokować aplikacje.",
  ],
  "uk": [
    "Almost out of time": "Час майже скінчився",
    "Your earned time is nearly gone. Wrap up, or complete a task to keep going.": "Зароблений час майже скінчився. Закругляйтеся або виконайте завдання, щоб продовжити.",
    "Is {{label}} really the move right now?": "Зараз точно час для {{label}}?",
    "Is this really the move right now?": "Зараз точно час для цього?",
    "You're {{mins}} minutes in. No judgment, just checking.": "Уже {{mins}} хв. Без осуду, просто перевіряємо.",
    "{{mins}} minutes gone. Still worth it?": "Минуло {{mins}} хв. Воно того варте?",
    "That's {{mins}} minutes of your earned time. Your call.": "Це {{mins}} хв вашого заробленого часу. Вирішувати вам.",
    "{{mins}} minutes in. There's a task waiting if you'd rather.": "Уже {{mins}} хв. Якщо хочете, на вас чекає завдання.",
    "Time's up": "Час вийшов",
    "You're out of earned time. Complete a task to unlock your apps.": "Зароблений час закінчився. Виконайте завдання, щоб розблокувати застосунки.",
  ],
  "th": [
    "Almost out of time": "เวลาใกล้หมด",
    "Your earned time is nearly gone. Wrap up, or complete a task to keep going.": "เวลาที่หามาใกล้หมดแล้ว เก็บงาน หรือทำงานให้เสร็จเพื่อไปต่อ",
    "Is {{label}} really the move right now?": "ตอนนี้ควรเปิด {{label}} จริงๆ เหรอ?",
    "Is this really the move right now?": "ตอนนี้ควรทำสิ่งนี้จริงๆ เหรอ?",
    "You're {{mins}} minutes in. No judgment, just checking.": "ผ่านไป {{mins}} นาทีแล้ว ไม่ได้ตัดสิน แค่ถามดู",
    "{{mins}} minutes gone. Still worth it?": "ผ่านไป {{mins}} นาทีแล้ว ยังคุ้มไหม?",
    "That's {{mins}} minutes of your earned time. Your call.": "นั่นคือ {{mins}} นาทีจากเวลาที่คุณหามา แล้วแต่คุณ",
    "{{mins}} minutes in. There's a task waiting if you'd rather.": "{{mins}} นาทีแล้ว มีงานรออยู่ถ้าคุณต้องการ",
    "Time's up": "หมดเวลา",
    "You're out of earned time. Complete a task to unlock your apps.": "เวลาที่หามาหมดแล้ว ทำงานให้เสร็จเพื่อปลดล็อกแอป",
  ],
  "nl": [
    "Almost out of time": "Bijna geen tijd meer",
    "Your earned time is nearly gone. Wrap up, or complete a task to keep going.": "Je verdiende tijd is bijna op. Rond af, of voltooi een taak om door te gaan.",
    "Is {{label}} really the move right now?": "Is {{label}} nu echt wat je wilt doen?",
    "Is this really the move right now?": "Is dit nu echt wat je wilt doen?",
    "You're {{mins}} minutes in. No judgment, just checking.": "Je bent {{mins}} minuten bezig. Geen oordeel, gewoon even checken.",
    "{{mins}} minutes gone. Still worth it?": "{{mins}} minuten weg. Nog steeds de moeite waard?",
    "That's {{mins}} minutes of your earned time. Your call.": "Dat is {{mins}} minuten van je verdiende tijd. Jouw keuze.",
    "{{mins}} minutes in. There's a task waiting if you'd rather.": "Al {{mins}} minuten. Er wacht een taak als je wilt.",
    "Time's up": "Tijd is op",
    "You're out of earned time. Complete a task to unlock your apps.": "Je verdiende tijd is op. Voltooi een taak om je apps te ontgrendelen.",
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
