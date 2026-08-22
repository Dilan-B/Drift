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
// When Expo ships official scene support, delete this file and revert
// AppDelegate rather than trying to merge the two.
//
import UIKit
import React
import Expo

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

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
    // the openURLContexts callback below.
    if let url = connectionOptions.urlContexts.first?.url {
      RCTLinkingManager.application(UIApplication.shared, open: url, options: [:])
    }
    for activity in connectionOptions.userActivities where activity.activityType == NSUserActivityTypeBrowsingWeb {
      RCTLinkingManager.application(
        UIApplication.shared,
        continue: activity,
        restorationHandler: { _ in })
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
