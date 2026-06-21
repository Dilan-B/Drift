import ActivityKit
import WidgetKit
import SwiftUI

@available(iOS 16.1, *)
struct DriftInLiveActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: DriftInActivityAttributes.self) { context in
      DriftInLockScreenView(context: context)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Text("Drift In")
            .font(.caption.weight(.bold))
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(DriftShared.format(seconds: context.state.remainingSeconds))
            .font(.caption.monospacedDigit())
        }
        DynamicIslandExpandedRegion(.bottom) {
          ProgressView(value: progress(context))
            .tint(Color(red: 0.25, green: 0.68, blue: 0.45))
        }
      } compactLeading: {
        Text("D")
          .font(.caption.weight(.heavy))
      } compactTrailing: {
        Text(shortTime(context.state.remainingSeconds))
          .font(.caption2.monospacedDigit())
      } minimal: {
        Text("D")
          .font(.caption2.weight(.heavy))
      }
    }
  }

  private func progress(_ context: ActivityViewContext<DriftInActivityAttributes>) -> Double {
    guard context.attributes.totalSeconds > 0 else { return 0 }
    let elapsed = max(0, context.attributes.totalSeconds - context.state.remainingSeconds)
    return min(1, Double(elapsed) / Double(context.attributes.totalSeconds))
  }

  private func shortTime(_ seconds: Int) -> String {
    "\(max(0, seconds) / 60)m"
  }
}

@available(iOS 16.1, *)
struct DriftInLockScreenView: View {
  let context: ActivityViewContext<DriftInActivityAttributes>

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Text("Drift In")
          .font(.headline.weight(.bold))
        Spacer()
        Text(DriftShared.format(seconds: context.state.remainingSeconds))
          .font(.headline.monospacedDigit())
      }

      Text(context.attributes.taskTitle)
        .font(.subheadline)
        .lineLimit(1)
        .foregroundStyle(.secondary)

      ProgressView(value: progress)
        .tint(Color(red: 0.25, green: 0.68, blue: 0.45))
    }
    .padding()
    .activityBackgroundTint(Color(red: 0.95, green: 0.96, blue: 0.91))
    .activitySystemActionForegroundColor(Color(red: 0.15, green: 0.34, blue: 0.22))
  }

  private var progress: Double {
    guard context.attributes.totalSeconds > 0 else { return 0 }
    let elapsed = max(0, context.attributes.totalSeconds - context.state.remainingSeconds)
    return min(1, Double(elapsed) / Double(context.attributes.totalSeconds))
  }
}
