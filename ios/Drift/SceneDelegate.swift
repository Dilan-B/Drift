//
// SceneDelegate.swift
// Drift — UIKit scene lifecycle adoption.
//
// WHY THIS EXISTS
// Apps built against the iOS 27 SDK refuse to launch without scene lifecycle
// adoption ("UIScene life cycle is required for apps built with this SDK").
// Expo SDK 54 / RN 0.81 ship no scene support, and Expo's own template has the
// same problem — see expo/expo#46664. So this is hand-written.
//
// It is deliberately a thin shim: the AppDelegate still builds the React Native
// factory exactly as before, and this class only owns the window and forwards
// the events that UIKit re-routed away from UIApplicationDelegate.
//
// DEEP LINKS ARE THE TRAP. Under scene lifecycle, iOS stops calling
// application(_:open:options:) and application(_:continue:restorationHandler:)
// and delivers to the scene instead. Drift relies on both — Supabase emails
// confirmation links back into the app, and friend invites use drift://. If
// these forwards are removed, auth silently breaks with no build error.
//
// AND THE COLD LAUNCH IS A SECOND, QUIETER TRAP. Forwarding the URL here the
// moment the scene connects is not enough, because BOTH ways JS could hear it
// are shut at that instant:
//
//   * Linking.getInitialURL() reads only bridge.launchOptions[...URLKey]
//     (RCTLinkingManager.mm), and UIKit never puts the URL in launch options
//     under the scene lifecycle — it arrives in connectionOptions instead.
//   * RCTLinkingManager.application(_:open:) merely posts RCTOpenURLNotification,
//     and at willConnectTo the JS bundle has not run, so nothing is listening.
//
// Both miss, and the URL is silently lost. A warm launch works fine, which is
// what makes this so easy to miss: tap a verification link seconds after
// signing up and Drift is still in memory; come back an hour later and the same
// link does nothing at all.
//
// So a cold-launch URL is HELD and replayed once React has actually mounted.
// The JS handlers in Drift.jsx dedupe by URL, so a duplicate delivery is inert —
// which is what lets the fallback timer below be unconditional.
//
// When Expo ships official scene support, delete this file and revert
// AppDelegate rather than trying to merge the two.
//
import UIKit
import React
import Expo

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  /// A launch URL that arrived before JS could listen for it.
  private var pendingURL: URL?
  /// A universal-link activity in the same position.
  private var pendingActivity: NSUserActivity?
  private var contentObserver: NSObjectProtocol?
  /// Guards against the notification and the fallback timer both firing.
  private var replayed = false

  // Posted by the Fabric root view once React has mounted content. Spelled out
  // rather than imported: the constant lives in RCTRootView.h, which is not
  // reliably visible from Swift across Expo's header layouts.
  private static let contentDidAppear = Notification.Name("RCTContentDidAppearNotification")

  deinit {
    if let o = contentObserver { NotificationCenter.default.removeObserver(o) }
  }

  /// Hand the held URL to React. Safe to call more than once — the first call
  /// consumes the URL, and the JS side dedupes regardless.
  private func replayPendingLink(reason: String) {
    guard !replayed else { return }
    guard pendingURL != nil || pendingActivity != nil else { return }
    replayed = true

    if let url = pendingURL {
      NSLog("[Drift.Scene] replaying cold-launch URL (%@)", reason)
      RCTLinkingManager.application(UIApplication.shared, open: url, options: [:])
      pendingURL = nil
    }
    if let activity = pendingActivity {
      NSLog("[Drift.Scene] replaying cold-launch activity (%@)", reason)
      RCTLinkingManager.application(
        UIApplication.shared, continue: activity, restorationHandler: { _ in })
      pendingActivity = nil
    }
    if let o = contentObserver {
      NotificationCenter.default.removeObserver(o)
      contentObserver = nil
    }
  }

  /// Wait for React to mount, then replay. RCTContentDidAppearNotification is
  /// the earliest honest signal; the short delay after it covers the gap
  /// between the mount commit and Drift.jsx's useEffect registering its
  /// Linking listener. The timer is a backstop for the case where content
  /// appeared before this scene finished connecting, which would mean the
  /// notification has already gone by and will never fire again.
  private func scheduleReplay() {
    guard pendingURL != nil || pendingActivity != nil else { return }

    contentObserver = NotificationCenter.default.addObserver(
      forName: Self.contentDidAppear, object: nil, queue: .main
    ) { [weak self] _ in
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
        self?.replayPendingLink(reason: "content appeared")
      }
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + 6.0) { [weak self] in
      self?.replayPendingLink(reason: "fallback timer")
    }
  }

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    // Every bail-out below is LOUD on purpose. A silent `return` here leaves an
    // empty window, which on screen is indistinguishable from the UIScene launch
    // failure this class exists to fix — so a quiet failure would send the next
    // person debugging in exactly the wrong direction.
    NSLog("[Drift.Scene] willConnectTo — scene=%@", String(describing: type(of: scene)))

    guard let windowScene = scene as? UIWindowScene else {
      NSLog("[Drift.Scene] ABORT: scene is not a UIWindowScene")
      return
    }
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else {
      NSLog("[Drift.Scene] ABORT: UIApplication.delegate is %@, not AppDelegate",
            String(describing: UIApplication.shared.delegate))
      return
    }
    // React Native is ALREADY running — AppDelegate started it before super,
    // because expo-dev-launcher requires that ordering. This scene's only job is
    // to adopt the existing window so UIKit is satisfied. Do NOT start React
    // Native here; doing so breaks dev-launcher's autoSetupPrepare/Start pairing.
    guard let window = appDelegate.window else {
      NSLog("[Drift.Scene] ABORT: AppDelegate.window is nil — RN start must have failed")
      return
    }

    window.windowScene = windowScene
    self.window = window
    window.makeKeyAndVisible()
    NSLog("[Drift.Scene] adopted window — rootVC=%@ key=%d",
          String(describing: window.rootViewController), window.isKeyWindow ? 1 : 0)

    // A cold launch FROM a deep link delivers the URL here rather than through
    // the openURLContexts callback below. Do NOT forward it now — see the note
    // at the top of this file. Hold it until React can hear it.
    pendingURL = connectionOptions.urlContexts.first?.url
    pendingActivity = connectionOptions.userActivities.first {
      $0.activityType == NSUserActivityTypeBrowsingWeb
    }
    if pendingURL != nil || pendingActivity != nil {
      NSLog("[Drift.Scene] cold launch carried a link — holding it until React mounts")
      scheduleReplay()
    }
  }

  // drift:// custom scheme, and Supabase auth callbacks, while already running.
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let url = URLContexts.first?.url else { return }
    RCTLinkingManager.application(UIApplication.shared, open: url, options: [:])
  }

  // Universal links while already running.
  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    RCTLinkingManager.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in })
  }
}
