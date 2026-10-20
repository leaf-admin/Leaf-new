import {
  resolveLivePickupLeg,
  routeAheadStartIndex,
  routeLengthMeters,
  trafficFromIndex,
} from '../src/screens/prototype/passengerRouteAhead';

const route = [
  { latitude: -22.9265, longitude: -43.4085 },
  { latitude: -22.9250, longitude: -43.4080 },
  { latitude: -22.9235, longitude: -43.4075 },
  { latitude: -22.9220, longitude: -43.4068 },
  { latitude: -22.9208, longitude: -43.40607 },
];
const pickup = route[route.length - 1];

describe('passenger map follows the driver to the pickup', () => {
  it('keeps the whole route when the driver is off it', () => {
    expect(routeAheadStartIndex(route, { latitude: -22.95, longitude: -43.45 })).toBe(0);
  });

  it('shrinks distance and ETA as the driver gets closer, keeping the booked pace', () => {
    const start = resolveLivePickupLeg({
      driverCoordinate: route[0],
      pickupCoordinate: pickup,
      routeCoordinates: route,
      bookedDistanceKm: 0.68,
      bookedEtaMinutes: 2,
    });
    const atDoor = resolveLivePickupLeg({
      driverCoordinate: pickup,
      pickupCoordinate: pickup,
      routeCoordinates: route,
      bookedDistanceKm: 0.68,
      bookedEtaMinutes: 2,
    });
    expect(start.distanceKm).toBeGreaterThan(0.6);
    expect(start.etaMinutes).toBe(2);
    expect(atDoor.distanceKm).toBeLessThan(0.02);
    expect(atDoor.etaMinutes).toBe(1);
    expect(resolveLivePickupLeg({ driverCoordinate: null, pickupCoordinate: pickup })).toBeNull();
  });

  it('moves the route start in steps, so the polyline does not change on every fix', () => {
    const long = Array.from({ length: 40 }, (_, index) => ({ latitude: -22.9265 + index * 0.00015, longitude: -43.4085 }));
    expect(routeAheadStartIndex(long, long[7])).toBe(5);
    expect(routeAheadStartIndex(long, long[9])).toBe(5);
    expect(routeAheadStartIndex(long, long[10])).toBe(10);
    // The last steps go point by point, so the line vanishes at the arrival.
    expect(routeAheadStartIndex(long, long[37])).toBe(37);
    expect(routeAheadStartIndex(long, { latitude: -22.95, longitude: -43.45 })).toBe(0);
    const segments = [{ coordinates: [long[0], long[4]] }, { coordinates: [long[10], long[20]] }];
    expect(trafficFromIndex(segments, long, 5)).toEqual([segments[1]]);
    expect(trafficFromIndex(segments, long, 0)).toBe(segments);
  });
});
