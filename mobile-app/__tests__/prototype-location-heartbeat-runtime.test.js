import {
  PASSENGER_LOCATION_STARTED_HEARTBEAT_MS,
  PASSENGER_LOCATION_STATIONARY_HEARTBEAT_MS,
  buildDriverHeartbeatState,
  buildDriverLocationHeartbeatState,
  buildPassengerHeartbeatStartKey,
  buildDriverLocationPayload,
  buildPassengerHeartbeatState,
  buildPassengerLocationPayload,
  calculateHeadingDeltaDegrees,
  normalizeHeadingDegrees,
  sendDriverLocationHeartbeat,
  sendPassengerLocationHeartbeat,
  shouldCoalescePassengerLocationAttempt,
  shouldMonitorPassengerTripulation,
  shouldReusePassengerHeartbeat,
  shouldReusePendingPassengerHeartbeatStart,
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

  it('sends driver location heartbeat through the socket and returns state metadata', async () => {
    const socket = {
      updateLocation: jest.fn().mockResolvedValue(undefined),
    };
    const location = {
      lat: -22.98,
      lng: -43.21,
      heading: 90,
      speed: 0,
    };

    await expect(sendDriverLocationHeartbeat({
      profileUid: '',
      location,
      socket,
    })).resolves.toEqual({
      success: false,
      code: 'PROFILE_REQUIRED',
    });

    await expect(sendDriverLocationHeartbeat({
      profileUid: 'driver_1',
      location: null,
      socket,
    })).resolves.toEqual({
      success: false,
      code: 'LOCATION_REQUIRED',
    });

    const result = await sendDriverLocationHeartbeat({
      profileUid: 'driver_1',
      location,
      socket,
      routePlanShare: {
        signature: 'booking_1:pickup',
        payload: { bookingId: 'booking_1' },
      },
      nowMs: Date.parse('2026-05-30T12:00:00.000Z'),
    });

    expect(socket.updateLocation).toHaveBeenCalledWith(
      'driver_1',
      -22.98,
      -43.21,
      90,
      0,
      { bookingId: 'booking_1' },
    );
    expect(result).toEqual({
      success: true,
      location,
      routePlanSignature: 'booking_1:pickup',
      sentAtMs: Date.parse('2026-05-30T12:00:00.000Z'),
      heartbeatPatch: {
        running: true,
        lastSentAt: '2026-05-30T12:00:00.000Z',
        lastError: '',
      },
    });
  });

  it('sends passenger location heartbeat through the socket and returns state metadata', async () => {
    const socket = {
      updatePassengerLocation: jest.fn().mockResolvedValue(undefined),
    };
    const location = {
      lat: -22.99,
      lng: -43.22,
      heading: 180,
      speed: 0,
    };

    await expect(sendPassengerLocationHeartbeat({
      bookingId: '',
      location,
      socket,
    })).resolves.toEqual({
      success: false,
      code: 'BOOKING_REQUIRED',
    });

    await expect(sendPassengerLocationHeartbeat({
      bookingId: 'booking_1',
      location: null,
      socket,
    })).resolves.toEqual({
      success: false,
      code: 'LOCATION_REQUIRED',
    });

    const result = await sendPassengerLocationHeartbeat({
      bookingId: 'booking_1',
      location,
      socket,
      nowMs: Date.parse('2026-05-30T12:01:00.000Z'),
    });

    expect(socket.updatePassengerLocation).toHaveBeenCalledWith(
      'booking_1',
      -22.99,
      -43.22,
      180,
      0,
    );
    expect(result).toEqual({
      success: true,
      location,
      bookingId: 'booking_1',
      sentAtMs: Date.parse('2026-05-30T12:01:00.000Z'),
      heartbeatPatch: {
        running: true,
        lastSentAt: '2026-05-30T12:01:00.000Z',
        lastError: '',
      },
      locationSnapshot: {
        latitude: -22.99,
        longitude: -43.22,
      },
      heading: 180,
    });
  });

  it('identifies passenger trip statuses that should be monitored', () => {
    expect(shouldMonitorPassengerTripulation({
      activeBookingId: 'booking_1',
      bookingStatus: 'accepted',
    })).toBe(true);
    expect(shouldMonitorPassengerTripulation({
      activeBookingId: 'booking_1',
      bookingStatus: 'arrived',
    })).toBe(true);
    expect(shouldMonitorPassengerTripulation({
      activeBookingId: 'booking_1',
      bookingStatus: 'started',
    })).toBe(true);
    expect(shouldMonitorPassengerTripulation({
      activeBookingId: 'booking_1',
      bookingStatus: 'completed',
    })).toBe(false);
    expect(shouldMonitorPassengerTripulation({
      activeBookingId: '',
      bookingStatus: 'accepted',
    })).toBe(false);
  });

  it('builds passenger heartbeat start keys and detects reusable starts', () => {
    expect(buildPassengerHeartbeatStartKey('user_1', 'booking_1')).toBe('user_1:booking_1');
    expect(buildPassengerHeartbeatStartKey('', 'booking_1')).toBe('');
    expect(buildPassengerHeartbeatStartKey('user_1', '')).toBe('');

    expect(shouldReusePassengerHeartbeat({
      hasInterval: true,
      activeProfileUid: 'user_1',
      activeBookingId: 'booking_1',
      profileUid: 'user_1',
      bookingId: 'booking_1',
    })).toBe(true);
    expect(shouldReusePassengerHeartbeat({
      hasInterval: false,
      activeProfileUid: 'user_1',
      activeBookingId: 'booking_1',
      profileUid: 'user_1',
      bookingId: 'booking_1',
    })).toBe(false);
    expect(shouldReusePendingPassengerHeartbeatStart({
      pendingStartPromise: Promise.resolve(),
      pendingStartKey: 'user_1:booking_1',
      startKey: 'user_1:booking_1',
    })).toBe(true);
    expect(shouldReusePendingPassengerHeartbeatStart({
      pendingStartPromise: null,
      pendingStartKey: 'user_1:booking_1',
      startKey: 'user_1:booking_1',
    })).toBe(false);
  });

  it('builds heartbeat state patches without losing existing metadata', () => {
    expect(buildPassengerHeartbeatState({
      passengerLocationHeartbeat: {
        running: false,
        lastSentAt: 'old',
        lastError: 'old error',
      },
    }, {
      running: true,
      lastError: '',
    })).toEqual({
      passengerLocationHeartbeat: {
        running: true,
        lastSentAt: 'old',
        lastError: '',
      },
    });

    expect(buildDriverHeartbeatState({
      driverLocationHeartbeat: {
        running: false,
        lastSentAt: 'old',
      },
    }, {
      running: true,
      lastSentAt: 'new',
    })).toEqual({
      driverLocationHeartbeat: {
        running: true,
        lastSentAt: 'new',
      },
    });

    expect(buildDriverLocationHeartbeatState({
      driverLocationHeartbeat: {
        running: false,
        lastError: 'old error',
      },
    }, {
      lat: -22.98,
      lng: -43.21,
    }, {
      running: true,
      lastError: '',
    })).toEqual({
      currentCoordinate: {
        latitude: -22.98,
        longitude: -43.21,
      },
      driverCoordinate: {
        latitude: -22.98,
        longitude: -43.21,
      },
      driverLocationHeartbeat: {
        running: true,
        lastError: '',
      },
    });
  });

  it('coalesces passenger location attempts for the same booking inside the send gap', () => {
    expect(shouldCoalescePassengerLocationAttempt({
      bookingId: 'booking_1',
      lastBookingId: 'booking_1',
      lastAttemptAt: 10000,
      nowMs: 10899,
    })).toBe(true);
    expect(shouldCoalescePassengerLocationAttempt({
      bookingId: 'booking_1',
      lastBookingId: 'booking_1',
      lastAttemptAt: 10000,
      nowMs: 10900,
    })).toBe(false);
    expect(shouldCoalescePassengerLocationAttempt({
      force: true,
      bookingId: 'booking_1',
      lastBookingId: 'booking_1',
      lastAttemptAt: 10000,
      nowMs: 10001,
    })).toBe(false);
    expect(shouldCoalescePassengerLocationAttempt({
      bookingId: 'booking_1',
      lastBookingId: 'booking_2',
      lastAttemptAt: 10000,
      nowMs: 10001,
    })).toBe(false);
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
