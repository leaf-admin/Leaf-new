const fs = require('fs');
const path = require('path');
const vm = require('vm');

const runtimeSource = fs.readFileSync(
  path.resolve(__dirname, '../src/screens/prototype/prototypeRideRuntime.js'),
  'utf8',
);
const driverTripSource = fs.readFileSync(
  path.resolve(__dirname, '../src/screens/prototype/RobotaxiDriverTripScreen.js'),
  'utf8',
);

function extractFunctionSource(functionName) {
  const start = runtimeSource.indexOf(`function ${functionName}`);
  expect(start).toBeGreaterThanOrEqual(0);

  const nextFunction = runtimeSource.indexOf('\nfunction ', start + 1);
  return runtimeSource.slice(start, nextFunction > start ? nextFunction : undefined);
}

describe('driver trip assist contract', () => {
  it('normalizes backend status aliases before deciding driver navigation assistance', () => {
    const source = extractFunctionSource('buildDriverTripAssistModel');

    expect(source).toContain('normalizeRuntimeRideStatus(');
    expect(source).toContain('["accepted", "arrived", "started"].includes(status)');
    expect(source).not.toContain('.toLowerCase()');
  });

  it('keeps standalone driver navigation phase-aware and centralized', () => {
    expect(driverTripSource).toContain(
      'import { openPreferredDriverNavigation } from "../../services/driverNavigationPreference";',
    );
    expect(driverTripSource).toContain(
      'normalizedBookingStatus === "started" ? "destination" : "pickup"',
    );
    expect(driverTripSource).toContain(
      'navigationPhase === "destination" ? dropoffCoordinate : pickupCoordinate',
    );
    expect(driverTripSource).toContain('openPreferredDriverNavigation({');
    expect(driverTripSource).not.toContain('comgooglemaps://?daddr=');
    expect(driverTripSource).not.toContain('waze://?ll=');
  });
});


describe('navigation speed from the raw GPS fix', () => {
  it('passes speed through the actual trip assistant even though geometry normalization drops it', () => {
    const source = extractFunctionSource('buildDriverTripAssistModel');
    const buildNavigation = jest.fn(() => ({}));
    const coordinate = { latitude: -22.97, longitude: -43.18 };
    const ctx = { normalizeRuntimeRideStatus: s => s, resolvePickupCoordinateFromRide: () => coordinate,
      resolveDestinationCoordinateFromRide: () => coordinate, resolveDriverRoutePlan: () => ({}),
      resolveQaLockedNavigationCoordinate: () => coordinate, resolveRouteProgressMetrics: () => ({ remainingMeters: 100, etaMinutes: 2 }),
      clamp: (n,a,b) => Math.max(a,Math.min(b,n)), sanitizeText: (s,f) => s || f,
      calculateDistanceMeters: () => 100, PICKUP_TOLERANCE_METERS: 20,
      formatRuntimeNavigationDistanceLabel: () => '100 m', formatRuntimeEtaLabel: () => '2 min',
      buildLeafNativeNavigationState: buildNavigation };
    vm.createContext(ctx);vm.runInContext(source+';this.build=buildDriverTripAssistModel;',ctx);
    ctx.build({ bookingStatus: 'started', driverCoordinate: { ...coordinate, speed: 20 } });
    expect(buildNavigation.mock.calls[0][0].currentSpeedMetersPerSecond).toBe(20);
    ctx.build({ bookingStatus: 'started', driverCoordinate: coordinate });
    expect(buildNavigation.mock.calls[1][0].currentSpeedMetersPerSecond).toBeUndefined();
  });
});
