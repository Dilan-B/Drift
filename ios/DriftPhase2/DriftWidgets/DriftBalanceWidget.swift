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

struct DriftBalanceWidgetView: View {
  let entry: DriftBalanceEntry

  var body: some View {
    ZStack {
      ContainerRelativeShape()
        .fill(Color(red: 0.95, green: 0.96, blue: 0.91))

      VStack(alignment: .leading, spacing: 8) {
        Text("DRIFT")
          .font(.caption2.weight(.bold))
          .foregroundStyle(.secondary)

        Spacer(minLength: 0)

        Text(DriftShared.format(seconds: entry.balanceSeconds))
          .font(.system(size: 34, weight: .heavy, design: .rounded))
          .foregroundStyle(Color(red: 0.19, green: 0.42, blue: 0.28))
          .minimumScaleFactor(0.7)

        Text(entry.balanceSeconds > 0 ? "earned time" : "earn to unlock")
          .font(.caption.weight(.semibold))
          .foregroundStyle(.secondary)
      }
      .padding(16)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
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
