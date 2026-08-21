//
// SleepGuardModule.swift
// Drift — "phone in another room" overnight guard.
//
// Two capabilities, exposed to JS:
//
//   scanTag()                  -> { id: String }   (Core NFC, foreground only)
//   motionAuthStatus()         -> String
//   requestMotionAuth()        -> String
//   checkStillness(from,to)    -> { moved, stationaryRatio, firstMovementAt, ... }
//
// WHY IT IS SHAPED THIS WAY — read before "improving" it:
//
// Core NFC cannot poll. There is no API to have iOS watch a tag; every read is
// a physical tap with the app in the foreground. So NFC can only ever prove
// "the phone was at this tag at this instant". It is the ARMING step, and it
// can never be the overnight check.
//
// The overnight check is CMMotionActivityManager instead. iOS records motion
// activity continuously on the motion coprocessor whether or not Drift is
// running, so we query the recorded timeline AFTER the fact. This is strictly
// better than trying to stay alive all night polling the accelerometer: it
// costs no battery, survives the app being force-quit, and cannot be defeated
// by iOS suspending us. The device cannot be carried to another room without
// generating a walking segment.
//
import Foundation
import React
import CoreMotion

#if canImport(CoreNFC)
import CoreNFC
#endif

@objc(SleepGuardModule)
class SleepGuardModule: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool { return true }

  private let activityManager = CMMotionActivityManager()

  // Core NFC hands the session a delegate and then releases nothing itself —
  // we must hold both the session and the pending promise, or the session is
  // deallocated mid-scan and the user sees the sheet vanish.
  #if canImport(CoreNFC)
  private var tagSession: Any?
  #endif
  private var scanResolve: RCTPromiseResolveBlock?
  private var scanReject: RCTPromiseRejectBlock?

  // ── NFC ─────────────────────────────────────────────────────
  @objc(isNfcAvailable:rejecter:)
  func isNfcAvailable(_ resolve: RCTPromiseResolveBlock,
                      rejecter reject: RCTPromiseRejectBlock) {
    #if canImport(CoreNFC)
    if #available(iOS 13.0, *) {
      resolve(NFCTagReaderSession.readingAvailable)
      return
    }
    #endif
    resolve(false)
  }

  /// Presents the system NFC sheet and resolves with the tag's hardware UID.
  ///
  /// We read the UID rather than an NDEF payload deliberately: it needs no
  /// writing, works with a blank tag straight out of the pack, and cannot be
  /// changed by the user with a phone. (UID-cloneable tags exist, but this is
  /// a self-imposed accountability feature, not an access-control system.)
  @objc(scanTag:rejecter:)
  func scanTag(_ resolve: @escaping RCTPromiseResolveBlock,
               rejecter reject: @escaping RCTPromiseRejectBlock) {
    #if canImport(CoreNFC)
    if #available(iOS 13.0, *) {
      guard NFCTagReaderSession.readingAvailable else {
        reject("nfc_unavailable", "This device can't read NFC tags.", nil)
        return
      }
      // Only one scan at a time. A second call while a sheet is open would
      // orphan the first promise.
      if scanResolve != nil {
        reject("scan_in_progress", "A tag scan is already running.", nil)
        return
      }
      scanResolve = resolve
      scanReject = reject
      DispatchQueue.main.async {
        let session = NFCTagReaderSession(pollingOption: [.iso14443], delegate: self, queue: nil)
        session?.alertMessage = "Hold your phone near the Drift tag."
        self.tagSession = session
        session?.begin()
      }
      return
    }
    #endif
    reject("nfc_unavailable", "NFC requires iOS 13 or later.", nil)
  }

  private func finishScan(id: String?, errorCode: String?, errorMessage: String?) {
    let res = scanResolve, rej = scanReject
    scanResolve = nil
    scanReject = nil
    #if canImport(CoreNFC)
    tagSession = nil
    #endif
    if let id = id {
      res?(["id": id])
    } else {
      rej?(errorCode ?? "nfc_error", errorMessage ?? "Tag scan failed.", nil)
    }
  }

  // ── Motion ──────────────────────────────────────────────────
  @objc(motionAuthStatus:rejecter:)
  func motionAuthStatus(_ resolve: RCTPromiseResolveBlock,
                        rejecter reject: RCTPromiseRejectBlock) {
    guard CMMotionActivityManager.isActivityAvailable() else {
      resolve("unavailable")
      return
    }
    switch CMMotionActivityManager.authorizationStatus() {
    case .authorized:    resolve("authorized")
    case .denied:        resolve("denied")
    case .restricted:    resolve("restricted")
    case .notDetermined: resolve("notDetermined")
    @unknown default:    resolve("unknown")
    }
  }

  /// There is no explicit "request motion permission" API — the prompt appears
  /// on first query. So we run a trivial 1-second historical query purely to
  /// trigger it, then report the resulting status.
  @objc(requestMotionAuth:rejecter:)
  func requestMotionAuth(_ resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard CMMotionActivityManager.isActivityAvailable() else {
      resolve("unavailable")
      return
    }
    let now = Date()
    activityManager.queryActivityStarting(from: now.addingTimeInterval(-1), to: now, to: .main) { _, _ in
      switch CMMotionActivityManager.authorizationStatus() {
      case .authorized:    resolve("authorized")
      case .denied:        resolve("denied")
      case .restricted:    resolve("restricted")
      case .notDetermined: resolve("notDetermined")
      @unknown default:    resolve("unknown")
      }
    }
  }

  /// Did the device stay put between two timestamps (seconds since epoch)?
  ///
  /// Returns the whole picture rather than a bare bool, so the JS layer can
  /// explain WHAT happened ("moved at 2:14am") instead of just failing.
  ///
  /// `unknown` samples are NOT counted as movement. A phone face-down on a
  /// dresser produces long unknown/stationary stretches, and treating those as
  /// failure would punish the exact behaviour we're rewarding.
  @objc(checkStillness:to:resolver:rejecter:)
  func checkStillness(_ from: NSNumber,
                      to: NSNumber,
                      resolver resolve: @escaping RCTPromiseResolveBlock,
                      rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard CMMotionActivityManager.isActivityAvailable() else {
      reject("motion_unavailable", "This device has no motion activity data.", nil)
      return
    }
    guard CMMotionActivityManager.authorizationStatus() == .authorized else {
      reject("motion_denied", "Motion & Fitness access is off for Drift.", nil)
      return
    }

    let start = Date(timeIntervalSince1970: from.doubleValue)
    let end   = Date(timeIntervalSince1970: to.doubleValue)
    guard end > start else {
      reject("bad_range", "End must be after start.", nil)
      return
    }

    activityManager.queryActivityStarting(from: start, to: end, to: .main) { activities, error in
      if let error = error {
        reject("motion_query_failed", error.localizedDescription, error)
        return
      }
      guard let activities = activities, !activities.isEmpty else {
        // No recorded samples at all. Genuinely unknown — say so rather than
        // claiming success, so JS can decide how generous to be.
        resolve([
          "moved": false,
          "conclusive": false,
          "sampleCount": 0,
          "stationaryRatio": 0,
          "movementEvents": 0,
        ] as [String: Any])
        return
      }

      // Only medium/high confidence counts. Low-confidence walking samples are
      // common noise from a stationary phone on a vibrating surface.
      var movementEvents = 0
      var firstMovementAt: Double = 0
      var stationarySamples = 0

      for a in activities {
        let moving = a.walking || a.running || a.automotive || a.cycling
        if moving && a.confidence != .low {
          movementEvents += 1
          if firstMovementAt == 0 { firstMovementAt = a.startDate.timeIntervalSince1970 }
        }
        if a.stationary { stationarySamples += 1 }
      }

      let ratio = Double(stationarySamples) / Double(activities.count)
      var out: [String: Any] = [
        "moved": movementEvents > 0,
        "conclusive": true,
        "sampleCount": activities.count,
        "stationaryRatio": ratio,
        "movementEvents": movementEvents,
      ]
      if firstMovementAt > 0 { out["firstMovementAt"] = firstMovementAt }
      resolve(out)
    }
  }
}

// ── NFC delegate ──────────────────────────────────────────────
#if canImport(CoreNFC)
@available(iOS 13.0, *)
extension SleepGuardModule: NFCTagReaderSessionDelegate {

  func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {}

  func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
    // Fires for user-cancel too, so map that to a distinct code instead of
    // surfacing it as a failure.
    let nfcErr = error as? NFCReaderError
    let cancelled = nfcErr?.code == .readerSessionInvalidationErrorUserCanceled
    DispatchQueue.main.async {
      self.finishScan(
        id: nil,
        errorCode: cancelled ? "cancelled" : "nfc_error",
        errorMessage: cancelled ? "Scan cancelled." : error.localizedDescription
      )
    }
  }

  func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
    guard let first = tags.first else {
      session.invalidate(errorMessage: "No tag found.")
      return
    }
    session.connect(to: first) { error in
      if let error = error {
        session.invalidate(errorMessage: error.localizedDescription)
        return
      }
      // NTAG21x and most stickers enumerate as MiFare over ISO14443-A.
      var identifier: Data?
      switch first {
      case let .miFare(tag):    identifier = tag.identifier
      case let .iso7816(tag):   identifier = tag.identifier
      case let .iso15693(tag):  identifier = Data(tag.identifier)
      case let .feliCa(tag):    identifier = tag.currentIDm
      @unknown default:         identifier = nil
      }
      guard let id = identifier, !id.isEmpty else {
        session.invalidate(errorMessage: "Couldn't read that tag.")
        return
      }
      let hex = id.map { String(format: "%02x", $0) }.joined()
      session.alertMessage = "Tag read."
      session.invalidate()
      DispatchQueue.main.async {
        self.finishScan(id: hex, errorCode: nil, errorMessage: nil)
      }
    }
  }
}
#endif
