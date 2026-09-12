const fs = require('fs');
const os = require('os');
const path = require('path');
const surfaceManifest = require('../src/navigation/surfaceManifest.json');
const { normalizeManifestDeepLinkPath } = require('../src/navigation/surfaceManifestContract');
const {
  getSupportedScenarios,
  parseDataContainerFromListapps,
  scenarioPatch,
  scenarioRoute,
  seedSocketTokenOnly,
} = require('../scripts/qa/seed-prototype-ios-state.cjs');
const androidSeed = require('../scripts/qa/seed-prototype-android-state.cjs');
const iosMatrixRunner = require('../scripts/qa/run-prototype-ios-state-matrix.cjs');

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

    const driverOfferMatch = source.match(
      /(?:case\s+['"]driver-offer['"]|scenario\s*===\s*['"]driver-offer['"])/,
    );
    const driverOfferIndex = driverOfferMatch?.index ?? -1;
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

  it('opens the real Pix pending surface for the payment fixture', () => {
    expect(scenarioRoute('passenger-payment')).toContain(
      'qaPassengerAction=open_pix_pending',
    );
    expect(androidSeed.scenarioRoute('passenger-payment')).toContain(
      'qaPassengerAction=open_pix_pending',
    );

    const homeSource = read('src/screens/prototype/RobotaxiHomeScreen.js');
    const destinationSource = read('src/screens/prototype/RobotaxiDestinationScreen.js');
    const paymentSource = read('src/components/payment/WooviPaymentModal.js');
    expect(homeSource).toContain("passengerAutomationConfig.action === 'open_pix_pending'");
    expect(homeSource).toContain('mock_review_prebooking-');
    expect(destinationSource).toContain('isRuntimeQaVisualOnlyPaymentBuild');
    expect(destinationSource).toContain('isRuntimeE2ETestBuild() &&');
    expect(destinationSource).toContain('allowTestUserTools()');
    expect(destinationSource).toContain('qaVisualOnlyPayment');
    expect(destinationSource).toContain('prefilledPaymentData');
    expect(paymentSource).toContain('qaVisualOnlyPaymentEnabled');
    expect(paymentSource).toContain('payment-modal-pending-state');
  });

  it('keeps the no-drivers terminal seed idle so recovery actions can return Home', () => {
    expect(scenarioPatch('passenger-no-drivers')).toEqual(
      expect.objectContaining({
        bookingStatus: 'idle',
        activeBookingId: null,
        activeBooking: null,
      }),
    );
    expect(androidSeed.scenarioPatch('passenger-no-drivers')).toEqual(
      expect.objectContaining({
        bookingStatus: 'idle',
        activeBookingId: null,
        activeBooking: null,
      }),
    );
    expect(scenarioRoute('passenger-no-drivers')).toMatch(
      /^leafapp:\/\/robotaxi\/no-drivers\?/,
    );
    expect(androidSeed.scenarioRoute('passenger-no-drivers')).toMatch(
      /^leafapp:\/\/robotaxi\/no-drivers\?/,
    );
  });

  it('prefers the booted named simulator instead of a stale hard-coded device id', () => {
    const iosSeed = read('scripts/qa/seed-prototype-ios-state.cjs');

    expect(iosSeed).toContain("device?.state === 'Booted'");
    expect(iosSeed).toContain("'driver': 'iPhone 17e'");
    expect(iosSeed).toContain('resolveSimulatorDeviceId(deviceKey, rawDeviceArg)');
  });

  it('accepts the deep-link prompt without relaunching the seeded app', () => {
    const iosSeed = read('scripts/qa/seed-prototype-ios-state.cjs');

    expect(iosSeed).toContain("'_accept-open-prompt-no-launch.yaml'");
    expect(iosSeed).not.toContain("'_accept-open-prompt.yaml'");
    expect(read('.maestro/flows/qa/_accept-open-prompt-no-launch.yaml')).not.toContain(
      '- launchApp:',
    );
  });

  it('boots the app before asserting terminal transition outcomes', () => {
    [
      'passenger-no-drivers-retry-to-home-ios.yaml',
      'passenger-cancelled-return-to-home-ios.yaml',
      'passenger-payment-failed-retry-to-home-ios.yaml',
      'passenger-accepted-cancel-dismiss-ios.yaml',
    ].forEach((flowName) => {
      const flow = read(`.maestro/flows/qa/transitions/${flowName}`);
      expect(flow).toContain('- launchApp:');
      expect(flow).toContain('stopApp: false');
    });
  });

  it('keeps reversible transition flows free of destructive or payment actions', () => {
    const paymentRecovery = read(
      '.maestro/flows/qa/transitions/passenger-payment-failed-retry-to-home-ios.yaml',
    );
    const cancellationDismiss = read(
      '.maestro/flows/qa/transitions/passenger-accepted-cancel-dismiss-ios.yaml',
    );

    expect(paymentRecovery).toContain('payment-failed-button-Tentar novamente');
    expect(paymentRecovery).toContain('passenger-home-destination-input');
    expect(paymentRecovery).not.toContain('open_pix');
    expect(paymentRecovery).not.toContain('passenger-cancellation-confirm-button');

    expect(cancellationDismiss).toContain('passenger-trip-accepted-more-options-button');
    expect(cancellationDismiss).toContain('passenger-cancellation-keep-button');
    expect(cancellationDismiss).toContain('passenger-trip-screen');
    expect(cancellationDismiss).not.toContain('passenger-cancellation-confirm-button');
    expect(cancellationDismiss).not.toContain('Cancelar mesmo');
  });

  it('launches the target app before assertions and captures runtime history afterward', () => {
    const matrixRunner = read('scripts/qa/run-prototype-ios-state-matrix.cjs');
    const assertionFlow = read(
      '.maestro/flows/qa/ui-ux-lifecycle-state-assert-ios.yaml',
    );

    expect(assertionFlow).toContain('- launchApp:');
    expect(assertionFlow).toContain('stopApp: false');
    expect(matrixRunner).toContain('captureRuntimeHistoryArtifact');
    expect(matrixRunner).toContain('runtimeHistoryCapturedAfterAssertions: true');
    expect(matrixRunner).toContain('--expect-reduced-motion');
    expect(matrixRunner).toContain('runtime_history_missing_reduced_motion_static_route');
  });

  it('requires a real app boot preflight before any matrix seed or assertion', () => {
    const matrixRunner = read('scripts/qa/run-prototype-ios-state-matrix.cjs');
    const readyFlow = read('.maestro/flows/qa/boot-app-ready-ios.yaml');
    const bundleUrl = iosMatrixRunner.buildIosBundleUrl('http://127.0.0.1:8096');

    expect(bundleUrl).toBe(
      'http://127.0.0.1:8096/mobile-app/index.bundle?platform=ios&dev=true&minify=false',
    );
    expect(iosMatrixRunner.buildDevClientDeepLink(bundleUrl)).toBe(
      'exp+leafapp-reactnative://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8096%2Fmobile-app%2Findex.bundle%3Fplatform%3Dios%26dev%3Dtrue%26minify%3Dfalse&disableOnboarding=1',
    );
    expect(matrixRunner).toContain('preflightRequiresAllSelectedSimulatorsBooted: true');
    expect(matrixRunner).toContain('bilateralRunRequiresPassengerAndDriverDevices: true');
    expect(matrixRunner).toContain('sequentialSingleDeviceRunsAllowed: true');
    expect(matrixRunner).toContain('preflightRequiresAppInstalledAndReady: true');
    expect(matrixRunner).toContain('preflightRequiresAppReactivationBeforeEachScenario: true');
    expect(matrixRunner).toContain('scenarioRequiresPostSeedAppReadyBeforeRoute: true');
    expect(matrixRunner).toContain('scenarioRouteOpenedOnlyAfterReadiness: true');
    expect(matrixRunner).toContain('scenarioScreenshotCapturedAfterRoute: true');
    expect(matrixRunner).toContain('scenarioIsNotRunWhenPreflightFails: true');
    expect(matrixRunner).toContain('scenarioIsNotRunWhenPerScenarioAppLaunchFails: true');
    expect(matrixRunner).toContain('scenarioIsNotRunWhenPostSeedAppReadyFails: true');
    expect(matrixRunner).toContain("status: 'NOT_RUN'");
    expect(matrixRunner).toContain('seedExitCode: null');
    expect(readyFlow).not.toContain('- launchApp:');
    expect(readyFlow).toContain('READY_SCREEN_ID');
    expect(matrixRunner).toContain('payment-modal-content');
    expect(matrixRunner).toContain("'--skip-launch'");
    expect(matrixRunner).toContain("'--skip-route'");
    expect(matrixRunner).toContain("'--dev-client-url'");
    expect(matrixRunner).toContain('const appLaunch = launchInstalledApp(deviceId);');
    expect(matrixRunner).toContain('runScenarioAppReadyAssertion');
    expect(matrixRunner).toContain('const maxAttempts = 2');
    expect(matrixRunner).toContain('app_ready_recovery_launch_failed');
    expect(matrixRunner).toContain('app_ready_recovery_open_failed');
    expect(matrixRunner).toContain('APP_READY_RECOVERY_SETTLE_MS');
    expect(matrixRunner).toContain('sleep(APP_READY_RECOVERY_SETTLE_MS)');
    expect(matrixRunner).toContain('found nothing to terminate');
    expect(matrixRunner).toContain("runSimctl(['openurl', deviceId, route], 30000)");
    expect(matrixRunner).toContain('captureScenarioScreenshot');
    expect(matrixRunner).toContain("killSignal: 'SIGKILL'");
    expect(matrixRunner).toContain('os.setsid()');
    expect(matrixRunner).toContain('kill -TERM "-$child"');
    expect(matrixRunner).toContain('kill -KILL "-$child"');
    expect(matrixRunner).toContain('trap cleanup EXIT');
    expect(matrixRunner).toContain('wait "$child"; status=$?; cleanup; child=; exit "$status"');
    expect(matrixRunner).toContain('verified_booted_after_timeout');
    expect(matrixRunner).not.toContain('accepted_without_error_before_timeout');
    expect(matrixRunner).toContain('command entered exiting state');
    expect(matrixRunner).toContain('transient E (exiting) state');
    expect(matrixRunner).not.toContain(
      'E*|?E*) echo "command entered exiting state" >&2; exit 125',
    );
    expect(matrixRunner).toContain('simctlTimeoutAcceptedOnlyWithSemanticEvidence: true');
    expect(matrixRunner).toContain('filesystem_bundle_registry');
    expect(matrixRunner).toContain("CFBundleIdentifier");
    expect(matrixRunner).toContain('do not attempt openurl, state injection, or Maestro');
    expect(readyFlow).not.toContain('No development servers found');
  });

  it('keeps the canonical QA runners on the same Metro default', () => {
    const doctor = read('scripts/qa/current-flow-e2e-lab.cjs');
    const debugRunner = read('scripts/qa/current-flow-e2e-debug-run.sh');
    const matrixRunner = read('scripts/qa/run-prototype-ios-state-matrix.cjs');
    const dualPreflight = read('scripts/qa/preflight-dual-ios-vps.sh');
    const dualConcurrencyRunner = read('scripts/qa/run-dual-driver-concurrency-ios.sh');
    const dualOpenRunner = read('scripts/qa/open-dual-ios-vps.sh');
    const dualDriverFlow = read('.maestro/flows/qa/e2e/01-driver-login-online-8082.yaml');
    const dualPassengerFlow = read('.maestro/flows/qa/e2e/02-passenger-login-8081.yaml');

    expect(doctor).toContain("const DEFAULT_METRO_URL = 'http://127.0.0.1:8097';");
    expect(debugRunner).toContain('METRO_PORT="${METRO_PORT:-8097}"');
    expect(debugRunner).toContain('install --no-streaming -r');
    expect(debugRunner).toContain('INSTALL_FAILED_UPDATE_INCOMPATIBLE');
    expect(debugRunner).toContain('printf -v remote_command');
    expect(debugRunner).toContain('shell "${remote_command}"');
    expect(matrixRunner).toContain("const DEFAULT_METRO_URL = 'http://127.0.0.1:8097';");
    expect(dualPreflight).toContain('SHARED_METRO_PORT="${SHARED_METRO_PORT:-8097}"');
    expect(dualPreflight).toContain('export MAESTRO_METRO_PORT="${SHARED_METRO_PORT}"');
    expect(dualConcurrencyRunner).toContain('METRO_PORT="${METRO_PORT:-8097}"');
    expect(dualOpenRunner).toContain('SHARED_METRO_PORT="${SHARED_METRO_PORT:-8097}"');
    expect(dualDriverFlow).toContain('${MAESTRO_METRO_PORT}');
    expect(dualPassengerFlow).toContain('${MAESTRO_METRO_PORT}');
  });

  it('keeps standalone QA coordinate fallbacks inside the active Rio pilot', () => {
    const driverBot = read('scripts/qa/driver-bot-passenger-device.cjs');
    const backendDriverBot = read('../leaf-websocket-backend/scripts/tests/driver-dispatch-bot.cjs');
    const simulatedRide = read('scripts/qa-simulate-ride-flow.cjs');
    const manualHelper = read('scripts/manual-e2e-helper.cjs');

    [driverBot, backendDriverBot, simulatedRide, manualHelper].forEach((source) => {
      expect(source).toContain('-22.97104');
      expect(source).toContain('-43.18349');
      expect(source).not.toContain('37.779026');
      expect(source).not.toContain('-122.419906');
      expect(source).not.toContain('-23.55052');
      expect(source).not.toContain('-46.633308');
    });
  });

  it('keeps Jest discovery away from generated artifact trees', () => {
    const jestConfig = read('jest.config.js');

    [
      '<rootDir>/android/',
      '<rootDir>/ios/build/',
      '<rootDir>/QA/',
      '<rootDir>/dist/',
      '<rootDir>/test-results/',
    ].forEach((ignoredPath) => {
      expect(jestConfig).toContain(`"${ignoredPath}"`);
    });
  });

  it('fails the dual-device preflight closed before state reset or scenario commands', () => {
    const preflight = read('scripts/qa/preflight-dual-ios-vps.sh');
    const simulatorBootGate = preflight.indexOf(
      'assert_simulator_booted "${PASSENGER_UDID}" passenger',
    );
    const stateReset = preflight.indexOf('reset_simulator_app_state "${udid}"');
    const appBootGate = preflight.indexOf(
      'assert_app_booted_and_dev_client_open "${PASSENGER_UDID}" passenger',
    );
    const nextCommands = preflight.indexOf('log "preflight passed"');

    expect(preflight).toContain('bootstatus "${udid}" -b');
    expect(preflight).toContain('PROCESS_GROUP_PYTHON');
    expect(preflight).toContain("os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])");
    expect(preflight).toContain('kill -TERM "-${cmd_pid}"');
    expect(preflight).toContain('kill -KILL "-${cmd_pid}"');
    expect(preflight).toContain('wait "${cmd_pid}" >/dev/null 2>&1 || true');
    expect(preflight).toContain('QA_SIM_LOCATION_LAT="${QA_SIM_LOCATION_LAT:--22.97104}"');
    expect(preflight).toContain('QA_SIM_LOCATION_LNG="${QA_SIM_LOCATION_LNG:--43.18349}"');
    expect(preflight).toContain('QA_TEST_DESTINATION_LAT="${QA_TEST_DESTINATION_LAT:--22.98488}"');
    expect(preflight).toContain('QA_TEST_DESTINATION_LNG="${QA_TEST_DESTINATION_LNG:--43.22215}"');
    expect(preflight).toContain("TEST_PICKUP_LAT='${QA_SIM_LOCATION_LAT}'");
    expect(preflight).toContain("TEST_DEST_LAT='${QA_TEST_DESTINATION_LAT}'");
    expect(preflight).not.toContain('TEST_PICKUP_LAT=37.7749');
    expect(preflight).not.toContain('TEST_PICKUP_LNG=-122.4194');
    expect(preflight).toContain('simulator Booted and verified');
    expect(preflight).toContain('app launched and Dev Client deep link accepted');
    expect(preflight).toContain(
      'aborting before app state reset or scenario preparation because a selected simulator is not Booted',
    );
    expect(preflight).toContain(
      'aborting before scenario commands because app boot/Dev Client readiness failed on a selected simulator',
    );
    expect(simulatorBootGate).toBeGreaterThan(-1);
    expect(stateReset).toBeGreaterThan(simulatorBootGate);
    expect(appBootGate).toBeGreaterThan(stateReset);
    expect(nextCommands).toBeGreaterThan(appBootGate);

    expect(preflight).not.toMatch(
      /\$\{SIMCTL_BIN\}" openurl "\$\{(PASSENGER|DRIVER)_UDID\}"[^\n]*\|\| true/,
    );
    expect(preflight).not.toContain('kill "${cmd_pid}"');
    expect(preflight).not.toContain('kill -9 "${cmd_pid}"');
  });

  it('falls back to the installed-app registry when get_app_container is unavailable', () => {
    const listapps = [
      '    "br.com.leaf.ride" =     {',
      '        DataContainer = "file:///Users/izaakdias/Library/Developer/CoreSimulator/Devices/DRIVER/data/Containers/Data/Application/APP-DATA/";',
      '    };',
    ].join('\n');

    expect(parseDataContainerFromListapps(listapps)).toBe(
      '/Users/izaakdias/Library/Developer/CoreSimulator/Devices/DRIVER/data/Containers/Data/Application/APP-DATA/',
    );
    expect(parseDataContainerFromListapps('    "other.app" = {\n    };')).toBe('');
  });

  it('treats an already-stopped app as idempotent without swallowing real terminate errors', () => {
    expect(
      iosMatrixRunner.isAlreadyStoppedTerminationOutput(
        'Simulator device failed to terminate br.com.leaf.ride. found nothing to terminate',
      ),
    ).toBe(true);
    expect(iosMatrixRunner.isAlreadyStoppedTerminationOutput('application is not running')).toBe(
      true,
    );
    expect(
      iosMatrixRunner.isAlreadyStoppedTerminationOutput('permission denied by CoreSimulator'),
    ).toBe(false);
  });

  it('builds a current route and patch for every supported scenario on both platforms', () => {
    const iosScenarios = getSupportedScenarios();
    const androidScenarios = androidSeed.getSupportedScenarios();

    expect(new Set(iosScenarios).size).toBe(iosScenarios.length);
    expect(new Set(androidScenarios).size).toBe(androidScenarios.length);
    expect([...androidScenarios].sort()).toEqual([...iosScenarios].sort());

    [
      { scenarioPatch, scenarioRoute, scenarios: iosScenarios },
      { ...androidSeed, scenarios: androidScenarios },
    ].forEach((seed) => {
      seed.scenarios.forEach((scenario) => {
        expect(() => seed.scenarioPatch(scenario)).not.toThrow();
        expect(seed.scenarioRoute(scenario)).toEqual(
          expect.stringMatching(/^leafapp:\/\/robotaxi\//),
        );
        expect(seed.scenarioRoute(scenario)).not.toMatch(
          /leafapp:\/\/robotaxi\/(booking|payment|trip|driver\/offer|driver\/trip)\?/,
        );
      });
    });
  });

  it('keeps the executable iOS assertion matrix aligned with both seed catalogs', () => {
    const matrixScenarios = [
      ...iosMatrixRunner.PASSENGER_SCENARIOS,
      ...iosMatrixRunner.DRIVER_SCENARIOS,
    ];

    expect(new Set(matrixScenarios).size).toBe(matrixScenarios.length);
    expect([...matrixScenarios].sort()).toEqual(
      [...getSupportedScenarios()].sort(),
    );
    matrixScenarios.forEach((scenario) => {
      const [screenId, primaryId] = iosMatrixRunner.ASSERTIONS[scenario];
      expect(screenId).toEqual(expect.any(String));
      expect(primaryId).toEqual(expect.any(String));
    });
  });

  it('rejects empty or malformed runtime history for map scenarios', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-ios-matrix-history-'));
    const historyPath = path.join(tempDir, 'runtime-debug-history.json');

    try {
      fs.writeFileSync(historyPath, JSON.stringify({ history: [], parseError: null }));
      expect(
        iosMatrixRunner.validateRuntimeHistoryArtifact(historyPath, 'driver-started'),
      ).toEqual(expect.objectContaining({
        ok: false,
        reason: 'runtime_history_missing_steps:map_route_animation',
      }));

      fs.writeFileSync(historyPath, JSON.stringify({
        history: [{ step: 'map_route_animation' }],
        parseError: 'stale parse error',
      }));
      expect(
        iosMatrixRunner.validateRuntimeHistoryArtifact(historyPath, 'driver-started'),
      ).toEqual(expect.objectContaining({
        ok: false,
        reason: 'runtime_history_parse_error:stale parse error',
      }));

      fs.writeFileSync(historyPath, JSON.stringify({ history: [], parseError: null }));
      expect(
        iosMatrixRunner.validateRuntimeHistoryArtifact(historyPath, 'driver-receipt'),
      ).toEqual(expect.objectContaining({
        ok: true,
        entryCount: 0,
        reducedMotionExpectationApplicable: false,
      }));
      expect(
        iosMatrixRunner.validateRuntimeHistoryArtifact(
          historyPath,
          'driver-receipt',
          { expectReducedMotion: true },
        ),
      ).toEqual(expect.objectContaining({
        ok: true,
        reducedMotionExpectationApplicable: false,
      }));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('requires explicit reduced-motion evidence instead of accepting any map event', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-ios-reduced-motion-history-'));
    const historyPath = path.join(tempDir, 'runtime-debug-history.json');

    try {
      fs.writeFileSync(historyPath, JSON.stringify({
        history: [{
          step: 'map_route_animation',
          data: { phase: 'complete', reducedMotion: false },
        }],
        parseError: null,
      }));
      expect(
        iosMatrixRunner.validateRuntimeHistoryArtifact(
          historyPath,
          'driver-started',
          { expectReducedMotion: true },
        ),
      ).toEqual(expect.objectContaining({
        ok: false,
        reason: 'runtime_history_missing_reduced_motion_static_route',
      }));

      fs.writeFileSync(historyPath, JSON.stringify({
        history: [{
          step: 'map_route_animation',
          data: { phase: 'static', reason: 'reduced_motion', reducedMotion: true },
        }],
        parseError: null,
      }));
      expect(
        iosMatrixRunner.validateRuntimeHistoryArtifact(
          historyPath,
          'driver-started',
          { expectReducedMotion: true },
        ),
      ).toEqual(expect.objectContaining({
        ok: true,
        reducedMotionObserved: true,
        reducedMotionStaticEntryCount: 1,
      }));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('keeps driver offline and online-waiting fixtures semantically distinct', () => {
    const iosOffline = scenarioPatch('driver-home');
    const iosOnlineWaiting = scenarioPatch('driver-online-waiting');
    const androidOffline = androidSeed.scenarioPatch('driver-home');
    const androidOnlineWaiting = androidSeed.scenarioPatch('driver-online-waiting');

    [iosOffline, androidOffline].forEach((patch) => {
      expect(patch.activeRole).toBe('driver');
      expect(patch.bookingStatus).toBe('idle');
      expect(patch.driverOnline).toBe(false);
      expect(patch.driverOffers).toEqual([]);
      expect(patch.driverActiveRide).toBeNull();
    });
    [iosOnlineWaiting, androidOnlineWaiting].forEach((patch) => {
      expect(patch.activeRole).toBe('driver');
      expect(patch.bookingStatus).toBe('idle');
      expect(patch.driverOnline).toBe(true);
      expect(patch.driverOnlinePending).toBe(false);
      expect(patch.driverOnlineMutationSource).toBe('qa_seed');
      expect(patch.driverOffers).toEqual([]);
      expect(patch.driverActiveRide).toBeNull();
    });
    expect(scenarioRoute('driver-online-waiting')).toBe('leafapp://robotaxi/home');
    expect(androidSeed.scenarioRoute('driver-online-waiting')).toBe(
      'leafapp://robotaxi/home',
    );
  });
});
