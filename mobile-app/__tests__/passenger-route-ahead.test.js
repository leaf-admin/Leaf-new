import {
  resolveLivePickupLeg,
  routeLengthMeters,
  trimRouteAhead,
  trimTrafficAhead,
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
  it('drops the part of the route the driver already drove', () => {
    const ahead = trimRouteAhead(route, { latitude: -22.92352, longitude: -43.40752 });
    expect(ahead).toHaveLength(3);
    expect(ahead[ahead.length - 1]).toEqual(pickup);
    expect(routeLengthMeters(ahead)).toBeLessThan(routeLengthMeters(route) / 2);
  });

  it('keeps the whole route when the driver is off it', () => {
    expect(trimRouteAhead(route, { latitude: -22.95, longitude: -43.45 })).toBe(route);
  });

  it('shrinks distance and ETA as the driver gets closer, keeping the booked pace', () => {
    const start = resolveLivePickupLeg({
      driverCoordinate: route[0],
      pickupCoordinate: pickup,
      routeAhead: route,
      bookedDistanceKm: 0.68,
      bookedEtaMinutes: 2,
    });
    const atDoor = resolveLivePickupLeg({
      driverCoordinate: pickup,
      pickupCoordinate: pickup,
      routeAhead: trimRouteAhead(route, pickup),
      bookedDistanceKm: 0.68,
      bookedEtaMinutes: 2,
    });
    expect(start.distanceKm).toBeGreaterThan(0.6);
    expect(start.etaMinutes).toBe(2);
    expect(atDoor.distanceKm).toBeLessThan(0.02);
    expect(atDoor.etaMinutes).toBe(1);
    expect(resolveLivePickupLeg({ driverCoordinate: null, pickupCoordinate: pickup })).toBeNull();
  });

  it('drops traffic colours behind the car', () => {
    const segments = [
      { coordinates: [route[0], route[1]], level: 'slow' },
      { coordinates: [route[1], route[2]], level: 'normal' },
      { coordinates: [route[3], route[4]], level: 'normal' },
    ];
    expect(trimTrafficAhead(segments, route, route[2])).toEqual([segments[2]]);
    expect(trimTrafficAhead(segments, route, { latitude: -22.95, longitude: -43.45 })).toBe(segments);
  });
});
