const { withAppDelegate, withDangerousMod, withInfoPlist, withXcodeProject } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Ciclo de vida por cenas (UIScene). Apps compilados com o SDK do iOS 27 (Xcode 27)
// que não o adotam são derrubados pelo UIKit na abertura em aparelhos com iOS 27
// (_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption). O Expo SDK 54 não
// gera isso; o SDK 58 passa a gerar. Este plugin:
//   - declara a cena no Info.plist (UIApplicationSceneManifest);
//   - copia native/scene/ios/SceneDelegate.swift e o põe no target;
//   - tira a criação da janela do AppDelegate (o SceneDelegate cria e chama startReactNative).
const SCENE_DELEGATE = 'SceneDelegate.swift';

function addSceneManifest(plist) {
  plist.UIApplicationSceneManifest = {
    UIApplicationSupportsMultipleScenes: false,
    UISceneConfigurations: {
      UIWindowSceneSessionRoleApplication: [
        {
          UISceneConfigurationName: 'Default Configuration',
          UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
        },
      ],
    },
  };
  return plist;
}

function moveWindowToScene(contents) {
  if (contents.includes('var launchOptions: [UIApplication.LaunchOptionsKey: Any]?')) return contents;

  const factoryVar = '  var reactNativeFactory: RCTReactNativeFactory?\n';
  const windowLine = /\n[ \t]*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n/;
  const startCall = /\n[ \t]*factory\.startReactNative\(\s*withModuleName: "main",\s*in: window,\s*launchOptions: launchOptions\)\n/;
  if (!contents.includes(factoryVar) || !windowLine.test(contents) || !startCall.test(contents)) {
    throw new Error('withSceneLifecycle: AppDelegate fora do formato esperado do Expo SDK 54');
  }

  return contents
    .replace(factoryVar, `${factoryVar}  // Lido pelo SceneDelegate, que cria a janela (ciclo de cenas, SDK do iOS 27).\n  var launchOptions: [UIApplication.LaunchOptionsKey: Any]?\n`)
    .replace(/\n([ \t]*)#if os\(iOS\) \|\| os\(tvOS\)\n[ \t]*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n/, '\n    self.launchOptions = launchOptions\n\n$1#if os(iOS) || os(tvOS)\n')
    .replace(startCall, '\n    // A janela e o startReactNative ficam no SceneDelegate.\n');
}

module.exports = function withSceneLifecycle(config) {
  config = withInfoPlist(config, (config) => {
    config.modResults = addSceneManifest(config.modResults);
    return config;
  });
  config = withAppDelegate(config, (config) => {
    if (config.modResults.language !== 'swift') {
      throw new Error('withSceneLifecycle: AppDelegate em Swift esperado');
    }
    config.modResults.contents = moveWindowToScene(config.modResults.contents);
    return config;
  });
  config = withDangerousMod(config, ['ios', async (config) => {
    const destination = path.join(config.modRequest.platformProjectRoot, 'Leaf');
    fs.mkdirSync(destination, { recursive: true });
    fs.copyFileSync(path.join(__dirname, '..', 'native', 'scene', 'ios', SCENE_DELEGATE), path.join(destination, SCENE_DELEGATE));
    return config;
  }]);
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const target = project.getFirstTarget().uuid;
    const group = project.findPBXGroupKey({ name: 'Leaf' });
    if (!group) throw new Error('withSceneLifecycle: grupo Leaf ausente');
    const source = `Leaf/${SCENE_DELEGATE}`;
    if (!project.hasFile(source)) project.addSourceFile(source, { target }, group);
    return config;
  });
};

module.exports.addSceneManifest = addSceneManifest;
module.exports.moveWindowToScene = moveWindowToScene;
