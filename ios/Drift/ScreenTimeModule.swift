//
// ScreenTimeModule.swift
// Drift — native bridge to Apple Screen Time (FamilyControls + ManagedSettings).
//
// Exposes 4 methods to JS:
//   requestAuthorization()                -> "approved" | "denied" | "notDetermined"
//   getAuthorizationStatus()              -> string
//   presentFamilyActivityPicker()         -> void (presents Apple's app picker)
//   applyShield()                         -> void (shields the user's saved selection)
//   clearShield()                         -> void
//
// The user's app/category/web-domain selection is persisted in UserDefaults as
// an encoded `FamilyActivitySelection`. ManagedSettings then shields exactly
// what the user picked — Apple never reveals the bundle IDs to us.
//
import Foundation
import UIKit
import React

#if canImport(FamilyControls) && canImport(ManagedSettings)
import FamilyControls
import ManagedSettings
import SwiftUI
import Combine

@available(iOS 16.0, *)
final class ScreenTimeSelectionStore: ObservableObject {
  static let shared = ScreenTimeSelectionStore()
  private let key = "drift_family_activity_selection"

  @Published var selection: FamilyActivitySelection = FamilyActivitySelection() {
    didSet { persist() }
  }

  init() {
    load()
  }

  private func load() {
    guard let data = UserDefaults.standard.data(forKey: key) else { return }
    if let decoded = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data) {
      selection = decoded
    }
  }

  private func persist() {
    if let data = try? JSONEncoder().encode(selection) {
      UserDefaults.standard.set(data, forKey: key)
    }
  }
}

@available(iOS 16.0, *)
struct FamilyPickerView: View {
  @ObservedObject var store = ScreenTimeSelectionStore.shared
  var onDone: () -> Void

  var body: some View {
    NavigationView {
      FamilyActivityPicker(selection: $store.selection)
        .navigationTitle("Apps to block")
        .navigationBarItems(trailing: Button("Done", action: onDone))
    }
  }
}
#endif

@objc(ScreenTimeModule)
class ScreenTimeModule: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool { return true }

  @objc func constantsToExport() -> [AnyHashable: Any]! {
    return ["available": isAvailable()]
  }

  private func isAvailable() -> Bool {
    if #available(iOS 16.0, *) {
      #if canImport(FamilyControls)
      return true
      #else
      return false
      #endif
    }
    return false
  }

  // ── Authorization ───────────────────────────────────────────
  @objc(requestAuthorization:rejecter:)
  func requestAuthorization(_ resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
    #if canImport(FamilyControls)
    if #available(iOS 16.0, *) {
      Task {
        do {
          try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
          let status = AuthorizationCenter.shared.authorizationStatus
          resolve(statusString(status))
        } catch {
          reject("auth_error", error.localizedDescription, error)
        }
      }
      return
    }
    #endif
    reject("unavailable", "Screen Time API requires iOS 16+", nil)
  }

  @objc(getAuthorizationStatus:rejecter:)
  func getAuthorizationStatus(_ resolve: RCTPromiseResolveBlock,
                              rejecter reject: RCTPromiseRejectBlock) {
    #if canImport(FamilyControls)
    if #available(iOS 16.0, *) {
      resolve(statusString(AuthorizationCenter.shared.authorizationStatus))
      return
    }
    #endif
    resolve("unavailable")
  }

  // ── Picker ──────────────────────────────────────────────────
  @objc(presentFamilyActivityPicker:rejecter:)
  func presentFamilyActivityPicker(_ resolve: @escaping RCTPromiseResolveBlock,
                                   rejecter reject: @escaping RCTPromiseRejectBlock) {
    #if canImport(FamilyControls)
    if #available(iOS 16.0, *) {
      DispatchQueue.main.async {
        guard let root = Self.topViewController() else {
          reject("no_vc", "No root view controller", nil); return
        }
        let host = UIHostingController(rootView: FamilyPickerView(onDone: {
          root.dismiss(animated: true) {
            resolve(nil)
          }
        }))
        host.modalPresentationStyle = .formSheet
        root.present(host, animated: true, completion: nil)
      }
      return
    }
    #endif
    reject("unavailable", "Screen Time API requires iOS 16+", nil)
  }

  // ── Shield apply / clear ────────────────────────────────────
  @objc(applyShield:rejecter:)
  func applyShield(_ resolve: RCTPromiseResolveBlock,
                   rejecter reject: RCTPromiseRejectBlock) {
    #if canImport(FamilyControls) && canImport(ManagedSettings)
    if #available(iOS 16.0, *) {
      let selection = ScreenTimeSelectionStore.shared.selection
      let store = ManagedSettingsStore(named: .init("driftFocus"))
      store.shield.applications = selection.applicationTokens.isEmpty
        ? nil : selection.applicationTokens
      store.shield.applicationCategories = selection.categoryTokens.isEmpty
        ? nil : .specific(selection.categoryTokens)
      store.shield.webDomains = selection.webDomainTokens.isEmpty
        ? nil : selection.webDomainTokens
      resolve(nil)
      return
    }
    #endif
    reject("unavailable", "Screen Time API requires iOS 16+", nil)
  }

  @objc(clearShield:rejecter:)
  func clearShield(_ resolve: RCTPromiseResolveBlock,
                   rejecter reject: RCTPromiseRejectBlock) {
    #if canImport(ManagedSettings)
    if #available(iOS 16.0, *) {
      let store = ManagedSettingsStore(named: .init("driftFocus"))
      store.shield.applications = nil
      store.shield.applicationCategories = nil
      store.shield.webDomains = nil
      resolve(nil)
      return
    }
    #endif
    resolve(nil)
  }

  // ── Helpers ─────────────────────────────────────────────────
  #if canImport(FamilyControls)
  @available(iOS 16.0, *)
  private func statusString(_ status: AuthorizationStatus) -> String {
    switch status {
    case .approved:      return "approved"
    case .denied:        return "denied"
    case .notDetermined: return "notDetermined"
    @unknown default:    return "unknown"
    }
  }
  #endif

  private static func topViewController(_ base: UIViewController? =
    UIApplication.shared.connectedScenes
      .compactMap { ($0 as? UIWindowScene)?.keyWindow }
      .first?.rootViewController) -> UIViewController? {
    if let nav = base as? UINavigationController { return topViewController(nav.visibleViewController) }
    if let tab = base as? UITabBarController, let sel = tab.selectedViewController {
      return topViewController(sel)
    }
    if let presented = base?.presentedViewController { return topViewController(presented) }
    return base
  }
}
