// Scene lifecycle bridge for the pinned Expo SDK 54 / React Native 0.81 runtime.
// Follows Expo SDK 57 ExpoAppSceneDelegate's startup and event-forwarding contract.
// Kept in the generated AppDelegate compilation unit to avoid Xcode project drift.
@MainActor
final class WashedUpSceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  private var appDelegate: AppDelegate? {
    UIApplication.shared.delegate as? AppDelegate
  }

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
             options connectionOptions: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene else { return }
    guard let appDelegate, let factory = appDelegate.reactNativeFactory else {
      preconditionFailure("Scene connected before the Expo factory was initialized")
    }

    // A disconnected single scene can reconnect while the JS runtime is alive.
    // Reattach its existing root instead of starting Expo Updates/React a second time.
    let isFirstConnection = appDelegate.window == nil
    let window = appDelegate.window ?? UIWindow(windowScene: windowScene)
    window.windowScene = windowScene
    self.window = window
    appDelegate.window = window // Expo Updates' deferred root replacement reads this.

    let options = Self.launchOptions(
      original: appDelegate.sceneLaunchOptions,
      url: connectionOptions.urlContexts.first?.url,
      userActivity: connectionOptions.userActivities.first {
        $0.activityType == NSUserActivityTypeBrowsingWeb
      }
    )

    // Seed Expo Linking's initialURL before JS starts; the same AppDelegate
    // overrides also retain Google sign-in and React Native Linking handling.
    forwardURLs(connectionOptions.urlContexts)
    connectionOptions.userActivities.forEach { forwardActivity($0) }

    if isFirstConnection {
      factory.startReactNative(withModuleName: "main", in: window, launchOptions: options)
      appDelegate.sceneLaunchOptions = nil
    } else {
      window.makeKeyAndVisible()
    }
    // APNs and UNUserNotificationCenterDelegate delivery remains owned by the
    // existing Expo/OneSignal subscribers. Do not replay notificationResponse:
    // UIKit also delivers that response through the notification-center delegate.
    if let shortcut = connectionOptions.shortcutItem {
      appDelegate.application(UIApplication.shared, performActionFor: shortcut) { _ in }
    }
  }

  func sceneDidDisconnect(_ scene: UIScene) {
    window = nil // AppDelegate retains the single running React root for reconnect.
  }

  func sceneDidBecomeActive(_ scene: UIScene) {
    appDelegate?.applicationDidBecomeActive(UIApplication.shared)
  }

  func sceneWillResignActive(_ scene: UIScene) {
    appDelegate?.applicationWillResignActive(UIApplication.shared)
  }

  func sceneWillEnterForeground(_ scene: UIScene) {
    appDelegate?.applicationWillEnterForeground(UIApplication.shared)
  }

  func sceneDidEnterBackground(_ scene: UIScene) {
    appDelegate?.applicationDidEnterBackground(UIApplication.shared)
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    forwardURLs(URLContexts)
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    forwardActivity(userActivity)
  }

  func scene(_ scene: UIScene, willContinueUserActivityWithType activityType: String) {
    _ = appDelegate?.application(UIApplication.shared, willContinueUserActivityWithType: activityType)
  }

  func scene(_ scene: UIScene, didFailToContinueUserActivityWithType activityType: String, error: Error) {
    appDelegate?.application(UIApplication.shared, didFailToContinueUserActivityWithType: activityType, error: error)
  }

  func scene(_ scene: UIScene, didUpdate userActivity: NSUserActivity) {
    appDelegate?.application(UIApplication.shared, didUpdate: userActivity)
  }

  func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem,
                   completionHandler: @escaping (Bool) -> Void) {
    guard let appDelegate else { completionHandler(false); return }
    appDelegate.application(UIApplication.shared, performActionFor: shortcutItem, completionHandler: completionHandler)
  }

  private func forwardURLs(_ contexts: Set<UIOpenURLContext>) {
    for context in contexts {
      var options: [UIApplication.OpenURLOptionsKey: Any] = [.openInPlace: context.options.openInPlace]
      if let source = context.options.sourceApplication { options[.sourceApplication] = source }
      if let annotation = context.options.annotation { options[.annotation] = annotation }
      _ = appDelegate?.application(UIApplication.shared, open: context.url, options: options)
    }
  }

  private func forwardActivity(_ activity: NSUserActivity) {
    _ = appDelegate?.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
  }

  static func launchOptions(original: [UIApplication.LaunchOptionsKey: Any]?, url: URL?,
                            userActivity: NSUserActivity?) -> [UIApplication.LaunchOptionsKey: Any]? {
    var options = original ?? [:]
    // RN 0.81 getInitialURL still reads these exact legacy dictionary keys.
    if let url { options[.init(rawValue: "UIApplicationLaunchOptionsURLKey")] = url }
    if let userActivity {
      options[.init(rawValue: "UIApplicationLaunchOptionsUserActivityDictionaryKey")] = [
        "UIApplicationLaunchOptionsUserActivityTypeKey": userActivity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": userActivity
      ]
    }
    return options.isEmpty ? nil : options
  }
}
