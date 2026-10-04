const fs = require('fs');
const path = require('path');

const mobileRoot = path.resolve(__dirname, '..');

describe('iOS local widget version contract', () => {
  const readScript = (name) =>
    fs.readFileSync(path.join(mobileRoot, 'scripts', name), 'utf8');

  it('synchronizes the app and widget native manifests before a local build', () => {
    const buildScript = readScript('build-local-ios.sh');

    expect(buildScript).toContain(
      'ios/LeafRideActivityWidget/Info.plist',
    );
    expect(buildScript).toContain(
      'Set :CFBundleShortVersionString ${expected_version}',
    );
    expect(buildScript).toContain(
      'Set :CFBundleVersion ${expected_build_number}',
    );
  });

  it('allows local build products to use a separate derived data volume', () => {
    const buildScript = readScript('build-local-ios.sh');

    expect(buildScript).toContain(
      'IOS_DERIVED_DATA_PATH="${IOS_DERIVED_DATA_PATH:-${PROJECT_DIR}/ios/build}"',
    );
    expect(buildScript).toContain(
      'local built_app_path="${IOS_DERIVED_DATA_PATH}/Build/Products/',
    );
    expect(buildScript).toContain(
      '-derivedDataPath "${IOS_DERIVED_DATA_PATH}"',
    );
    expect(buildScript).toContain(
      'archive_path="${IOS_DERIVED_DATA_PATH}/${scheme}.xcarchive"',
    );
    expect(buildScript).toContain(
      'local smithy_package_dir="${IOS_DERIVED_DATA_PATH}/SourcePackages/checkouts/smithy-swift"',
    );
  });

  it('rejects archives and exported IPAs whose widget version differs', () => {
    const buildScript = readScript('build-local-ios.sh');
    const exportScript = readScript('export-local-ios-ipa.sh');
    const widgetArtifactPath =
      'PlugIns/LeafRideActivityWidget.appex/Info.plist';

    expect(buildScript).toContain(widgetArtifactPath);
    expect(buildScript).toContain(
      'widget_actual_build_number}" != "${expected_build_number}',
    );
    expect(exportScript).toContain(widgetArtifactPath);
    expect(exportScript).toContain(
      'widget_actual_build_number}" != "${expected_build_number}',
    );
  });

  it('enforces the Leaf team before building and after signing app and widget', () => {
    const buildScript = readScript('build-local-ios.sh');
    const exportScript = readScript('export-local-ios-ipa.sh');
    expect(buildScript).toContain('assert_leaf_ios_team "${IOS_DEVELOPMENT_TEAM}"');
    expect(exportScript).toContain('assert_leaf_ios_team "${team_id}"');
    expect(exportScript).toContain('assert_leaf_ios_team "${signed_team}"');
    expect(exportScript).toContain('assert_leaf_ios_team "${profile_team}"');
    expect(exportScript).toContain('codesign --verify --deep --strict "${signed_target}"');
  });
});
