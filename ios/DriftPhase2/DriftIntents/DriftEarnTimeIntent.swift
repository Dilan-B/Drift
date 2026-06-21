import AppIntents
import Foundation
import HealthKit

@available(iOS 16.0, *)
struct DriftEarnFromStepsIntent: AppIntent {
  static var title: LocalizedStringResource = "Earn Drift Time From Steps"
  static var description = IntentDescription("Checks today's step count and records pending earned time in the Drift App Group.")

  @Parameter(title: "Step Goal", default: 5000)
  var stepGoal: Int

  @Parameter(title: "Minutes To Earn", default: 10)
  var minutesToEarn: Int

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let store = HKHealthStore()
    guard HKHealthStore.isHealthDataAvailable() else {
      return .result(dialog: "Health data is not available on this device.")
    }

    let stepType = HKQuantityType.quantityType(forIdentifier: .stepCount)!
    try await store.requestAuthorization(toShare: [], read: [stepType])
    let steps = try await todaySteps(store: store, stepType: stepType)

    guard steps >= Double(max(1, stepGoal)) else {
      return .result(dialog: "You have \(Int(steps)) steps today. Reach \(stepGoal) to earn Drift time.")
    }

    let earnedSeconds = max(1, minutesToEarn) * 60
    let defaults = DriftShared.defaults
    defaults?.set(earnedSeconds, forKey: DriftShared.healthEarnPendingSecondsKey)
    defaults?.set(Date().timeIntervalSince1970, forKey: DriftShared.healthEarnUpdatedAtKey)

    return .result(dialog: "Nice. \(minutesToEarn) minutes are ready to claim in Drift.")
  }

  private func todaySteps(store: HKHealthStore, stepType: HKQuantityType) async throws -> Double {
    let calendar = Calendar.current
    let start = calendar.startOfDay(for: Date())
    let predicate = HKQuery.predicateForSamples(withStart: start, end: Date())

    return try await withCheckedThrowingContinuation { continuation in
      let query = HKStatisticsQuery(
        quantityType: stepType,
        quantitySamplePredicate: predicate,
        options: .cumulativeSum
      ) { _, stats, error in
        if let error {
          continuation.resume(throwing: error)
          return
        }
        let count = stats?.sumQuantity()?.doubleValue(for: .count()) ?? 0
        continuation.resume(returning: count)
      }
      store.execute(query)
    }
  }
}
