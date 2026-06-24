const fs = require('fs');
const path = require('path');

const appNavigatorSource = fs.readFileSync(
  path.join(__dirname, '../src/navigation/AppNavigator.js'),
  'utf8'
);
const easConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../eas.json'), 'utf8')
);
const releaseRuntimePolicySource = fs.readFileSync(
  path.join(__dirname, '../scripts/qa/validate-release-runtime-policy.cjs'),
  'utf8'
);
const releasePreflightSource = fs.readFileSync(
  path.join(__dirname, '../scripts/release-preflight.sh'),
  'utf8'
);
const fcmNotificationServiceSource = fs.readFileSync(
  path.join(__dirname, '../src/services/FCMNotificationService.js'),
  'utf8'
);

function extractBlockAfterMarker(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error(`Marker ${marker} not found`);
  }

  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bodyStart, index + 1);
      }
    }
  }

  throw new Error(`Block for ${marker} not closed`);
}

function extractFunctionBody(source, functionName) {
  return extractBlockAfterMarker(source, `function ${functionName}`);
}

describe('legacy financial navigation surfaces', () => {
  it('keeps legacy route aliases but does not mount wallet/BaaS screens directly', () => {
    expect(appNavigatorSource).not.toMatch(/import\s+DriverBalanceScreen\s+from/);
    expect(appNavigatorSource).not.toMatch(/import\s+WeeklyPaymentScreen\s+from/);
    expect(appNavigatorSource).not.toMatch(/import\s+AddMoney\s+from/);
    expect(appNavigatorSource).not.toMatch(/import\s+WalletDetails\s+from/);
    expect(appNavigatorSource).not.toMatch(/import\s+FreeTrialScreen\s+from/);
    expect(appNavigatorSource).not.toMatch(/import\s+PlanSelectionScreen\s+from/);

    expect(appNavigatorSource).toContain('name="BaaSAccountScreen"');
    expect(appNavigatorSource).toContain('name="DriverBalance"');
    expect(appNavigatorSource).toContain('name="WalletDetails"');
    expect(appNavigatorSource).toContain('name="addMoney"');
    expect(appNavigatorSource).toContain('component={PilotFeatureUnavailableScreen}');
    expect(appNavigatorSource).toContain('component={driverPayoutEntryComponent}');
  });

  it('keeps legacy driver trip aliases without mounting the client-side acceptTask flow', () => {
    expect(appNavigatorSource).not.toMatch(/import\s+DriverTrips\s+from/);
    expect(appNavigatorSource).toContain('const legacyDriverTripsScreenParams = {');
    expect(appNavigatorSource).toMatch(
      /name="Trips"[\s\S]*?component=\{PilotFeatureUnavailableScreen\}[\s\S]*?initialParams=\{legacyDriverTripsScreenParams\}/,
    );
    expect(appNavigatorSource).toMatch(
      /name="DriverTrips"[\s\S]*?component=\{PilotFeatureUnavailableScreen\}[\s\S]*?initialParams=\{legacyDriverTripsScreenParams\}/,
    );
    expect(appNavigatorSource).not.toMatch(
      /name="(?:Trips|DriverTrips)"[\s\S]{0,120}?component=\{DriverTrips\}/,
    );
  });

  it('keeps the canonical Robotaxi lifecycle active when the cached UI flag cannot load', () => {
    expect(appNavigatorSource).toContain(
      "featureFlagService.getFlag('PROTOTYPE_ROBOTAXI_UI_ENABLED', true)",
    );
    expect(appNavigatorSource).toMatch(
      /Erro ao carregar flag de protótipo:[\s\S]*?setPrototypeUiEnabled\(true\);/,
    );
  });

  it('blocks the legacy map opt-out from release and review builds', () => {
    expect(appNavigatorSource).toContain('EXPO_PUBLIC_FORCE_LEGACY_MAP_UI');
    expect(appNavigatorSource).toContain('const legacyMapOptOutAllowed =');
    expect(appNavigatorSource).toMatch(
      /const legacyMapOptOutAllowed\s*=\s*[\s\S]*?__DEV__[\s\S]*?!isReviewEnv[\s\S]*?!isE2ETestBuild\(\)[\s\S]*?!isSimulatorBuild\(\);/,
    );
    expect(appNavigatorSource).toMatch(
      /const forceLegacyMapUi\s*=\s*[\s\S]*?legacyMapOptOutAllowed\s*&&[\s\S]*?EXPO_PUBLIC_FORCE_LEGACY_MAP_UI/,
    );
    expect(appNavigatorSource).toMatch(
      /const effectivePrototypeUiEnabled\s*=\s*legacyMapOptOutAllowed[\s\S]*?\?\s*prototypeUiEnabled[\s\S]*?:\s*true;/,
    );
    expect(releaseRuntimePolicySource).toContain('EXPO_PUBLIC_FORCE_LEGACY_MAP_UI');
    expect(releasePreflightSource).toContain('EXPO_PUBLIC_FORCE_LEGACY_MAP_UI');

    [
      'release-test',
      'production',
      'production-apk',
      'production-review',
    ].forEach((profileName) => {
      expect(easConfig.build[profileName]?.env).toEqual(
        expect.objectContaining({
          EXPO_PUBLIC_FORCE_LEGACY_MAP_UI: 'false',
        }),
      );
    });
  });

  it('keeps legacy ride and payment screens out of the canonical Robotaxi navigator branch', () => {
    const prototypeBranchSource = [
      extractFunctionBody(appNavigatorSource, 'renderPrototypeCompanionScreens'),
      extractFunctionBody(appNavigatorSource, 'renderSharedPrototypeScreens'),
      extractFunctionBody(appNavigatorSource, 'renderCustomerPrototypeScreens'),
      extractFunctionBody(appNavigatorSource, 'renderDriverPrototypeScreens'),
    ].join('\n');

    [
      'BookedCab',
      'TripTracking',
      'RideDetails',
      'TripDetails',
      'Receipt',
      'ReceiptDetails',
      'Cancellation',
      'CancellationSuccess',
      'Feedback',
      'Complain',
      'PaymentSuccess',
      'PaymentFailed',
      'PaymentSuccessScreen',
      'BookingConfirmation',
      'PixPayment',
      'PaymentDetails',
      'Rides',
      'RideListScreen',
      'TransactionHistory',
      'DriverSearch',
    ].forEach((routeName) => {
      expect(prototypeBranchSource).not.toContain(`name="${routeName}"`);
    });

    expect(appNavigatorSource).toMatch(
      /allowPrototypePrivateScreens\s*\?\s*\([\s\S]*?renderPrototypeCompanionScreens\(activeRole\)[\s\S]*?renderSharedPrototypeScreens\(\)[\s\S]*?renderDriverPrototypeScreens\(\)\s*:\s*renderCustomerPrototypeScreens\(\)[\s\S]*?\)\s*:\s*\(/,
    );
    expect(appNavigatorSource).toMatch(
      /:\s*\([\s\S]*?renderSharedPrivateScreens\(\)[\s\S]*?renderDriverPrivateScreens\(\)\s*:\s*renderCustomerPrivateScreens\(\)[\s\S]*?\)/,
    );
  });

  it('registers active cancellation as a shared prototype route for passenger and driver flows', () => {
    const sharedPrototypeScreens = extractFunctionBody(appNavigatorSource, 'renderSharedPrototypeScreens');
    const customerPrototypeScreens = extractFunctionBody(appNavigatorSource, 'renderCustomerPrototypeScreens');
    const driverPrototypeScreens = extractFunctionBody(appNavigatorSource, 'renderDriverPrototypeScreens');

    expect(sharedPrototypeScreens).toMatch(
      /name="RobotaxiPrototypeCancellation"[\s\S]*?component=\{RobotaxiCancellationScreen\}/,
    );
    expect(customerPrototypeScreens).not.toContain('name="RobotaxiPrototypeCancellation"');
    expect(driverPrototypeScreens).not.toContain('name="RobotaxiPrototypeCancellation"');
  });

  it('keeps deep link and push route entrypoints on canonical Robotaxi routes', () => {
    const appLinkingSource = extractBlockAfterMarker(appNavigatorSource, 'const appLinking');
    const notificationAllowedRoutesSource = extractBlockAfterMarker(
      fcmNotificationServiceSource,
      'const ALLOWED_NOTIFICATION_ROUTES',
    );
    const notificationAliasesSource = extractBlockAfterMarker(
      fcmNotificationServiceSource,
      'const NOTIFICATION_SCREEN_ALIASES',
    );
    const legacyRouteNames = [
      'BookedCab',
      'TripTracking',
      'RideDetails',
      'TripDetails',
      'Receipt',
      'ReceiptDetails',
      'Cancellation',
      'CancellationSuccess',
      'Feedback',
      'Complain',
      'PaymentSuccess',
      'PaymentFailed',
      'PaymentSuccessScreen',
      'BookingConfirmation',
      'PixPayment',
      'PaymentDetails',
      'DriverSearch',
    ];

    legacyRouteNames.forEach((routeName) => {
      expect(appLinkingSource).not.toMatch(new RegExp(`(^|[^A-Za-z0-9_])${routeName}\\s*:`));
      expect(notificationAllowedRoutesSource).not.toMatch(new RegExp(`['"]${routeName}['"]`));
      expect(notificationAliasesSource).not.toMatch(new RegExp(`['"]${routeName}['"]`));
    });

    expect(appLinkingSource).toContain('RobotaxiPrototypeTrip');
    expect(appLinkingSource).toContain('RobotaxiPrototypePaymentSuccess');
    expect(appLinkingSource).toContain('RobotaxiPrototypeReceipt');
    expect(notificationAllowedRoutesSource).toContain('RobotaxiPrototypeTrip');
    expect(notificationAliasesSource).toContain("payment_success: 'RobotaxiPrototypePaymentSuccess'");
    expect(notificationAliasesSource).toContain("receipt: 'RobotaxiPrototypeReceipt'");
  });
});
