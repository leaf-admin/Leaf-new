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
});
