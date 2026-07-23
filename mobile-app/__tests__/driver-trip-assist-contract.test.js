const fs = require('fs');
const path = require('path');

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
      'import { openDriverExternalNavigation } from "../../services/DriverExternalNavigationService";',
    );
    expect(driverTripSource).toContain(
      'normalizedBookingStatus === "started" ? "destination" : "pickup"',
    );
    expect(driverTripSource).toContain(
      'navigationPhase === "destination" ? dropoffCoordinate : pickupCoordinate',
    );
    expect(driverTripSource).toContain('openDriverExternalNavigation({');
    expect(driverTripSource).not.toContain('comgooglemaps://?daddr=');
    expect(driverTripSource).not.toContain('waze://?ll=');
  });
});
