const mockResolveCanonicalTripMetrics = jest.fn();

jest.mock('../../../services/trip-location-persistence-service', () => ({
  resolveCanonicalTripMetrics: (...args) => mockResolveCanonicalTripMetrics(...args)
}));

const {
  resolveRideEarlyEnd,
  resolveDriverEarlyEndSettlement
} = require('../../../services/ride-early-end-service');

describe('ride-early-end-service', () => {
  const destination = { lat: -22.9827, lng: -43.3642 };
  const pickup = { lat: -22.9208, lng: -43.4061 };

  it('detects a ride ended far from the destination', () => {
    const result = resolveRideEarlyEnd({ endLocation: pickup, destinationLocation: destination, env: {} });

    expect(result).toEqual(expect.objectContaining({ detected: true, thresholdMeters: 500, driverReason: null }));
    expect(result.remainingMeters).toBeGreaterThan(7000);
    expect(result.remainingMeters).toBeLessThan(9000);
  });

  it('does not flag a ride ended at the destination', () => {
    expect(
      resolveRideEarlyEnd({
        endLocation: { lat: destination.lat + 0.001, lng: destination.lng },
        destinationLocation: destination,
        env: {}
      })
    ).toBeNull();
  });

  it('reads the destination stored as JSON on the booking hash', () => {
    const result = resolveRideEarlyEnd({
      endLocation: pickup,
      destinationLocation: JSON.stringify({ lat: destination.lat, lng: destination.lng, add: 'Destino' }),
      env: {}
    });

    expect(result.detected).toBe(true);
  });

  it('keeps only known driver reasons', () => {
    expect(
      resolveRideEarlyEnd({
        endLocation: pickup,
        destinationLocation: destination,
        driverStatement: { reason: 'passenger_request' },
        env: {}
      }).driverReason
    ).toBe('passenger_request');
    expect(
      resolveRideEarlyEnd({
        endLocation: pickup,
        destinationLocation: destination,
        driverStatement: { reason: '<script>' },
        env: {}
      }).driverReason
    ).toBeNull();
  });

  it('honours the configured threshold', () => {
    expect(
      resolveRideEarlyEnd({
        endLocation: pickup,
        destinationLocation: destination,
        env: { RIDE_EARLY_END_DISTANCE_METERS: '20000' }
      })
    ).toBeNull();
  });

  it('cannot decide without both locations', () => {
    expect(resolveRideEarlyEnd({ endLocation: pickup, destinationLocation: null, env: {} })).toBeNull();
    expect(resolveRideEarlyEnd({ endLocation: { lat: 0, lng: 0 }, destinationLocation: destination, env: {} })).toBeNull();
    expect(resolveRideEarlyEnd({ endLocation: 'not-json', destinationLocation: destination, env: {} })).toBeNull();
  });
});

describe('ride-early-end-service driver settlement decision', () => {
  const destination = { lat: -22.9827, lng: -43.3642 };
  const pickup = { lat: -22.9208, lng: -43.4061 };
  const halfway = { lat: -22.95175, lng: -43.38515 };
  const nowMs = 1760000000000;
  const previousFlag = process.env.ENABLE_DRIVER_EARLY_END_SETTLEMENT;

  const booking = (overrides = {}) => ({
    driverId: 'driver_1',
    estimatedFare: '40',
    paymentAmountInCents: '4000',
    tollFee: '0',
    routeDistanceKm: '10',
    routeDurationSecs: '1200',
    startLocation: JSON.stringify(pickup),
    destinationLocation: JSON.stringify(destination),
    startedAt: new Date(nowMs - 600000).toISOString(),
    ...overrides
  });

  const decide = (overrides = {}) =>
    resolveDriverEarlyEndSettlement({
      redis: {},
      bookingId: 'booking_1',
      driverId: 'driver_1',
      bookingData: booking(),
      nowMs,
      env: {},
      ...overrides
    });

  beforeEach(() => {
    process.env.ENABLE_DRIVER_EARLY_END_SETTLEMENT = 'true';
    mockResolveCanonicalTripMetrics.mockReset();
    mockResolveCanonicalTripMetrics.mockResolvedValue({
      success: true,
      source: 'server_trip_location_telemetry',
      distanceKm: 5,
      durationSecs: 600,
      endLocation: halfway,
      lastReceivedAtMs: nowMs - 4000,
      pointsCount: 30
    });
  });

  afterAll(() => {
    if (previousFlag === undefined) {
      delete process.env.ENABLE_DRIVER_EARLY_END_SETTLEMENT;
    } else {
      process.env.ENABLE_DRIVER_EARLY_END_SETTLEMENT = previousFlag;
    }
  });

  it('settles with the rider early-end formula from server telemetry only', async () => {
    const result = await decide({ driverStatement: { reason: 'trip_problem', remainingMeters: 1 } });

    expect(result.applied).toBe(true);
    expect(result.endLocation).toEqual(halfway);
    expect(result.settlement).toMatchObject({
      settlementType: 'EARLY_ENDED_BY_DRIVER',
      initiatedBy: 'DRIVER',
      driverReason: 'trip_problem',
      originalFare: 40,
      prepaidAmount: 40,
      executedFare: 20,
      estimatedRefund: 20,
      executedDistanceKm: 5,
      executedDurationSecs: 600,
      telemetryPointsCount: 30,
      positionAgeSecs: 4
    });
    expect(result.settlement.remainingMeters).toBe(result.earlyEnd.remainingMeters);
    expect(mockResolveCanonicalTripMetrics).toHaveBeenCalledWith(expect.objectContaining({
      tripId: 'booking_1',
      driverId: 'driver_1',
      startLocation: pickup
    }));
  });

  it('is off unless the feature flag is enabled', async () => {
    delete process.env.ENABLE_DRIVER_EARLY_END_SETTLEMENT;

    await expect(decide()).resolves.toEqual({ applied: false, reason: 'DISABLED' });
    expect(mockResolveCanonicalTripMetrics).not.toHaveBeenCalled();
  });

  it('does not settle near the destination', async () => {
    mockResolveCanonicalTripMetrics.mockResolvedValue({
      success: true,
      distanceKm: 9.8,
      durationSecs: 1100,
      endLocation: { lat: destination.lat + 0.001, lng: destination.lng },
      lastReceivedAtMs: nowMs - 1000
    });

    await expect(decide({ driverStatement: { reason: 'passenger_request', remainingMeters: 9000 } }))
      .resolves.toEqual({ applied: false, reason: 'NEAR_DESTINATION' });
  });

  it.each([
    ['no telemetry', { success: false, code: 'CANONICAL_TRIP_TELEMETRY_UNAVAILABLE' }, 'TRUSTED_POSITION_UNAVAILABLE'],
    ['null island', { success: true, endLocation: { lat: 0, lng: 0 }, lastReceivedAtMs: nowMs }, 'TRUSTED_POSITION_UNAVAILABLE'],
    ['no timestamp', { success: true, endLocation: halfway, distanceKm: 5, durationSecs: 600 }, 'TRUSTED_POSITION_STALE'],
    ['old position', { success: true, endLocation: halfway, distanceKm: 5, durationSecs: 600, lastReceivedAtMs: nowMs - 121000 }, 'TRUSTED_POSITION_STALE']
  ])('fails safe to the full fare with %s', async (_label, metrics, reason) => {
    mockResolveCanonicalTripMetrics.mockResolvedValue(metrics);

    const result = await decide();

    expect(result.applied).toBe(false);
    expect(result.reason).toBe(reason);
    expect(result.settlement).toBeUndefined();
  });

  it.each([
    ['toll on the booking', { bookingData: booking({ tollFee: '6.5' }) }, 'TOLL_PASS_THROUGH'],
    ['toll resolved by the handler', { tollFee: 4 }, 'TOLL_PASS_THROUGH'],
    ['ride legs', { bookingData: booking({ rideLegs: JSON.stringify([{ legNumber: 1 }]) }) }, 'MULTI_LEG_RIDE'],
    ['operational continuation', { bookingData: booking({ operationalContinuation: JSON.stringify({ status: 'X' }) }) }, 'MULTI_LEG_RIDE'],
    ['confirmed extension', { bookingData: booking({ extensionHistory: JSON.stringify([{ status: 'CONFIRMED' }]) }) }, 'RIDE_EXTENSION'],
    ['missing contracted distance', { bookingData: booking({ routeDistanceKm: '' }) }, 'CONTRACTED_ROUTE_UNAVAILABLE'],
    ['missing destination', { bookingData: booking({ destinationLocation: '' }) }, 'DESTINATION_UNAVAILABLE']
  ])('leaves the fare untouched with %s', async (_label, overrides, reason) => {
    const result = await decide(overrides);

    expect(result.applied).toBe(false);
    expect(result.reason).toBe(reason);
    expect(result.settlement).toBeUndefined();
  });

  it('does not settle when the travelled share already covers the full fare', async () => {
    mockResolveCanonicalTripMetrics.mockResolvedValue({
      success: true,
      distanceKm: 12,
      durationSecs: 1500,
      endLocation: halfway,
      lastReceivedAtMs: nowMs - 1000
    });

    const result = await decide();

    expect(result.applied).toBe(false);
    expect(result.reason).toBe('NO_REFUND_DUE');
  });
});
