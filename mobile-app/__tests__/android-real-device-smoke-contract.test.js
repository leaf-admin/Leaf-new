const fs = require('fs');
const path = require('path');

function readAndroidSmokeRunner() {
  return fs.readFileSync(
    path.resolve(__dirname, '../scripts/qa/android-real-device-smoke.cjs'),
    'utf8',
  );
}

function readRealSmokePreflight() {
  return fs.readFileSync(
    path.resolve(__dirname, '../scripts/qa/prepare-real-smoke-env.sh'),
    'utf8',
  );
}

function readSandboxProfileActivator() {
  return fs.readFileSync(
    path.resolve(__dirname, '../scripts/qa/activate-payment-runtime-sandbox-profile.sh'),
    'utf8',
  );
}

function readAndroidRoleRuntimeVerifier() {
  return fs.readFileSync(
    path.resolve(__dirname, '../scripts/qa/verify-android-role-runtimes.sh'),
    'utf8',
  );
}

function readHostReadinessGate() {
  return fs.readFileSync(
    path.resolve(__dirname, '../scripts/qa/verify-host-readiness.sh'),
    'utf8',
  );
}

function readPaymentRuntimeCanary() {
  return fs.readFileSync(
    path.resolve(__dirname, '../scripts/qa/assert-backend-payment-runtime-canary.sh'),
    'utf8',
  );
}

describe('android real-device smoke runner contract', () => {
  it('uses the canonical no-driver block reason before payment', () => {
    const source = readAndroidSmokeRunner();

    expect(source).toContain('failures.push("blocked_precondition:driver_unavailable")');
    expect(source).not.toContain('blocked_precondition:canonical_app_pickup_no_driver');
  });

  it('blocks unauthenticated or wrong-role launches instead of reporting a false pass', () => {
    const source = readAndroidSmokeRunner();

    expect(source).toContain('blocked_precondition:auth_session_not_ready');
    expect(source).toContain('blocked_precondition:passenger_role_not_ready');
    expect(source).toContain('blocked_precondition:passenger_surface_not_ready:${current.screen}');
    expect(source).toContain('owner: "qa_authentication"');
  });

  it('opens the configured Expo dev client before falling back to the native activity', () => {
    const source = readAndroidSmokeRunner();

    expect(source).toContain('DEV_CLIENT_URL');
    expect(source).toContain('EXDevMenuDisableAutoLaunch');
    expect(source).toContain('android.intent.action.VIEW');
    expect(source).toContain('launchAndroidApp();');
    expect(source).toContain('`${APP_PACKAGE}/.MainActivity`');
  });

  it('does not emit downstream quote, payment, or fare failures after an earlier block', () => {
    const source = readAndroidSmokeRunner();

    expect(source).toContain('const quoteReached = quoteStatus !== "not_reached"');
    expect(source).toContain('const hasBlockedPrecondition = failures.some');
    expect(source).toContain('blocked_precondition:quote_not_reached');
    expect(source).toContain('if (OPEN_PAYMENT && quoteReached && !paymentOpened');
    expect(source).toContain('AUTO_CONFIRM_SANDBOX_PAYMENT &&');
    expect(source).toContain('paymentOpened &&');
    expect(source).toContain('if (quoteReached && !fareConsistency.ok)');
    expect(source).toContain('return "not reached";');
  });

  it('does not label websocket-only gateways as a Socket.IO connectivity failure', () => {
    const source = readAndroidSmokeRunner();

    expect(source).toContain('function formatSocketPollingStatus(poll, realtime)');
    expect(source).toContain('transport unknown');
    expect(source).toContain('websocket-only gateway');
    expect(source).toContain('formatSocketPollingStatus(socketPoll, socketRealtime)');
  });

  it('validates canonical pickup and driver readiness before tapping payment confirmation', () => {
    const source = readAndroidSmokeRunner();
    const firstReadinessIndex = source.indexOf('await prepareCanonicalPickupForPayment(current)');
    const firstPaymentTapIndex = source.indexOf('await tapConfirmUntilPayment(current, steps)');

    expect(firstReadinessIndex).toBeGreaterThan(-1);
    expect(firstPaymentTapIndex).toBeGreaterThan(-1);
    expect(firstReadinessIndex).toBeLessThan(firstPaymentTapIndex);
  });

  it('requires a matched user-scoped sandbox profile before opening the app for payment', () => {
    const source = readAndroidSmokeRunner();
    const runtimeValidationIndex = source.indexOf('paymentRuntimeValidation = validatePaymentRuntimeConfig(paymentRuntimeConfig)');
    const appLaunchIndex = source.indexOf('log("abrindo app em duas passagens para permitir aplicação OTA quando disponível")');

    expect(source).toContain('PAYMENT_RUNTIME_USER_ID = process.env.PAYMENT_RUNTIME_USER_ID || PAYMENT_PASSENGER_UID');
    expect(source).toContain('userId: PAYMENT_RUNTIME_USER_ID');
    expect(source).toContain('passengerId: PAYMENT_RUNTIME_USER_ID');
    expect(source).toContain('scope !== "users"');
    expect(source).toContain('contextMatched !== true');
    expect(source).toContain('payment_runtime_profile_expired');
    expect(source).toContain('blocked_precondition:payment_sandbox_not_confirmed');
    expect(source).not.toContain('/api/app/runtime-config?phone=');
    expect(runtimeValidationIndex).toBeGreaterThan(-1);
    expect(appLaunchIndex).toBeGreaterThan(-1);
    expect(runtimeValidationIndex).toBeLessThan(appLaunchIndex);
  });

  it('blocks payment when the app canonical pickup diverges from the expected device pickup', () => {
    const source = readAndroidSmokeRunner();
    const validationIndex = source.indexOf('validateCanonicalPickupAgainstExpected(pickup)');
    const driverBotIndex = source.indexOf('await startManagedDriverBotAtPickup(pickup)');
    const availabilityIndex = source.indexOf('await checkSocketAvailabilityAtPickup(pickup, carType)');
    const paymentTapIndex = source.indexOf('await tapConfirmUntilPayment(current, steps)');

    expect(source).toContain('TEST_PICKUP_LAT');
    expect(source).toContain('TEST_PICKUP_LNG');
    expect(source).toContain('REAL_SMOKE_EXPECTED_PICKUP_SOURCE_CERTIFIED');
    expect(source).toContain('REAL_SMOKE_CANONICAL_PICKUP_TOLERANCE_M');
    expect(source).toContain('blocked_precondition:app_canonical_pickup_mismatch');
    expect(source).toContain('blocked_precondition:expected_pickup_source_uncertified');
    expect(source).toContain('paymentBlockedByPrecondition');
    expect(source).toContain('distanceMeters');
    expect(source).toContain('sourceCertified');
    expect(validationIndex).toBeGreaterThan(-1);
    expect(driverBotIndex).toBeGreaterThan(-1);
    expect(availabilityIndex).toBeGreaterThan(-1);
    expect(paymentTapIndex).toBeGreaterThan(-1);
    expect(validationIndex).toBeLessThan(driverBotIndex);
    expect(validationIndex).toBeLessThan(availabilityIndex);
    expect(validationIndex).toBeLessThan(paymentTapIndex);
  });

  it('emits a failure classification taxonomy in smoke reports', () => {
    const runner = readAndroidSmokeRunner();
    const reportBuilder = fs.readFileSync(
      path.resolve(__dirname, '../scripts/qa/build-smoke-evidence-report.cjs'),
      'utf8',
    );

    expect(runner).toContain('function classifySmokeFailure');
    expect(runner).toContain('function buildFailureClassification');
    expect(runner).toContain('failureClassification');
    expect(runner).toContain('product');
    expect(runner).toContain('business_rule');
    expect(runner).toContain('test_harness');
    expect(runner).toContain('execution_environment');
    expect(runner).toContain('Final status');
    expect(runner).toContain('Failure Classification');
    expect(reportBuilder).toContain('failureClassificationItems');
    expect(reportBuilder).toContain('Final status');
    expect(reportBuilder).toContain('Failure Classification');
  });

  it('captures Pix modal failure diagnostics for payment runtime triage', () => {
    const runner = readAndroidSmokeRunner();
    const modal = fs.readFileSync(
      path.resolve(__dirname, '../src/components/payment/WooviPaymentModal.js'),
      'utf8',
    );

    expect(modal).toContain('payment-modal-error-diagnostics');
    expect(modal).toContain('payment-error:');
    expect(modal).toContain('providerMessage');
    expect(runner).toContain('function extractPaymentErrorDiagnostics');
    expect(runner).toContain('paymentErrorDiagnostics');
    expect(runner).toContain('Payment error diagnostics');
    expect(runner).toContain('payment_profile_credentials_missing');
    expect(runner).toContain('payment_runtime_config');
  });

  it('recognizes the post-payment preference sheet before active trip background content', () => {
    const source = readAndroidSmokeRunner();
    const detectScreenSource = source.slice(
      source.indexOf('function detectScreen'),
      source.indexOf('function detectPaymentStatus'),
    );
    const preferenceIndex = detectScreenSource.indexOf('passenger-preference-countdown-modal');
    const activeTripIndex = detectScreenSource.indexOf('passenger-trip-screen');

    expect(preferenceIndex).toBeGreaterThan(-1);
    expect(activeTripIndex).toBeGreaterThan(-1);
    expect(preferenceIndex).toBeLessThan(activeTripIndex);
    expect(source).toContain('confirmed_via_ride_flow');
  });

  it('recognizes the quote card before the reused home destination input id', () => {
    const source = readAndroidSmokeRunner();
    const detectScreenSource = source.slice(
      source.indexOf('function detectScreen'),
      source.indexOf('function detectPaymentStatus'),
    );
    const quoteCardIndex = detectScreenSource.indexOf('passenger-home-category-card');
    const homeInputIndex = detectScreenSource.indexOf('passenger-home-destination-input');

    expect(quoteCardIndex).toBeGreaterThan(-1);
    expect(homeInputIndex).toBeGreaterThan(-1);
    expect(quoteCardIndex).toBeLessThan(homeInputIndex);
    expect(source).toContain('return "passenger_quote"');
  });

  it('does not tap a destination result again when Enter already opened the quote', () => {
    const source = readAndroidSmokeRunner();
    const quoteGuardIndex = source.indexOf('const quoteAlreadyVisible =');
    const firstResultIndex = source.indexOf('const firstResult = quoteAlreadyVisible');
    const conditionalTapIndex = source.indexOf('if (quoteAlreadyVisible || tapNode(firstResult');

    expect(quoteGuardIndex).toBeGreaterThan(-1);
    expect(firstResultIndex).toBeGreaterThan(quoteGuardIndex);
    expect(conditionalTapIndex).toBeGreaterThan(firstResultIndex);
    expect(source).toContain('if (!quoteAlreadyVisible)');
  });

  it('falls back to the live logcat stream for invisible app pickup evidence', () => {
    const source = readAndroidSmokeRunner();

    expect(source).toContain('let activeLogcatPath = null');
    expect(source).toContain('activeLogcatPath = logcatPath');
    expect(source).toContain('tailTextFile(activeLogcatPath, 400000)');
    expect(source).toContain('uiautomator_logcat_stream');
  });

  it('resolves sandbox confirmation against the current ride instead of a stale payment intent', () => {
    const source = readAndroidSmokeRunner();

    expect(source).toContain("const crypto = require(\"crypto\")");
    expect(source).toContain('function deriveAdvancePaymentIntentId(rideId)');
    expect(source).toContain('function resolveCurrentRunPaymentIntentId()');
    expect(source).toContain('payment_intent_current_run_mismatch');
    expect(source).toContain("payment-intent-resolution.json");
    expect(source).toContain('PAYMENT_INTENT_ID: paymentIntentResolution.paymentIntentId');
  });

  it('waits through a transient payment surface before declaring the Pix modal absent', () => {
    const source = readAndroidSmokeRunner();

    expect(source).toContain('07-payment-transition-');
    expect(source).toContain('looksLikePixModalEvidence(current)');
    expect(source).toContain("currentScreen === 'blank'");
    expect(source).toContain("currentScreen === 'payment_loading'");
  });

  it('includes managed driver gross fare in smoke fare consistency evidence', () => {
    const source = readAndroidSmokeRunner();

    expect(source).toContain('extractManagedDriverFareEvidence');
    expect(source).toContain('driver_offer_gross');
    expect(source).toContain('driver_completion_gross');
    expect(source).toContain('Driver net evidence');
    expect(source).toContain('Driver fee evidence');
  });

  it('requires distinct Android device and emulator roles before the L2 smoke', () => {
    const source = readRealSmokePreflight();

    expect(source).toContain('REQUIRE_ANDROID_ROLE_PAIR="${REQUIRE_ANDROID_ROLE_PAIR:-true}"');
    expect(source).toContain('PASSENGER_RUNTIME="${PASSENGER_RUNTIME:-android_device}"');
    expect(source).toContain('DRIVER_RUNTIME="${DRIVER_RUNTIME:-android_emulator}"');
    expect(source).toContain('blocked_precondition:android_role_pair_not_ready');
    expect(source).toContain('passenger and driver runtime must be distinct');
    expect(source).toContain('connected Android device serial is not resolved');
    expect(source).toContain('connected Android device serial must not be an emulator');
    expect(source).toContain('required AVD not found');
    expect(source).toContain('$1 !~ /^emulator-/ && $2 == "device"');
    expect(source).toContain('verify_android_package_on_serial "${DEVICE_SERIAL:-}" "device"');
    expect(source).toContain('verify_android_package_on_serial "${emulator_serial}" "emulator"');
  });

  it('checks geofence coverage before validating the payment sandbox runtime', () => {
    const source = readRealSmokePreflight();
    const geofenceLogIndex = source.indexOf('log "Validating geofence pickup/destination"');
    const geofenceApiIndex = source.indexOf('/api/geofence/check?lat=${PICKUP_LAT}&lng=${PICKUP_LNG}');
    const paymentLogIndex = source.indexOf('log "Validating payment runtime sandbox profile"');
    const paymentCanaryIndex = source.indexOf('assert-backend-payment-runtime-canary.sh');

    expect(geofenceLogIndex).toBeGreaterThan(-1);
    expect(geofenceApiIndex).toBeGreaterThan(-1);
    expect(paymentLogIndex).toBeGreaterThan(-1);
    expect(paymentCanaryIndex).toBeGreaterThan(-1);
    expect(geofenceLogIndex).toBeLessThan(paymentLogIndex);
    expect(geofenceApiIndex).toBeLessThan(paymentCanaryIndex);
  });

  it('uses the certified in-region coordinates when device location is unavailable', () => {
    const source = readRealSmokePreflight();

    expect(source).toContain('PICKUP_LAT="${PICKUP_LAT:--22.97104}"');
    expect(source).toContain('PICKUP_LNG="${PICKUP_LNG:--43.18349}"');
    expect(source).toContain('DESTINATION_LAT="${DESTINATION_LAT:--22.98488}"');
    expect(source).toContain('DESTINATION_LNG="${DESTINATION_LNG:--43.22215}"');
    expect(source).not.toContain('PICKUP_LAT="${PICKUP_LAT:--22.999357}"');
    expect(source).not.toContain('PICKUP_LNG="${PICKUP_LNG:--43.357071}"');
  });

  it('persists the Android role assignment into generated smoke env evidence', () => {
    const source = readRealSmokePreflight();

    expect(source).toContain('android-role-pair.json');
    expect(source).toContain('androidPassengerSerial');
    expect(source).toContain('androidDriverSerial');
    expect(source).toContain('androidEmulatorStabilitySeconds');
    expect(source).toContain('export PASSENGER_RUNTIME="${PASSENGER_RUNTIME}"');
    expect(source).toContain('export DRIVER_RUNTIME="${DRIVER_RUNTIME}"');
    expect(source).toContain('export PASSENGER_AVD="${PASSENGER_AVD}"');
    expect(source).toContain('export DRIVER_AVD="${DRIVER_AVD}"');
    expect(source).toContain('export ANDROID_EMULATOR_STABILITY_SECONDS="${ANDROID_EMULATOR_STABILITY_SECONDS}"');
    expect(source).toContain('export ANDROID_PASSENGER_SERIAL="${ANDROID_PASSENGER_SERIAL}"');
    expect(source).toContain('export ANDROID_DRIVER_SERIAL="${ANDROID_DRIVER_SERIAL}"');
  });

  it('blocks smoke when Android location providers diverge before certifying pickup', () => {
    const source = readRealSmokePreflight();

    expect(source).toContain('REQUIRE_ANDROID_LOCATION_PROVIDER_CONVERGENCE="${REQUIRE_ANDROID_LOCATION_PROVIDER_CONVERGENCE:-true}"');
    expect(source).toContain('ANDROID_LOCATION_PROVIDER_TOLERANCE_M="${ANDROID_LOCATION_PROVIDER_TOLERANCE_M:-300}"');
    expect(source).toContain('android-location-providers.json');
    expect(source).toContain('android_location_provider_divergence');
    expect(source).toContain("const providerPreference = ['gps', 'network', 'fused'];");
    expect(source).toContain('export REAL_SMOKE_EXPECTED_PICKUP_SOURCE_CERTIFIED="true"');
  });

  it('generates a driver-emulator bootstrap and runtime verifier before smoke execution', () => {
    const preflight = readRealSmokePreflight();
    const verifier = readAndroidRoleRuntimeVerifier();
    const verifierIndex = preflight.indexOf('verify-android-role-runtimes.sh');
    const smokeRunnerIndex = preflight.indexOf('npm --prefix mobile-app run qa:android:real-smoke');

    expect(preflight).toContain('start-driver-emulator.sh');
    expect(preflight).toContain('bash mobile-app/scripts/qa/verify-android-role-runtimes.sh');
    expect(preflight).toContain('source "$(printf');
    expect(preflight).toContain('START_DRIVER_EMULATOR="\\${START_DRIVER_EMULATOR:-true}"');
    expect(preflight).toContain('android-role-runtime.env');
    expect(preflight).toContain('resolve_matching_driver_apk');
    expect(preflight).toContain('driver-apk-candidates.tsv');
    expect(preflight).toContain('app/build/outputs/apk/debug/app-debug.apk');
    expect(preflight).toContain('export ANDROID_DRIVER_APK="${ANDROID_DRIVER_APK}"');
    expect(preflight).toContain('export FORCE_INSTALL_DRIVER_APK="\\${FORCE_INSTALL_DRIVER_APK:-${FORCE_INSTALL_DRIVER_APK_DEFAULT}}"');
    expect(preflight).toContain('This is not');
    expect(preflight).toContain('accepted as driver-app evidence for full L2 app-to-app validation');
    expect(verifier).toContain('START_DRIVER_EMULATOR="${START_DRIVER_EMULATOR:-false}"');
    expect(verifier).toContain('REQUIRE_RUNNING_ANDROID_EMULATOR="${REQUIRE_RUNNING_ANDROID_EMULATOR:-true}"');
    expect(verifier).toContain('REQUIRE_MATCHING_ANDROID_APP_VERSION="${REQUIRE_MATCHING_ANDROID_APP_VERSION:-true}"');
    expect(verifier).toContain('EMULATOR_STABILITY_SECONDS="${ANDROID_EMULATOR_STABILITY_SECONDS:-60}"');
    expect(verifier).toContain('verify_emulator_stability()');
    expect(verifier).toContain('adb-devices-after-emulator-drop.txt');
    expect(verifier).toContain('Android emulator did not remain connected');
    expect(verifier).toContain('"emulatorStabilitySeconds": "${EMULATOR_STABILITY_SECONDS}"');
    expect(verifier).toContain('ANDROID_EMULATOR_STABILITY_SECONDS=%s');
    expect(verifier).toContain('FORCE_INSTALL_DRIVER_APK="${FORCE_INSTALL_DRIVER_APK:-false}"');
    expect(preflight).toContain('REQUIRE_RUNNING_ANDROID_APP="${REQUIRE_RUNNING_ANDROID_APP:-true}"');
    expect(preflight).toContain('REAL_SMOKE_DRIVER_SURFACE_MODE="${REAL_SMOKE_DRIVER_SURFACE_MODE:-app}"');
    expect(preflight).toContain('REAL_SMOKE_SYNC_DRIVER_TO_APP_PICKUP="\\${REAL_SMOKE_SYNC_DRIVER_TO_APP_PICKUP:-false}"');
    expect(verifier).toContain('REQUIRE_RUNNING_ANDROID_APP="${REQUIRE_RUNNING_ANDROID_APP:-true}"');
    expect(verifier).toContain('verify_app_boot_on_serial()');
    expect(verifier).toContain('blocked_precondition:android_role_app_not_booted');
    expect(verifier).toContain('blocked_precondition:android_role_session_not_ready');
    expect(verifier).toContain('passengerAppBooted');
    expect(verifier).toContain('driverAppBooted');
    expect(verifier).toContain('android-role-runtime-verification.json');
    expect(verifier).toContain('android-role-runtime.env');
    expect(verifier).toContain('passenger and driver serials must both be resolved before L2 smoke');
    expect(verifier).toContain('passenger and driver must not share the same Android runtime');
    expect(verifier).toContain('passenger/driver app versions differ');
    expect(verifier).toContain('$1 !~ /^emulator-/ && $2 == "device"');
    expect(verifier).toContain('ANDROID_DRIVER_APK');
    expect(verifierIndex).toBeGreaterThan(-1);
    expect(smokeRunnerIndex).toBeGreaterThan(-1);
    expect(verifierIndex).toBeLessThan(smokeRunnerIndex);
  });

  it('keeps app-to-app mode single-session and uses runtime evidence for the Pix modal', () => {
    const runner = readAndroidSmokeRunner();

    expect(runner).toContain('const DRIVER_SURFACE_MODE = process.env.REAL_SMOKE_DRIVER_SURFACE_MODE || "app"');
    expect(runner).toContain('driver_surface_mode_conflict');
    expect(runner).toContain('function looksLikePixModalText(current)');
    expect(runner).toContain('function looksLikePixModalEvidence(current)');
    expect(runner).toContain('current?.accessibilityStreamLog');
    expect(runner).toContain('looksLikePixModalEvidence(current)');
  });

  it('keeps sandbox payment runtime activation dry-run and explicit-approval gated', () => {
    const source = readSandboxProfileActivator();

    expect(source).toContain('DRY_RUN="${DRY_RUN:-true}"');
    expect(source).toContain('CONFIRM_PAYMENT_RUNTIME_MUTATION="${CONFIRM_PAYMENT_RUNTIME_MUTATION:-false}"');
    expect(source).toContain('write_activation_summary()');
    expect(source).toContain("trap 'write_activation_summary");
    expect(source).toContain('payment-runtime-sandbox-summary.json');
    expect(source).toContain('PAYMENT_RUNTIME_PROFILE_TTL_HOURS');
    expect(source).toContain('ttlHours <= 0 || ttlHours > 24');
    expect(source).toContain('/api/payment/runtime-profiles');
    expect(source).toContain('environment: "sandbox"');
    expect(source).toContain('scope: "canary"');
    expect(source).toContain('blocked_precondition:payment_runtime_mutation_not_confirmed');
    expect(source).toContain('ACTIVATION_STEP="require_confirmation"');
    expect(source).toContain('blocked_precondition:dashboard_auth_missing');
    expect(source).toContain('mutationExecuted');
    expect(source).toContain('verificationExecuted');
    expect(source).toContain('assert-backend-payment-runtime-canary.sh');
  });

  it('points failed payment runtime preflight to the dry-run sandbox activator', () => {
    const source = readPaymentRuntimeCanary();

    expect(source).toContain('activate-payment-runtime-sandbox-profile.sh');
    expect(source).toContain('DRY_RUN=true');
  });

  it('keeps legacy E2E canary runners user-scoped', () => {
    const vps = fs.readFileSync(
      path.resolve(__dirname, '../scripts/run-e2e-vps.sh'),
      'utf8',
    );
    const stable = fs.readFileSync(
      path.resolve(__dirname, '../scripts/run-e2e-stable-guarded.sh'),
      'utf8',
    );
    const canary = readPaymentRuntimeCanary();

    for (const source of [vps, stable]) {
      expect(source).toContain('PAYMENT_RUNTIME_USER_ID=');
      expect(source).toContain('PAYMENT_RUNTIME_USER_ID="$PAYMENT_RUNTIME_USER_ID"');
      expect(source).toContain('FIREBASE_TEST_PHONE="$FIREBASE_TEST_PHONE"');
    }
    expect(vps).toContain('source "$MOBILE_DIR/scripts/source-local-build-env.sh"');
    expect(readRealSmokePreflight()).toContain('export PAYMENT_RUNTIME_USER_ID="${PASSENGER_UID}"');
    expect(canary).toContain('PAYMENT_RUNTIME_USER_ID is required for a user-scoped sandbox canary');
    expect(canary).toContain('phone-only query resolves the global default');
    expect(canary).toContain('Payment runtime profile did not match the supplied user context');
    expect(canary).toContain('profile_scope="$(jq -r');
  });

  it('writes a machine-readable preflight summary when a precondition blocks smoke', () => {
    const source = readRealSmokePreflight();

    expect(source).toContain('write_preflight_summary()');
    expect(source).toContain("trap 'write_preflight_summary");
    expect(source).toContain('preflight-summary.json');
    expect(source).toContain('PREFLIGHT_STEP="payment_runtime_sandbox"');
    expect(source).toContain('classify_payment_runtime_canary_failure()');
    expect(source).toContain('blocked_precondition:payment_sandbox_not_confirmed');
    expect(source).toContain('payment_runtime_config_unreachable');
    expect(source).toContain('payment_runtime_config_invalid_response');
    expect(source).toContain('payment_runtime_canary_failed');
    expect(source).toContain('generatedFiles');
    expect(source).toContain('paymentRuntimeCanary');
  });

  it('requires a host readiness pass before any Android smoke side effect', () => {
    const preflight = readRealSmokePreflight();
    const hostGate = readHostReadinessGate();
    const hostGateIndex = preflight.indexOf('verify-host-readiness.sh');
    const deviceValidationIndex = preflight.indexOf('PREFLIGHT_STEP="android_device"');

    expect(preflight).toContain('PREFLIGHT_STEP="host_readiness"');
    expect(preflight).toContain('QA_PLATFORM=android');
    expect(preflight).toContain('QA_HOST_READINESS_OUTPUT_DIR="${HOST_READINESS_DIR}"');
    expect(preflight).toContain('no Android device, app, seed, deep link, quote, payment, or ride was started');
    expect(preflight).toContain('host-readiness/host-readiness.json');
    expect(hostGate).toContain('scenarioStarted: false');
    expect(hostGate).toContain('java_major >= 17');
    expect(hostGate).toContain('MIN_FREE_GB="${QA_MIN_FREE_GB:-15}"');
    expect(hostGate).toContain('REQUIRE_METRO_READY');
    expect(hostGate).toContain('adb:daemon');
    expect(hostGateIndex).toBeGreaterThan(-1);
    expect(deviceValidationIndex).toBeGreaterThan(-1);
    expect(hostGateIndex).toBeLessThan(deviceValidationIndex);
  });
});
