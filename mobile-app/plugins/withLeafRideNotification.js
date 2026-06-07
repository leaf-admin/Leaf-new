const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const TEMPLATES_ROOT = path.join(__dirname, '..', 'native', 'ride-notification');
const ANDROID_PACKAGE_PATH = path.join('app', 'src', 'main', 'java', 'br', 'com', 'leaf', 'ride');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyFile(sourcePath, targetPath) {
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function patchFile(filePath, patcher) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const before = fs.readFileSync(filePath, 'utf8');
  const after = patcher(before);
  if (after !== before) {
    fs.writeFileSync(filePath, after);
  }
}

function patchAndroidMainApplication(mainApplicationPath) {
  patchFile(mainApplicationPath, (content) => {
    if (content.includes('LeafRideNotificationPackage()')) {
      return content;
    }

    const packageLine = '              add(LeafRideNotificationPackage())';
    const faceLine = '              add(LeafFaceEmbeddingPackage())';
    const awsLine = '              add(LeafAwsLivenessPackage())';
    const commentLine = '              // add(MyReactNativePackage())';
    const packagesApplyLine = '            PackageList(this).packages.apply {';

    if (content.includes(faceLine)) {
      return content.replace(faceLine, `${faceLine}\n${packageLine}`);
    }
    if (content.includes(awsLine)) {
      return content.replace(awsLine, `${awsLine}\n${packageLine}`);
    }
    if (content.includes(commentLine)) {
      return content.replace(commentLine, `${commentLine}\n${packageLine}`);
    }
    if (content.includes(packagesApplyLine)) {
      return content.replace(packagesApplyLine, `${packagesApplyLine}\n${packageLine}`);
    }

    console.warn('[withLeafRideNotification] Could not find package insertion point in MainApplication.kt');
    return content;
  });
}

function patchAndroidAppBuildGradle(appBuildGradlePath) {
  patchFile(appBuildGradlePath, (content) => {
    if (content.includes('androidx.core:core-ktx')) {
      return content;
    }

    return content.replace(
      /(\s*implementation\("com\.facebook\.react:react-android"\).*)/,
      '$1\n    implementation("androidx.core:core-ktx:1.13.1")'
    );
  });
}

const withLeafRideNotification = (config) => withDangerousMod(config, [
  'android',
  async (config) => {
    const projectRoot = config.modRequest.platformProjectRoot;
    const androidTargetDir = path.join(projectRoot, ANDROID_PACKAGE_PATH);

    copyFile(
      path.join(TEMPLATES_ROOT, 'android', 'LeafRideNotificationModule.kt'),
      path.join(androidTargetDir, 'LeafRideNotificationModule.kt')
    );
    copyFile(
      path.join(TEMPLATES_ROOT, 'android', 'LeafRideNotificationPackage.kt'),
      path.join(androidTargetDir, 'LeafRideNotificationPackage.kt')
    );

    patchAndroidMainApplication(path.join(androidTargetDir, 'MainApplication.kt'));
    patchAndroidAppBuildGradle(path.join(projectRoot, 'app', 'build.gradle'));

    return config;
  },
]);

module.exports = withLeafRideNotification;
