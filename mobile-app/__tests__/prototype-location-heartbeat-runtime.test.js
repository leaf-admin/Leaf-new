import {
  PASSENGER_LOCATION_STARTED_HEARTBEAT_MS,
  PASSENGER_LOCATION_STATIONARY_HEARTBEAT_MS,
  buildDriverLocationPayload,
  buildPassengerLocationPayload,
  calculateHeadingDeltaDegrees,
  normalizeHeadingDegrees,
  shouldThrottlePassengerLocationPush,
} from '../src/screens/prototype/prototypeLocationHeartbeatRuntime';

describe('prototype location heartbeat runtime helpers', () => {
  it('builds driver and passenger location payloads from runtime state', () => {
    expect(buildPassengerLocationPayload({
      currentCoordinate: { latitude: '-22.98391', longitude: '-43.21788' },
      currentHeading: '42',
    })).toEqual({
      lat: -22.98391,
      lng: -43.21788,
      heading: 42,
      speed: 0,
    });

    expect(buildDriverLocationPayload({
      driverCoordinate: { latitude: -22.98, longitude: -43.21 },
      currentCoordinate: { latitude: -22.99, longitude: -43.22 },
      currentHeading: 'n/a',
    })).toEqual({
      lat: -22.98,
      lng: -43.21,
      heading: 0,
      speed: 0,
    });

    expect(buildDriverLocationPayload({
      currentCoordinate: { latitude: -22.99, longitude: -43.22 },
      currentHeading: 180,
    })).toEqual({
      lat: -22.99,
      lng: -43.22,
      heading: 180,
      speed: 0,
    });

    expect(buildPassengerLocationPayload({
      currentCoordinate: { latitude: 'nope', longitude: -43.22 },
    })).toBeNull();
    expect(buildDriverLocationPayload({
      driverCoordinate: { latitude: 'nope', longitude: -43.21 },
      currentCoordinate: { latitude: -22.99, longitude: -43.22 },
    })).toBeNull();
  });

  it('normalizes heading and calculates circular heading deltas', () => {
    expect(normalizeHeadingDegrees(-10)).toBe(350);
    expect(normalizeHeadingDegrees(370)).toBe(10);
    expect(normalizeHeadingDegrees('n/a')).toBe(0);
    expect(calculateHeadingDeltaDegrees(350, 10)).toBe(20);
    expect(calculateHeadingDeltaDegrees(10, 350)).toBe(20);
    expect(calculateHeadingDeltaDegrees(90, 180)).toBe(90);
  });

  it('does not throttle forced, first, changed booking, or changed status updates', () => {
    const base = {
      bookingId: 'booking_1',
      bookingStatus: 'accepted',
      location: { lat: -22.98, lng: -43.21, heading: 10 },
      lastSentAt: 10000,
      lastBookingId: 'booking_1',
      lastBookingStatus: 'accepted',
      lastLocation: { latitude: -22.98, longitude: -43.21 },
      lastHeading: 10,
      nowMs: 11000,
    };

    expect(shouldThrottlePassengerLocationPush({ ...base, force: true })).toBe(false);
    expect(shouldThrottlePassengerLocationPush({ ...base, lastSentAt: 0 })).toBe(false);
    expect(shouldThrottlePassengerLocationPush({ ...base, lastBookingId: 'booking_2' })).toBe(false);
    expect(shouldThrottlePassengerLocationPush({ ...base, lastBookingStatus: 'started' })).toBe(false);
  });

  it('throttles stationary passenger updates inside the accepted heartbeat window', () => {
    expect(shouldThrottlePassengerLocationPush({
      bookingId: 'booking_1',
      bookingStatus: 'accepted',
      location: { lat: -22.98001, lng: -43.21001, heading: 13 },
      lastSentAt: 10000,
      lastBookingId: 'booking_1',
      lastBookingStatus: 'accepted',
      lastLocation: { latitude: -22.98, longitude: -43.21 },
      lastHeading: 10,
      nowMs: 10000 + PASSENGER_LOCATION_STATIONARY_HEARTBEAT_MS - 1,
    })).toBe(true);

    expect(shouldThrottlePassengerLocationPush({
      bookingId: 'booking_1',
      bookingStatus: 'accepted',
      location: { lat: -22.98001, lng: -43.21001, heading: 13 },
      lastSentAt: 10000,
      lastBookingId: 'booking_1',
      lastBookingStatus: 'accepted',
      lastLocation: { latitude: -22.98, longitude: -43.21 },
      lastHeading: 10,
      nowMs: 10000 + PASSENGER_LOCATION_STATIONARY_HEARTBEAT_MS,
    })).toBe(false);
  });

  it('uses the shorter started heartbeat window and bypasses throttle on movement or heading change', () => {
    const base = {
      bookingId: 'booking_1',
      bookingStatus: 'started',
      lastSentAt: 10000,
      lastBookingId: 'booking_1',
      lastBookingStatus: 'started',
      lastLocation: { latitude: -22.98, longitude: -43.21 },
      lastHeading: 10,
    };

    expect(shouldThrottlePassengerLocationPush({
      ...base,
      location: { lat: -22.98001, lng: -43.21001, heading: 12 },
      nowMs: 10000 + PASSENGER_LOCATION_STARTED_HEARTBEAT_MS - 1,
    })).toBe(true);

    expect(shouldThrottlePassengerLocationPush({
      ...base,
      location: { lat: -22.981, lng: -43.211, heading: 12 },
      nowMs: 11000,
    })).toBe(false);

    expect(shouldThrottlePassengerLocationPush({
      ...base,
      location: { lat: -22.98001, lng: -43.21001, heading: 25 },
      nowMs: 11000,
    })).toBe(false);
  });
});
