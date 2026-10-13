const fs = require('fs');
const path = require('path');

const script = fs.readFileSync(
  path.resolve(__dirname, '../scripts/build-local-android.sh'),
  'utf8',
);

describe('local Android build script', () => {
  it('uses the selected EAS release configuration and canonical Android entry', () => {
    expect(script).toContain('export ENTRY_FILE=index.js');
    expect(script).toContain('export EAS_BUILD_PROFILE="${EAS_BUILD_PROFILE:-production}"');
    expect(script).toContain('load_eas_build_profile_env');
  });
  it('resolves AppConfig from the mobile project regardless of caller cwd', () => {
    expect(script).toContain(
      'expected_version_code="$(cd "${PROJECT_DIR}" && node -e "console.log(require(\'./config/AppConfig\').AppConfig.android_app_version)")"',
    );
    expect(script).toContain(
      'expected_version_name="$(cd "${PROJECT_DIR}" && node -e "console.log(require(\'./config/AppConfig\').AppConfig.ios_app_version)")"',
    );
  });

  it('can move Gradle outputs and project caches to an external volume', () => {
    expect(script).toContain('ANDROID_BUILD_OUTPUT_PATH');
    expect(script).toContain('ANDROID_BUILD_STACKTRACE');
    expect(script).toContain('.leaf-android-build-dir.XXXXXX"');
    expect(script).toContain('--project-cache-dir');
    expect(script).toContain('--init-script');
    expect(script).toContain('ANDROID_DISABLE_PROBLEMS_REPORT');
    expect(script).toContain('--no-problems-report');
    expect(script).toContain('GRADLE_USER_HOME');
    expect(script).toContain('ANDROID_GRADLE_PROJECT_DIR');
    expect(script).toContain('isMainAndroidBuild = gradle.rootProject.projectDir.canonicalFile == mainAndroidProjectDir');
    expect(script).toContain('System.identityHashCode(gradle)');
    expect(script).toContain('included/${includedBuildKey}');
    expect(script).toContain("new File(mainAndroidProjectDir, 'app').canonicalFile");
    expect(script).toContain("? 'app'");
    expect(script).toContain('modules/${projectPath}');
    expect(script).toContain('cmake.buildStagingDirectory = new File(nativeOutputRoot');
    expect(script).not.toContain('project.afterEvaluate');
    expect(script).toContain('prepare_external_worklets_build_link');
    expect(script).toContain('ANDROID_WORKLETS_BUILD_BACKUP');
    expect(script).toContain('ln -s "${ANDROID_WORKLETS_BUILD_BACKUP}" "${ANDROID_WORKLETS_BUILD_DIR}"');
    expect(script).toContain('local preserved_worklets_root="${ANDROID_BUILD_OUTPUT_PATH}/preserved/react-native-worklets/"');
    expect(script).toContain("project.layout.buildDirectory.set");
    expect(script).toContain('cleanup_external_build_script');
  });

  it('labels debug-signed release APKs as local non-publishable QA artifacts', () => {
    expect(script).toContain('ANDROID_LOCAL_QA_SIGNING');
    expect(script).toContain('debug.keystore; artefato de QA não publicável');
    expect(script).toContain('só pode assinar assembleRelease local');
    expect(script).toContain('-Pandroid.packagingOptions.pickFirsts=**/libworklets.so');
  });
});
