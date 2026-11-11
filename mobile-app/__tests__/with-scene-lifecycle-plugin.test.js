jest.mock('@expo/config-plugins', () => ({
  withAppDelegate: jest.fn((c) => c),
  withDangerousMod: jest.fn((c) => c),
  withInfoPlist: jest.fn((c) => c),
  withXcodeProject: jest.fn((c) => c),
}));

const fs = require('fs');
const path = require('path');
const { addSceneManifest, moveWindowToScene } = require('../plugins/withSceneLifecycle');

const appDelegate = fs.readFileSync(path.join(__dirname, 'fixtures', 'appdelegate-sdk54.swift.txt'), 'utf8');
const sceneDelegate = fs.readFileSync(path.join(__dirname, '..', 'native', 'scene', 'ios', 'SceneDelegate.swift'), 'utf8');

describe('withSceneLifecycle (iOS 27 SDK scene lifecycle)', () => {
  it('declares one window scene served by SceneDelegate', () => {
    const plist = addSceneManifest({ CFBundleName: 'Leaf' });
    expect(plist.CFBundleName).toBe('Leaf');
    expect(plist.UIApplicationSceneManifest).toEqual({
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [{
          UISceneConfigurationName: 'Default Configuration',
          UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
        }],
      },
    });
  });

  it('moves window creation out of the AppDelegate and keeps Firebase and Maps setup', () => {
    const result = moveWindowToScene(appDelegate);

    expect(result).not.toContain('UIWindow(frame: UIScreen.main.bounds)');
    expect(result).not.toMatch(/factory\.startReactNative\(/);
    expect(result).toContain('var launchOptions: [UIApplication.LaunchOptionsKey: Any]?');
    expect(result).toContain('self.launchOptions = launchOptions');
    expect(result).toContain('FirebaseApp.configure()');
    expect(result).toContain('GMSServices.provideAPIKey(');
    expect(result).toContain('bindReactNativeFactory(factory)');
    expect(result).toContain('RCTLinkingManager.application(app, open: url, options: options)');
    expect(result).toContain('RCTLinkingManager.application(application, continue: userActivity');
  });

  it('is idempotent across prebuilds', () => {
    const once = moveWindowToScene(appDelegate);
    expect(moveWindowToScene(once)).toBe(once);
  });

  it('refuses an AppDelegate it does not recognize instead of shipping a blank app', () => {
    expect(() => moveWindowToScene('class AppDelegate {}')).toThrow('withSceneLifecycle');
  });

  it('starts React Native in the scene window and forwards links to the AppDelegate', () => {
    expect(sceneDelegate).toContain('class SceneDelegate: UIResponder, UIWindowSceneDelegate');
    expect(sceneDelegate).toContain('UIWindow(windowScene: windowScene)');
    expect(sceneDelegate).toMatch(/startReactNative\(\s*withModuleName: "main",\s*in: window,\s*launchOptions: launchOptions\)/);
    // Abertura a frio por link: a URL volta para as launchOptions (Linking.getInitialURL).
    expect(sceneDelegate).toContain('launchOptions[.url] = urlContext.url');
    expect(sceneDelegate).toContain('launchOptions[.userActivityDictionary]');
    expect(sceneDelegate).toContain('openURLContexts');
    expect(sceneDelegate).toContain('continue userActivity: NSUserActivity');
    expect(sceneDelegate).toContain('connectionOptions.urlContexts');
    expect(sceneDelegate).toContain('connectionOptions.userActivities');
  });
});
