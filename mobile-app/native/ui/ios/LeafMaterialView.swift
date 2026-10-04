import UIKit
import SwiftUI
import React

@objc(LeafMaterialViewManager)
final class LeafMaterialViewManager: RCTViewManager {
  override static func requiresMainQueueSetup() -> Bool { true }
  override func view() -> UIView! { LeafMaterialView() }
}

@objc(LeafRootTabViewManager)
final class LeafRootTabViewManager: RCTViewManager {
  override static func requiresMainQueueSetup() -> Bool { true }
  override func view() -> UIView! { LeafRootTabView() }
}

private final class LeafTabSelection: ObservableObject {
  @Published var selectedTab = 0
  var onPress: ((Int) -> Void)?
}

// Same TabView, original 32 pt images, tint and non-minimizing behavior as the
// approved Swift prototype. Its contents stay transparent over the RN screens.
private struct LeafSystemTabs: View {
  @ObservedObject var selection: LeafTabSelection
  private static let navigationImages: [String: UIImage] = ["leafNavHome", "leafNavActivity", "leafNavAccount"].reduce(into: [:]) { images, name in
    guard let source = UIImage(named: name) else { return }
    let format = UIGraphicsImageRendererFormat()
    format.scale = 3
    images[name] = UIGraphicsImageRenderer(size: CGSize(width: 32, height: 32), format: format)
      .image { _ in source.draw(in: CGRect(x: 0, y: 0, width: 32, height: 32)) }
      .withRenderingMode(.alwaysOriginal)
  }
  private var binding: Binding<Int> {
    Binding(get: { selection.selectedTab }, set: { value in
      guard (0...2).contains(value) else { return }
      selection.selectedTab = value
      selection.onPress?(value)
    })
  }
  private func label(_ title: String, image: String, key: String) -> some View {
    Label {
      Text(title)
    } icon: {
      Image(uiImage: Self.navigationImages[image] ?? UIImage()).renderingMode(.original)
    }.accessibilityIdentifier("leaf-root-tab-\(key)")
  }
  var body: some View {
    Group {
      if #available(iOS 26.0, *) {
        TabView(selection: binding) {
          Tab(value: 0) { Color.clear } label: { label("Início", image: "leafNavHome", key: "home") }
          Tab(value: 1) { Color.clear } label: { label("Atividade", image: "leafNavActivity", key: "activity") }
          Tab(value: 2) { Color.clear } label: { label("Conta", image: "leafNavAccount", key: "account") }
        }.tabBarMinimizeBehavior(.never)
      } else {
        TabView(selection: binding) {
          Color.clear.tabItem { label("Início", image: "leafNavHome", key: "home") }.tag(0)
          Color.clear.tabItem { label("Atividade", image: "leafNavActivity", key: "activity") }.tag(1)
          Color.clear.tabItem { label("Conta", image: "leafNavAccount", key: "account") }.tag(2)
        }
      }
    }.tint(Color(uiColor: UIColor { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(red: 212 / 255.0, green: 232 / 255.0, blue: 74 / 255.0, alpha: 1)
        : UIColor(red: 26 / 255.0, green: 51 / 255.0, blue: 14 / 255.0, alpha: 1)
    }))
  }
}

// TabView owns UIKit content containers as well as the bar. Clear only the
// content hierarchy; leave the native UITabBar and its glass descendants intact.
private final class LeafTransparentTabController: UIHostingController<LeafSystemTabs> {
  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    clearContentBackgrounds(in: view)
  }
  private func clearContentBackgrounds(in view: UIView) {
    if view is UITabBar { return }
    view.backgroundColor = .clear
    view.isOpaque = false
    for child in view.subviews { clearContentBackgrounds(in: child) }
  }
}

final class LeafRootTabView: RCTView {
  private let selection = LeafTabSelection()
  private var hostingController: UIHostingController<LeafSystemTabs>!
  @objc var selectedTab: NSNumber = 0 {
    didSet {
      let value = selectedTab.intValue
      if (0...2).contains(value), selection.selectedTab != value { selection.selectedTab = value }
    }
  }
  @objc var tabsVisible = false {
    didSet { hostingController.view.isHidden = !tabsVisible }
  }
  @objc var onTabPress: RCTDirectEventBlock?

  override init(frame: CGRect) {
    super.init(frame: frame)
    hostingController = LeafTransparentTabController(rootView: LeafSystemTabs(selection: selection))
    hostingController.view.backgroundColor = .clear
    hostingController.view.isHidden = true
    addSubview(hostingController.view)
    selection.onPress = { [weak self] value in self?.onTabPress?(["selectedTab": value]) }
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil, hostingController.parent == nil, let parent = reactViewController() {
      parent.addChild(hostingController)
      hostingController.didMove(toParent: parent)
    } else if window == nil, hostingController.parent != nil {
      hostingController.willMove(toParent: nil)
      hostingController.removeFromParent()
    }
  }
  override func layoutSubviews() {
    super.layoutSubviews()
    hostingController.view.frame = bounds
  }
  // Transparent tab contents must never intercept map, sheet or form touches.
  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    guard tabsVisible, let tabBar = findTabBar(in: hostingController.view), !tabBar.isHidden else { return nil }
    return tabBar.hitTest(tabBar.convert(point, from: self), with: event)
  }
  private func findTabBar(in view: UIView) -> UITabBar? {
    if let tabBar = view as? UITabBar { return tabBar }
    for child in view.subviews {
      if let tabBar = findTabBar(in: child) { return tabBar }
    }
    return nil
  }
}

// Small visual bridge. Navigation, content, actions and state remain React Native.
final class LeafMaterialView: RCTView {
  private let effect = UIVisualEffectView()
  override init(frame: CGRect) {
    super.init(frame: frame)
    effect.isUserInteractionEnabled = false
    insertSubview(effect, at: 0)
    if #available(iOS 26.0, *) {
      let glass = UIGlassEffect(style: .regular)
      glass.isInteractive = true
      effect.effect = glass
    } else {
      effect.effect = UIBlurEffect(style: .systemThinMaterial)
    }
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  override func layoutSubviews() {
    super.layoutSubviews()
    effect.frame = bounds
    effect.layer.cornerRadius = bounds.height / 2
    effect.clipsToBounds = true
    sendSubviewToBack(effect)
  }
}
