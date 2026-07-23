const fs = require('fs');
const path = require('path');
const surfaceManifest = require('../src/navigation/surfaceManifest.json');
const { normalizeManifestDeepLinkPath } = require('../src/navigation/surfaceManifestContract');
const {
  seedSocketTokenOnly,
} = require('../scripts/qa/seed-prototype-ios-state.cjs');

const MOBILE_ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(MOBILE_ROOT, relativePath), 'utf8');
}

describe('prototype QA seeds', () => {
  const seedPaths = [
    'scripts/qa/seed-prototype-ios-state.cjs',
    'scripts/qa/seed-prototype-android-state.cjs',
  ];

  it('renews only the QA socket token in socket-token-only mode', async () => {
    const getDataContainer = jest.fn(() => '/tmp/leaf-data-container');
    const getToken = jest.fn(async () => 'renewed-id-token');
    const saveValue = jest.fn();

    const result = await seedSocketTokenOnly({
      deviceId: 'SIMULATOR-UDID',
      uid: 'driver-test-uid',
      getDataContainer,
      getPersistedUid: jest.fn(() => 'driver-test-uid'),
      getToken,
      saveValue,
    });

    expect(getDataContainer).toHaveBeenCalledTimes(1);
    expect(getDataContainer).toHaveBeenCalledWith('SIMULATOR-UDID');
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(getToken).toHaveBeenCalledWith('driver-test-uid');
    expect(saveValue).toHaveBeenCalledTimes(1);
    expect(saveValue).toHaveBeenCalledWith(
      '/tmp/leaf-data-container',
      '@qa_socket_id_token',
      'renewed-id-token',
    );
    expect(result).toEqual({
      ok: true,
      mode: 'socket-token-only',
      deviceId: 'SIMULATOR-UDID',
      uid: 'driver-test-uid',
      storageKey: '@qa_socket_id_token',
    });
  });

  it('refuses to install a signed token for a different persisted QA identity', async () => {
    const getToken = jest.fn(async () => 'wrong-user-token');
    const saveValue = jest.fn();

    await expect(seedSocketTokenOnly({
      deviceId: 'SIMULATOR-UDID',
      uid: 'passenger-new',
      getDataContainer: jest.fn(() => '/tmp/leaf-data-container'),
      getPersistedUid: jest.fn(() => 'passenger-current'),
      getToken,
      saveValue,
    })).rejects.toThrow('QA_UID_MISMATCH');

    expect(getToken).not.toHaveBeenCalled();
    expect(saveValue).not.toHaveBeenCalled();
  });

  it.each(seedPaths)('does not open stale booking or payment surfaces in %s', (seedPath) => {
    const source = read(seedPath);

    expect(source).not.toContain('leafapp://robotaxi/booking?');
    expect(source).not.toContain('leafapp://robotaxi/payment?');
    expect(source).not.toContain('leafapp://robotaxi/trip?');
    expect(source).toContain("return 'leafapp://robotaxi/home';");

    const driverOfferIndex = source.indexOf("driver-offer");
    expect(driverOfferIndex).toBeGreaterThan(-1);
    expect(source.slice(driverOfferIndex, driverOfferIndex + 1200)).toContain(
      'driverOnline: true',
    );
  });

  it('normalizes every retired lifecycle link to the current home flow', () => {
    const navigator = read('src/navigation/AppNavigator.js');

    [
      'robotaxi/destination',
      'robotaxi/booking',
      'robotaxi/payment',
      'robotaxi/driver/offer',
      'robotaxi/driver/trip',
    ].forEach(retiredPath => {
      expect(surfaceManifest.deepLinks).toContainEqual(
        expect.objectContaining({
          path: retiredPath,
          category: 'compatibility_redirect',
          targetPath: 'robotaxi/home',
          targetRoute: 'RobotaxiPrototype',
        }),
      );
      expect(normalizeManifestDeepLinkPath(retiredPath)).toBe('robotaxi/home');
    });
    expect(navigator).toContain('return normalizeManifestDeepLinkPath(path);');
  });

  it('keeps canonical lifecycle runners on the current passenger Home surface', () => {
    const canonicalFlow = read(
      '.maestro/flows/qa/e2e/lifecycle/02-passenger-request-current-home.yaml',
    );
    const idealLifecycleRunner = read('scripts/run-prototype-ideal-lifecycle-ios.sh');
    const fourDeviceRunner = read('scripts/run-mobile-only-rider-driver-4ios.sh');

    expect(canonicalFlow).toContain('leafapp://robotaxi/home?');
    expect(canonicalFlow).toContain('passenger-home-destination-input');
    expect(canonicalFlow).toContain('passenger-home-category-card');
    expect(canonicalFlow).toContain('passenger-home-category-confirm');
    expect(canonicalFlow).toContain('passenger-destination-category-plus');
    expect(canonicalFlow).not.toContain('leafapp://robotaxi/destination');

    [idealLifecycleRunner, fourDeviceRunner].forEach((runner) => {
      expect(runner).toContain('02-passenger-request-current-home.yaml');
      expect(runner).not.toContain('02-passenger-request-copacabana.yaml');
      expect(runner).not.toContain(
        'leafapp://robotaxi/destination?qaAutomation=1&qaAutoFlow=request',
      );
    });

    [
      '.maestro/flows/qa/e2e/lifecycle/02-passenger-request-home.yaml',
      '.maestro/flows/qa/e2e/lifecycle/02-passenger-request-copacabana.yaml',
      '.maestro/flows/qa/e2e/wave4/00-passenger-quote-ready.yaml',
    ].forEach((legacyFlowPath) => {
      const legacyFlow = read(legacyFlowPath);
      expect(legacyFlow).toContain('LEGACY_COMPAT_ONLY');
      expect(legacyFlow).toContain('leafapp://robotaxi/destination');
    });
  });

  it('keeps cancellation visual evidence on the current cancellation route with explicit financial state', () => {
    const iosSeed = read('scripts/qa/seed-prototype-ios-state.cjs');

    expect(iosSeed).toContain("case 'passenger-cancelled-refund':");
    expect(iosSeed).toContain("return `leafapp://robotaxi/cancellation?");
    expect(iosSeed).toContain("refundStatus: 'ALREADY_REFUNDED'");
    expect(iosSeed).toContain('originalPaidAmount: 13.42');
    expect(iosSeed).toContain('refundAmount: 13.42');
    expect(iosSeed).toContain('cancellationFee: 0');
    expect(iosSeed).toContain("originalPaidAmount: '13.42'");
    expect(iosSeed).toContain("refundAmount: '13.42'");
    expect(iosSeed).toContain("cancellationFee: '0'");
  });

  it('prefers the booted named simulator instead of a stale hard-coded device id', () => {
    const iosSeed = read('scripts/qa/seed-prototype-ios-state.cjs');

    expect(iosSeed).toContain("device?.state === 'Booted'");
    expect(iosSeed).toContain("'driver': 'iPhone 17e'");
    expect(iosSeed).toContain('resolveSimulatorDeviceId(deviceKey, rawDeviceArg)');
  });
});
