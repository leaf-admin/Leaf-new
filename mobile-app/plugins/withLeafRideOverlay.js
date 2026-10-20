const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Corrida fora do app no Android: balão por cima do app de navegação e Live Update
// do Android 16. O código está em native/ride-overlay/android.
const TEMPLATES_ROOT = path.join(__dirname, '..', 'native', 'ride-overlay', 'android');
const ANDROID_PACKAGE_PATH = path.join('app', 'src', 'main', 'java', 'br', 'com', 'leaf', 'ride');
const ANDROID_DRAWABLE_PATH = path.join('app', 'src', 'main', 'res', 'drawable');
const KOTLIN_FILES = [
  'LeafRideOverlayModule.kt',
  'LeafRideOverlayPackage.kt',
  'LeafRideOverlayState.kt',
  'LeafRideOverlayWindow.kt',
  'LeafRideLiveUpdate.kt',
];
const PERMISSIONS = [
  // Balão por cima do Waze/Google Maps durante a corrida. O motorista liga em
  // "Sobrepor a outros apps"; sem ele, nada muda.
  'android.permission.SYSTEM_ALERT_WINDOW',
  // Android 16: pedir que a notificação da corrida vire Live Update.
  'android.permission.POST_PROMOTED_NOTIFICATIONS',
];

function copyFile(sourcePath, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function patchAndroidMainApplication(mainApplicationPath) {
  if (!fs.existsSync(mainApplicationPath)) {
    console.warn('[withLeafRideOverlay] MainApplication.kt not found');
    return;
  }
  let content = fs.readFileSync(mainApplicationPath, 'utf8');
  if (content.includes('LeafRideOverlayPackage()')) {
    return;
  }
  const packageLine = '              add(LeafRideOverlayPackage())';
  const anchors = [
    '              add(LeafFaceEmbeddingPackage())',
    '              // add(MyReactNativePackage())',
    '            PackageList(this).packages.apply {',
  ];
  const anchor = anchors.find((line) => content.includes(line));
  if (!anchor) {
    console.warn('[withLeafRideOverlay] Could not find package insertion point in MainApplication.kt');
    return;
  }
  content = content.replace(anchor, `${anchor}\n${packageLine}`);
  fs.writeFileSync(mainApplicationPath, content);
}

const withLeafRideOverlay = (config) => {
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.platformProjectRoot;
      const androidTargetDir = path.join(projectRoot, ANDROID_PACKAGE_PATH);
      KOTLIN_FILES.forEach((file) => {
        copyFile(path.join(TEMPLATES_ROOT, file), path.join(androidTargetDir, file));
      });
      copyFile(
        path.join(TEMPLATES_ROOT, 'leaf_ride_car.xml'),
        path.join(projectRoot, ANDROID_DRAWABLE_PATH, 'leaf_ride_car.xml')
      );
      patchAndroidMainApplication(path.join(androidTargetDir, 'MainApplication.kt'));
      return config;
    },
  ]);

  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    manifest['uses-permission'] = manifest['uses-permission'] || [];
    PERMISSIONS.forEach((name) => {
      const existing = manifest['uses-permission'].find((entry) => entry?.$?.['android:name'] === name);
      if (existing) {
        // Um bloqueio antigo (tools:node="remove") anularia a permissão.
        delete existing.$['tools:node'];
      } else {
        manifest['uses-permission'].push({ $: { 'android:name': name } });
      }
    });
    return config;
  });

  return config;
};

module.exports = withLeafRideOverlay;
