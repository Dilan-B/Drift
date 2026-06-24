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
    .configurationDisplayName("Drift Balance")
    .description("See your earned screen-time balance at a glance.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
