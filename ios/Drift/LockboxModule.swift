//
// LockboxModule.swift
// Drift — live "is the phone still in the box" detection.
//
// WHY THIS IS NOT SleepGuardModule
// SleepGuard asks CMMotionActivityManager what the phone DID, hours later. That
// is the right tool for a night: it costs nothing, survives a force-quit, and
// cannot be defeated by iOS suspending us.
//
// Lockbox needs the opposite. The countdown has to appear the instant the phone
// is lifted, which means streaming CMDeviceMotion in real time while Drift is
// on screen. That only works in the foreground — iOS freezes the app once the
// screen locks, and neither of Drift's background modes (fetch, processing)
// permits continuous accelerometer updates. For the screen-off stretch, see
// startRecording / checkRecorded at the bottom: CMSensorRecorder logs the
// accelerometer while Drift is suspended and the log is judged afterwards.
//
// THRESHOLDING HAPPENS HERE, NOT IN JS
// Bridging 20 samples a second into JavaScript to compare a float against a
// constant would burn battery for nothing. This class only emits the two
// transitions that matter — settled and disturbed — so a still phone sends no
// traffic at all.
//
import Foundation
import React
import CoreMotion

@objc(LockboxModule)
class LockboxModule: RCTEventEmitter {

  private let motion = CMMotionManager()
  private let queue = OperationQueue()

  /// Gravity-free acceleration, in G, above which a sample counts as movement.
  /// A phone resting on a table reads ~0.01–0.02 G of sensor noise; lifting one
  /// is comfortably past 0.1 G. 0.08 sits above the noise floor without needing
  /// a deliberate shove to trip.
  private var threshold: Double = 0.08

  /// Consecutive samples required to change state. Asymmetric on purpose: react
  /// fast to movement (a lift should be caught immediately) and slowly to
  /// stillness, so a phone caught mid-air between two jostles is not reported as
  /// settled. At 20 Hz these are 0.15s and 1s.
  private let disturbSamples = 3
  private let settleSamples  = 20

  /// |gravity.z| above which the phone is lying FLAT on a surface. The device
  /// z-axis points out of the screen, so gravity reads about -1 screen-up and
  /// about +1 screen-down; either way the magnitude is near 1, while a phone
  /// held or pocketed is not. 0.8 allows for a box floor that isn't level.
  ///
  /// Flat rather than face-down specifically: the phone goes in screen UP so
  /// the countdown is readable, which is the whole reason the screen is kept
  /// awake. Orientation is here to tell "lying on something" from "in a hand",
  /// not to insist on a posture.
  private let flatThreshold: Double = 0.8

  private var disturbStreak = 0
  private var settleStreak  = 0
  private var isDisturbed   = false
  private var isFlat        = false
  private var isFaceUp      = false
  private var monitoring    = false
  private var hasListeners  = false

  override static func requiresMainQueueSetup() -> Bool { return true }

  override func supportedEvents() -> [String]! { return ["LockboxState"] }

  override func startObserving() { hasListeners = true }
  override func stopObserving()  { hasListeners = false }

  // ── Capability ──────────────────────────────────────────────
  @objc(isAvailable:rejecter:)
  func isAvailable(_ resolve: RCTPromiseResolveBlock,
                   rejecter reject: RCTPromiseRejectBlock) {
    resolve(motion.isDeviceMotionAvailable)
  }

  // ── Monitoring ──────────────────────────────────────────────
  /// Begin streaming. `sensitivity` scales the threshold: 1.0 is the default,
  /// lower is fussier. Resolves once updates are actually running so the JS side
  /// can trust that a settled phone means a settled phone.
  @objc(startMonitoring:resolver:rejecter:)
  func startMonitoring(_ sensitivity: NSNumber,
                       resolver resolve: @escaping RCTPromiseResolveBlock,
                       rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard motion.isDeviceMotionAvailable else {
      reject("motion_unavailable", "This device has no motion sensors.", nil)
      return
    }
    if monitoring {
      resolve(["monitoring": true, "alreadyRunning": true])
      return
    }

    let scale = max(0.2, min(3.0, sensitivity.doubleValue))
    threshold = 0.08 * scale

    disturbStreak = 0
    settleStreak  = 0
    isFlat = false
    isFaceUp = false
    // Assume the phone is NOT yet settled. The first second of stillness has to
    // be earned, so "in the box" is something the sensors confirmed rather than
    // something we assumed because the user tapped a button.
    isDisturbed = true

    queue.name = "com.drift.lockbox.motion"
    queue.maxConcurrentOperationCount = 1
    motion.deviceMotionUpdateInterval = 1.0 / 20.0

    motion.startDeviceMotionUpdates(to: queue) { [weak self] data, error in
      guard let self = self, let data = data, error == nil else { return }
      self.handle(sample: data)
    }

    monitoring = true
    NSLog("[Drift.Lockbox] monitoring started, threshold=%.3fG", threshold)
    resolve(["monitoring": true, "threshold": threshold])
  }

  @objc(stopMonitoring:rejecter:)
  func stopMonitoring(_ resolve: RCTPromiseResolveBlock,
                      rejecter reject: RCTPromiseRejectBlock) {
    if monitoring {
      motion.stopDeviceMotionUpdates()
      monitoring = false
      NSLog("[Drift.Lockbox] monitoring stopped")
    }
    disturbStreak = 0
    settleStreak = 0
    resolve(["monitoring": false])
  }

  /// Current reading without subscribing — used to render a live "hold still"
  /// meter during placement.
  /// Everything the waiting screen needs to show the user WHY it is or isn't
  /// starting. Debounced state (`settled`, `flat`) comes from the streak
  /// logic; the raw numbers are there so a failure is diagnosable instead of
  /// just "it didn't work".
  @objc(currentMagnitude:rejecter:)
  func currentMagnitude(_ resolve: RCTPromiseResolveBlock,
                        rejecter reject: RCTPromiseRejectBlock) {
    guard let d = motion.deviceMotion else {
      resolve([
        "magnitude": NSNull(), "gravityZ": NSNull(),
        "flat": false, "faceUp": false, "settled": false,
        "monitoring": monitoring, "threshold": threshold,
      ])
      return
    }
    resolve([
      "magnitude": magnitude(of: d.userAcceleration),
      "gravityZ": d.gravity.z,
      "flat": isFlat,
      "faceUp": isFaceUp,
      "settled": !isDisturbed,
      "monitoring": monitoring,
      "threshold": threshold,
    ])
  }

  // ── Sample handling ─────────────────────────────────────────
  private func magnitude(of a: CMAcceleration) -> Double {
    return (a.x * a.x + a.y * a.y + a.z * a.z).squareRoot()
  }

  private func handle(sample: CMDeviceMotion) {
    let mag = magnitude(of: sample.userAcceleration)

    // Orientation is what tells us the phone is IN the box rather than merely
    // sitting still next to it — a phone face up on the desk is also perfectly
    // still. Emitted on transition so JS can start a session without the user
    // having to confirm what the sensors already know.
    let flatNow = abs(sample.gravity.z) > flatThreshold
    let faceUpNow = sample.gravity.z < -flatThreshold
    if flatNow != isFlat || faceUpNow != isFaceUp {
      isFlat = flatNow
      isFaceUp = faceUpNow
      emit(state: isDisturbed ? "disturbed" : "settled", magnitude: mag)
    }

    if mag > threshold {
      disturbStreak += 1
      settleStreak = 0
      if !isDisturbed && disturbStreak >= disturbSamples {
        isDisturbed = true
        emit(state: "disturbed", magnitude: mag)
      }
    } else {
      settleStreak += 1
      disturbStreak = 0
      if isDisturbed && settleStreak >= settleSamples {
        isDisturbed = false
        emit(state: "settled", magnitude: mag)
      }
    }
  }

  private func emit(state: String, magnitude: Double) {
    guard hasListeners else { return }
    let flat = isFlat, faceUp = isFaceUp
    // The bridge is not thread-safe from an arbitrary OperationQueue.
    DispatchQueue.main.async {
      self.sendEvent(withName: "LockboxState", body: [
        "state": state,
        "magnitude": magnitude,
        "flat": flat,
        "faceUp": faceUp,
        "at": Date().timeIntervalSince1970 * 1000,
      ])
    }
  }

  // ── Screen-off enforcement ──────────────────────────────────
  // The live stream above stops the moment iOS suspends Drift, which it does as
  // soon as the screen locks. CMSensorRecorder keeps logging the accelerometer
  // on the motion coprocessor regardless — no app running, no battery cost to
  // speak of — and lets us read that log back afterwards. That is what lets the
  // phone lock during a session: whatever happened while it was dark is judged
  // from the recording the next time Drift runs.
  //
  // The recording lags real time by up to a few minutes, so a check may come
  // back covering less than was asked for. `checkedUntil` says how far it got;
  // the caller re-checks the remainder later rather than assuming it was fine.
  private let recorder = CMSensorRecorder()

  @objc(startRecording:resolver:rejecter:)
  func startRecording(_ seconds: NSNumber,
                      resolver resolve: @escaping RCTPromiseResolveBlock,
                      rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard CMSensorRecorder.isAccelerometerRecordingAvailable() else {
      resolve(["recording": false, "reason": "unavailable"])
      return
    }
    let status = CMSensorRecorder.authorizationStatus()
    if status == .denied || status == .restricted {
      resolve(["recording": false, "reason": "denied"])
      return
    }
    // Capped by iOS at 12 hours; a session is at most 5.
    let dur = min(12 * 3600, max(60, seconds.doubleValue))
    DispatchQueue.global(qos: .utility).async {
      self.recorder.recordAccelerometer(forDuration: dur)
      resolve(["recording": true])
    }
  }

  /// Scan the recorded accelerometer between two instants (ms since epoch) for
  /// a stretch where the phone was out of the box — moving, or not lying flat —
  /// for longer than `grace` seconds. Mirrors the live thresholds above, applied
  /// to raw acceleration (gravity included), so "still" means |a| ≈ 1 G.
  @objc(checkRecorded:to:grace:resolver:rejecter:)
  func checkRecorded(_ fromMs: NSNumber, to toMs: NSNumber, grace: NSNumber,
                     resolver resolve: @escaping RCTPromiseResolveBlock,
                     rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard CMSensorRecorder.isAccelerometerRecordingAvailable(),
          CMSensorRecorder.authorizationStatus() == .authorized else {
      resolve(["available": false])
      return
    }
    let from = Date(timeIntervalSince1970: fromMs.doubleValue / 1000)
    let to = Date(timeIntervalSince1970: toMs.doubleValue / 1000)
    guard to > from else {
      resolve(["available": true, "checkedUntil": toMs, "breachAt": NSNull(), "samples": 0])
      return
    }
    let graceS = max(1, grace.doubleValue)
    let moveThreshold = threshold
    let flatThreshold = self.flatThreshold

    DispatchQueue.global(qos: .userInitiated).async {
      var samples = 0
      var lastAt: Date? = nil
      var outSince: Date? = nil     // start of the current out-of-box stretch
      var calmSince: Date? = nil    // start of the current calm run inside it
      var breachAt: Date? = nil

      if let list = self.recorder.accelerometerData(from: from, to: to) {
        for case let d as CMRecordedAccelerometerData in list {
          samples += 1
          let t = d.startDate
          lastAt = t
          let a = d.acceleration
          let mag = (a.x * a.x + a.y * a.y + a.z * a.z).squareRoot()
          let moving = abs(mag - 1.0) > moveThreshold
          let flat = abs(a.z) > flatThreshold
          let disturbed = moving || !flat

          if disturbed {
            if outSince == nil { outSince = t }
            calmSince = nil
          } else if let o = outSince {
            if calmSince == nil { calmSince = t }
            // A full second of calm, flat samples ends the stretch.
            if t.timeIntervalSince(calmSince!) >= 1.0 {
              if calmSince!.timeIntervalSince(o) > graceS { breachAt = o.addingTimeInterval(graceS); break }
              outSince = nil
              calmSince = nil
            }
          }
          if let o = outSince, calmSince == nil, t.timeIntervalSince(o) > graceS {
            breachAt = o.addingTimeInterval(graceS)
            break
          }
        }
      }

      resolve([
        "available": true,
        "samples": samples,
        "checkedUntil": lastAt.map { $0.timeIntervalSince1970 * 1000 as Any } ?? NSNull(),
        "breachAt": breachAt.map { $0.timeIntervalSince1970 * 1000 as Any } ?? NSNull(),
      ])
    }
  }

  override func invalidate() {
    if monitoring { motion.stopDeviceMotionUpdates() }
    monitoring = false
    super.invalidate()
  }
}

// CMSensorDataList is NSFastEnumeration-only; this lets it drive a for-in loop.
extension CMSensorDataList: @retroactive Sequence {
  public func makeIterator() -> NSFastEnumerationIterator {
    return NSFastEnumerationIterator(self)
  }
}
