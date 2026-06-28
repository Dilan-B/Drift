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
            .tint(Color(red: 0.184, green: 0.671, blue: 0.447))
        }
      } compactLeading: {
        Image(systemName: "leaf.fill")
          .font(.caption)
          .foregroundStyle(Color(red: 0.184, green: 0.671, blue: 0.447))
      } compactTrailing: {
        Text(shortTime(context.state.remainingSeconds))
          .font(.caption2.monospacedDigit())
      } minimal: {
        Image(systemName: "leaf.fill")
          .font(.caption2)
          .foregroundStyle(Color(red: 0.184, green: 0.671, blue: 0.447))
      }
    }
  }

  private func progress(_ context: ActivityViewContext<DriftInActivityAttributes>) -> Double {
    guard context.attributes.totalSeconds > 0 else { return 0 }
    let elapsed = max(0, context.attributes.totalSeconds - context.state.remainingSeconds)
    return min(1, Double(elapsed) / Double(context.attributes.totalSeconds))
  }

  private func shortTime(_ seconds: Int) -> String {
    let safe = max(0, seconds)
    let m = safe / 60
    let s = safe % 60
    return "\(m):\(String(format: "%02d", s))"
  }
}

@available(iOS 16.1, *)
struct DriftInLockScreenView: View {
  let context: ActivityViewContext<DriftInActivityAttributes>

  private let paperWarm = Color(red: 0.957, green: 0.976, blue: 0.965)
  private let inkDeep   = Color(red: 0.102, green: 0.169, blue: 0.122)
  private let inkMid    = Color(red: 0.420, green: 0.541, blue: 0.471)
  private let earnTerra = Color(red: 0.184, green: 0.671, blue: 0.447)
  private let earnGreen = Color(red: 0.102, green: 0.502, blue: 0.314)

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Text("Drift In")
          .font(.headline.weight(.bold))
          .foregroundStyle(inkDeep)
        Spacer()
        Text(DriftShared.format(seconds: context.state.remainingSeconds))
          .font(.headline.monospacedDigit())
          .foregroundStyle(earnGreen)
      }

      Text(context.attributes.taskTitle)
        .font(.subheadline)
        .lineLimit(1)
        .foregroundStyle(inkMid)

      ProgressView(value: progress)
        .tint(earnTerra)
    }
    .padding()
    .activityBackgroundTint(paperWarm)
    .activitySystemActionForegroundColor(inkDeep)
  }

  private var progress: Double {
    guard context.attributes.totalSeconds > 0 else { return 0 }
    let elapsed = max(0, context.attributes.totalSeconds - context.state.remainingSeconds)
    return min(1, Double(elapsed) / Double(context.attributes.totalSeconds))
  }
}
