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

  it('validates canonical pickup and driver readiness before tapping payment confirmation', () => {
    const source = readAndroidSmokeRunner();
    const firstReadinessIndex = source.indexOf('await prepareCanonicalPickupForPayment(current)');
    const firstPaymentTapIndex = source.indexOf('await tapConfirmUntilPayment(current, steps)');

    expect(firstReadinessIndex).toBeGreaterThan(-1);
    expect(firstPaymentTapIndex).toBeGreaterThan(-1);
    expect(firstReadinessIndex).toBeLessThan(firstPaymentTapIndex);
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
});
