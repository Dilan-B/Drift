import Expo
import React
import ReactAppDependencyProvider
import ObjectiveC.runtime

@UIApplicationMain
public class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  // Held for SceneDelegate: the scene connects AFTER didFinishLaunching, and
  // startReactNative still wants the original launch options.
  var pendingLaunchOptions: [UIApplication.LaunchOptionsKey: Any]?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    DriftTextUndoCrashGuard.install()

    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    bindReactNativeFactory(factory)
    pendingLaunchOptions = launchOptions

    // React Native is started HERE, before super, exactly as Expo's template
    // does it — NOT in SceneDelegate.
    //
    // expo-dev-launcher requires it: its subscriber runs during
    // super.application(...) and calls EXDevLauncherController.autoSetupStart,
    // which throws "was called before autoSetupPrepare:" unless the bridge was
    // already created. Moving startReactNative into the scene (the textbook
    // migration) breaks that ordering.
    //
    // SceneDelegate therefore does NOT start React Native. It only attaches this
    // window to the scene. The UIApplicationSceneManifest in Info.plist is what
    // satisfies the iOS 27 SDK's scene requirement; the startup order is
    // unchanged from before the migration.
#if os(iOS) || os(tvOS)
    let mainWindow = UIWindow(frame: UIScreen.main.bounds)
    window = mainWindow
    factory.startReactNative(
      withModuleName: "main",
      in: mainWindow,
      launchOptions: launchOptions)
    mainWindow.makeKeyAndVisible()
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Points UIKit at SceneDelegate. Must agree with the UISceneDelegateClassName
  // in Info.plist's UIApplicationSceneManifest.
  public func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    let config = UISceneConfiguration(
      name: "Default Configuration",
      sessionRole: connectingSceneSession.role)
    config.delegateClass = SceneDelegate.self
    return config
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

private enum DriftTextUndoCrashGuard {
  private static var installed = false

  static func install() {
    guard !installed else { return }
    installed = true

    // The TestFlight 1.0.0 (8) crash is UIKit aborting inside text undo:
    // UIUndoGestureInteraction -> _UITextUndoManager -> NSTextStorage.
    // React Native TextInput is controlled from JS, so system undo is not worth
    // the risk here. Disable shake/gesture undo globally for native text inputs.
    UIApplication.shared.applicationSupportsShakeToEdit = false
    disableUndoManager(for: UITextField.self)
    disableUndoManager(for: UITextView.self)
    disableUndoAction("undo:", for: UITextField.self)
    disableUndoAction("redo:", for: UITextField.self)
    disableUndoAction("undo:", for: UITextView.self)
    disableUndoAction("redo:", for: UITextView.self)
  }

  private static func disableUndoManager(for cls: AnyClass) {
    let selector = NSSelectorFromString("undoManager")
    let block: @convention(block) (AnyObject) -> AnyObject? = { _ in nil }
    let implementation = imp_implementationWithBlock(block)
    class_replaceMethod(cls, selector, implementation, "@@:")
  }

  private static func disableUndoAction(_ actionName: String, for cls: AnyClass) {
    let selector = NSSelectorFromString(actionName)
    let block: @convention(block) (AnyObject, AnyObject?) -> Void = { _, _ in }
    let implementation = imp_implementationWithBlock(block)
    class_replaceMethod(cls, selector, implementation, "v@:@")
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
