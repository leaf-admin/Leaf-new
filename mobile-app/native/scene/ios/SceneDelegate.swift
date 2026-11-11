import Expo
import React
import UIKit

// Ciclo de vida por cenas (UIScene), exigido para apps compilados com o SDK do iOS 27:
// sem ele o UIKit derruba o app na abertura. A janela do React Native nasce aqui;
// o AppDelegate continua criando a factory, Firebase e Google Maps.
// Gerado por plugins/withSceneLifecycle.js; mantenha os dois iguais.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory else { return }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window

    // App aberto a frio por um link: no ciclo de cenas a URL não vem nas launchOptions,
    // e é de lá que o Linking.getInitialURL() do React Native lê. Põe ela de volta.
    var launchOptions = appDelegate.launchOptions ?? [:]
    if let urlContext = connectionOptions.urlContexts.first {
      launchOptions[.url] = urlContext.url
      if let source = urlContext.options.sourceApplication {
        launchOptions[.sourceApplication] = source
      }
    }
    if let userActivity = connectionOptions.userActivities.first(where: {
      $0.activityType == NSUserActivityTypeBrowsingWeb
    }) {
      let userActivityDictionary: [String: Any] = [
        UIApplication.LaunchOptionsKey.userActivityType.rawValue: userActivity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": userActivity,
      ]
      launchOptions[.userActivityDictionary] = userActivityDictionary
    }
    appDelegate.launchOptions = launchOptions

    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
    window.makeKeyAndVisible()
  }

  // Esquema próprio (br.com.leaf.ride://) com o app já aberto.
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    URLContexts.forEach { forwardOpen($0) }
  }

  // Universal links (leaf.app.br/convite, /motorista/convite, /viagem) com o app já aberto.
  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    forwardContinue(userActivity)
  }

  private func forwardOpen(_ context: UIOpenURLContext) {
    var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
    if let source = context.options.sourceApplication {
      options[.sourceApplication] = source
    }
    if let annotation = context.options.annotation {
      options[.annotation] = annotation
    }
    options[.openInPlace] = context.options.openInPlace
    _ = UIApplication.shared.delegate?.application?(UIApplication.shared, open: context.url, options: options)
  }

  private func forwardContinue(_ userActivity: NSUserActivity) {
    _ = UIApplication.shared.delegate?.application?(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in })
  }
}
