const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../src/screens/prototype/RobotaxiTripScreen'), 'utf8');
const helpers = source.slice(source.indexOf('function toPositiveNumber('), source.indexOf('function normalizeRouteCoordinateList('));
const start = source.indexOf('  const liveDistanceKm =');
const block = source.slice(start, source.indexOf('  const resolvedFare =', start));
function resolve(distance, minutes, text = '') {
  return vm.runInNewContext(`${helpers}\n${block}\n({ distance: resolvedTripDistanceKm, minutes: resolvedTripDurationMin, arrival: resolvedTripArrivalText });`, {
    route: { params: { tripDistanceKm: 16, tripDurationMin: 28, tripArrivalText: 'initial' } },
    tripDistanceKm: distance, tripDurationMin: minutes, tripArrivalText: text,
  });
}
describe('passenger card live metrics', () => {
  it('shows current distance/ETA instead of the initial navigation params', () => {
    expect(resolve(4, 7, 'live')).toEqual({ distance: 4, minutes: 7, arrival: 'live' });
  });
  it('keeps arrival zero instead of jumping back to the initial estimate', () => {
    expect(resolve(0, 0, 'arrived')).toEqual({ distance: 0, minutes: 0, arrival: 'arrived' });
  });
  it.each([undefined, null, '', NaN, -1])('uses the initial estimate only when the runtime metric is unavailable: %s', value => {
    expect(resolve(value, value)).toEqual({ distance: 16, minutes: 28, arrival: 'initial' });
  });
});


describe('passenger ETA baseline after resume', () => {
  const runtime = fs.readFileSync(require.resolve('../src/screens/prototype/prototypeRideRuntime'), 'utf8');
  const start = runtime.indexOf('  const canonicalTripDistanceKm =', runtime.indexOf('function buildLiveTripProgressModel'));
  const block = runtime.slice(start, runtime.indexOf('  const routeProgress =', start));
  function baseline(phase) {
    return vm.runInNewContext(`${block}\n({ meters: baselineMeters, minutes: baselineEtaMinutes });`, {
      navigationPhase: phase, activeBooking: { routeDistanceKm: 16, routeDurationSecs: 1680 }, activeRide: {},
      activeRouteDistanceKm: null, activeRouteDurationMinutes: null,
      snapshot: { driverTripMeta: { initialMeters: 10, initialEtaMinutes: 1 }, tripDistanceKm: 0.4, tripDurationMin: 9 },
      toPositiveRuntimeNumber: value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null,
      resolveRouteDurationMinutesFromSource: source => source.routeDurationSecs ? source.routeDurationSecs / 60 : null,
    });
  }
  it('uses the canonical trip estimate instead of pickup or shrinking live metrics', () => {
    expect(baseline('destination')).toEqual({ meters: 16000, minutes: 28 });
  });
  it('keeps pickup-leg metadata for the approach phase', () => {
    expect(baseline('pickup')).toEqual({ meters: 10, minutes: 1 });
  });
});
