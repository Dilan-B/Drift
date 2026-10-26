import WidgetKit
import SwiftUI

struct DriftBalanceEntry: TimelineEntry {
  let date: Date
  let balanceSeconds: Int
  let updatedAt: Date
}

struct DriftBalanceProvider: TimelineProvider {
  func placeholder(in context: Context) -> DriftBalanceEntry {
    DriftBalanceEntry(date: Date(), balanceSeconds: 25 * 60, updatedAt: Date())
  }

  func getSnapshot(in context: Context, completion: @escaping (DriftBalanceEntry) -> Void) {
    completion(currentEntry())
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<DriftBalanceEntry>) -> Void) {
    let entry = currentEntry()
    completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(15 * 60))))
  }

  private func currentEntry() -> DriftBalanceEntry {
    DriftBalanceEntry(
      date: Date(),
      balanceSeconds: DriftShared.balanceSeconds(),
      updatedAt: DriftShared.updatedAt()
    )
  }
}

private let paperWarm = Color(red: 0.957, green: 0.976, blue: 0.965)   // #F4F9F6
private let inkVoid   = Color(red: 0.043, green: 0.102, blue: 0.067)   // #0B1A11
private let inkDeep   = Color(red: 0.102, green: 0.169, blue: 0.122)   // #1A2B1F
private let inkMid    = Color(red: 0.420, green: 0.541, blue: 0.471)   // #6B8A78
private let earnTerra = Color(red: 0.184, green: 0.671, blue: 0.447)   // #2FAB72
private let earnGreen = Color(red: 0.102, green: 0.502, blue: 0.314)   // #1A8050

struct DriftBalanceWidgetView: View {
  let entry: DriftBalanceEntry

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("DRIFT")
        .font(.caption2.weight(.bold))
        .foregroundStyle(inkMid)

      Spacer(minLength: 0)

      Text(DriftShared.format(seconds: entry.balanceSeconds))
        .font(.system(size: 34, weight: .heavy, design: .rounded))
        .foregroundStyle(earnGreen)
        .minimumScaleFactor(0.7)

      Text(entry.balanceSeconds > 0 ? "earned time" : "earn to unlock")
        .font(.caption.weight(.semibold))
        .foregroundStyle(inkMid)
    }
    .padding(16)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .if_available_containerBackground(paperWarm)
  }
}

extension View {
  @ViewBuilder
  func if_available_containerBackground(_ color: Color) -> some View {
    if #available(iOSApplicationExtension 17.0, *) {
      self.containerBackground(color, for: .widget)
    } else {
      self.background(color)
    }
  }
}

struct DriftBalanceWidget: Widget {
  let kind = "DriftBalanceWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: DriftBalanceProvider()) { entry in
      DriftBalanceWidgetView(entry: entry)
    }
    .configurationDisplayName(driftL("Drift Balance"))
    .description(driftL("See your earned screen-time balance at a glance."))
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

// BEGIN GENERATED L10N (tools/i18n/build.js) — do not edit by hand
// Extensions can't see the app's JS catalogs, so each carries its own table.
// Language: what the app last wrote to the App Group (ScreenTimeModule
// .setLanguage), else the device's preferred language, else English.
fileprivate let DRIFT_L10N: [String: [String: String]] = [
  "zh-Hans": [
    "Drift Balance": "Drift 余额",
    "See your earned screen-time balance at a glance.": "一眼看到已赚取的屏幕时间余额。",
  ],
  "zh-Hant": [
    "Drift Balance": "Drift 餘額",
    "See your earned screen-time balance at a glance.": "一眼看到已賺取的螢幕使用時間餘額。",
  ],
  "hi": [
    "Drift Balance": "Drift बैलेंस",
    "See your earned screen-time balance at a glance.": "अपना कमाया स्क्रीन टाइम बैलेंस एक नज़र में देखें।",
  ],
  "es": [
    "Drift Balance": "Saldo de Drift",
    "See your earned screen-time balance at a glance.": "Consulta tu saldo de tiempo de pantalla ganado de un vistazo.",
  ],
  "fr": [
    "Drift Balance": "Solde Drift",
    "See your earned screen-time balance at a glance.": "Voyez votre solde de temps d’écran gagné en un coup d’œil.",
  ],
  "ar": [
    "Drift Balance": "رصيد Drift",
    "See your earned screen-time balance at a glance.": "اطّلع على رصيد وقت الشاشة المكتسب بنظرة.",
  ],
  "pt": [
    "Drift Balance": "Saldo do Drift",
    "See your earned screen-time balance at a glance.": "Veja seu saldo de tempo de tela ganho num relance.",
  ],
  "ru": [
    "Drift Balance": "Баланс Drift",
    "See your earned screen-time balance at a glance.": "Заработанное экранное время — с одного взгляда.",
  ],
  "id": [
    "Drift Balance": "Saldo Drift",
    "See your earned screen-time balance at a glance.": "Lihat saldo waktu layar yang kamu dapat dalam sekejap.",
  ],
  "de": [
    "Drift Balance": "Drift-Guthaben",
    "See your earned screen-time balance at a glance.": "Dein verdientes Bildschirmzeit-Guthaben auf einen Blick.",
  ],
  "ja": [
    "Drift Balance": "Driftの残高",
    "See your earned screen-time balance at a glance.": "獲得したスクリーンタイムの残高がひと目でわかります。",
  ],
  "tr": [
    "Drift Balance": "Drift Bakiyesi",
    "See your earned screen-time balance at a glance.": "Kazandığın ekran süresi bakiyesini bir bakışta gör.",
  ],
  "vi": [
    "Drift Balance": "Số dư Drift",
    "See your earned screen-time balance at a glance.": "Xem nhanh số dư thời gian màn hình đã kiếm.",
  ],
  "ko": [
    "Drift Balance": "Drift 잔액",
    "See your earned screen-time balance at a glance.": "번 스크린 타임 잔액을 한눈에 보세요.",
  ],
  "it": [
    "Drift Balance": "Saldo Drift",
    "See your earned screen-time balance at a glance.": "Il tuo saldo di tempo di utilizzo guadagnato a colpo d'occhio.",
  ],
  "pl": [
    "Drift Balance": "Saldo Drift",
    "See your earned screen-time balance at a glance.": "Zobacz saldo zdobytego czasu przed ekranem jednym spojrzeniem.",
  ],
  "uk": [
    "Drift Balance": "Баланс Drift",
    "See your earned screen-time balance at a glance.": "Зароблений екранний час — з одного погляду.",
  ],
  "th": [
    "Drift Balance": "ยอด Drift",
    "See your earned screen-time balance at a glance.": "ดูยอดเวลาหน้าจอที่หามาได้ในแวบเดียว",
  ],
  "nl": [
    "Drift Balance": "Drift-saldo",
    "See your earned screen-time balance at a glance.": "Zie je verdiende schermtijdsaldo in één oogopslag.",
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
