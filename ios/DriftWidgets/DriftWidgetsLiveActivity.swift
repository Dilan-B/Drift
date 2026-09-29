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
          Text(context.attributes.heading ?? "Drift In")
            .font(.caption.weight(.bold))
        }
        DynamicIslandExpandedRegion(.trailing) {
          LiveCountdown(state: context.state)
            .font(.caption.monospacedDigit())
            .frame(maxWidth: 64, alignment: .trailing)
        }
        DynamicIslandExpandedRegion(.bottom) {
          LiveProgress(context: context)
            .tint(Color(red: 0.184, green: 0.671, blue: 0.447))
        }
      } compactLeading: {
        Image(systemName: symbol(context))
          .font(.caption)
          .foregroundStyle(Color(red: 0.184, green: 0.671, blue: 0.447))
      } compactTrailing: {
        LiveCountdown(state: context.state)
          .font(.caption2.monospacedDigit())
          .frame(maxWidth: 44)
      } minimal: {
        Image(systemName: symbol(context))
          .font(.caption2)
          .foregroundStyle(Color(red: 0.184, green: 0.671, blue: 0.447))
      }
    }
  }

  private func symbol(_ context: ActivityViewContext<DriftInActivityAttributes>) -> String {
    context.attributes.heading == "Lockbox" ? "lock.fill" : "leaf.fill"
  }
}

/// Counts down on its own when the state carries an end date, so the lock
/// screen stays correct while Drift is suspended — the whole point of letting
/// the screen turn off during a session. Falls back to the last pushed value.
@available(iOS 16.1, *)
struct LiveCountdown: View {
  let state: DriftInActivityAttributes.ContentState
  var body: some View {
    if let end = state.endsAt, !state.isComplete, end > Date() {
      Text(timerInterval: Date()...end, countsDown: true)
        .multilineTextAlignment(.trailing)
    } else {
      Text(DriftShared.format(seconds: state.remainingSeconds))
    }
  }
}

@available(iOS 16.1, *)
struct LiveProgress: View {
  let context: ActivityViewContext<DriftInActivityAttributes>
  var body: some View {
    let total = TimeInterval(max(1, context.attributes.totalSeconds))
    if let end = context.state.endsAt, !context.state.isComplete, end > Date() {
      ProgressView(timerInterval: end.addingTimeInterval(-total)...end, countsDown: false) {
        EmptyView()
      } currentValueLabel: {
        EmptyView()
      }
    } else {
      let elapsed = max(0, context.attributes.totalSeconds - context.state.remainingSeconds)
      ProgressView(value: min(1, Double(elapsed) / total))
    }
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
        Text(context.attributes.heading ?? "Drift In")
          .font(.headline.weight(.bold))
          .foregroundStyle(inkDeep)
        Spacer()
        LiveCountdown(state: context.state)
          .font(.headline.monospacedDigit())
          .foregroundStyle(earnGreen)
      }

      Text(context.attributes.taskTitle)
        .font(.subheadline)
        .lineLimit(1)
        .foregroundStyle(inkMid)

      LiveProgress(context: context)
        .tint(earnTerra)
    }
    .padding()
    .activityBackgroundTint(paperWarm)
    .activitySystemActionForegroundColor(inkDeep)
  }
}
