jest.mock('../src/utils/Logger', () => ({
  warn: jest.fn(),
  log: jest.fn(),
  error: jest.fn(),
}));

import rideCostTelemetryService, {
  RIDE_TELEMETRY_GOOGLE_SKUS,
} from '../src/services/RideCostTelemetryService';

describe('RideCostTelemetryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    rideCostTelemetryService.resetForTests();
  });

  it('aggregates Google SKUs and backend commands inside a bound booking context', () => {
    const context = rideCostTelemetryService.ensureContext({
      sourceMeta: {
        userId: 'customer_1',
        userType: 'customer',
        platform: 'ios',
        flow: 'prototype',
      },
    });

    rideCostTelemetryService.recordGoogleUsage(
      RIDE_TELEMETRY_GOOGLE_SKUS.AUTOCOMPLETE_LEGACY_PER_REQUEST,
      { requestCount: 1, billableUnits: 1, metadata: { query: 'Aeroporto' } },
      context,
    );
    rideCostTelemetryService.recordGoogleUsage(
      RIDE_TELEMETRY_GOOGLE_SKUS.DIRECTIONS_LEGACY,
      {
        requestCount: 2,
        billableUnits: 2,
        metadata: {
          leg: 'pickup',
          telemetrySurface: 'driver_enroute_pickup',
          routeScope: 'driver_to_pickup',
          callerFrame: 'prototypeRideRuntime.js:8456',
        },
      },
      context,
    );
    rideCostTelemetryService.recordGoogleCache(
      'directionsMemoryHit',
      { metadata: { reason: 'rerender' } },
      context,
    );
    rideCostTelemetryService.recordBackendCommand(
      'createBooking',
      { phase: 'attempt', metadata: { requestId: 'req_1' } },
      context,
    );
    rideCostTelemetryService.recordBackendCommand(
      'createBooking',
      { phase: 'success', latencyMs: 940 },
      context,
    );

    const bound = rideCostTelemetryService.bindContextToBooking({
      ...context,
      bookingId: 'booking_123',
    });
    const snapshot = rideCostTelemetryService.getSnapshot(bound);

    expect(snapshot.bookingId).toBe('booking_123');
    expect(snapshot.google.totalBillableUnits).toBe(3);
    expect(snapshot.google.totalEstimatedCostUsd).toBeCloseTo(0.01283, 5);
    expect(snapshot.google.skus.directionsLegacy.requestCount).toBe(2);
    expect(
      snapshot.google.skus.directionsLegacy.breakdown.bySurface.driver_enroute_pickup.requestCount,
    ).toBe(2);
    expect(
      snapshot.google.skus.directionsLegacy.breakdown.byRouteScope.driver_to_pickup.billableUnits,
    ).toBe(2);
    expect(snapshot.google.cache.directionsMemoryHit).toBe(1);
    expect(snapshot.backend.commands.createBooking.attempts).toBe(1);
    expect(snapshot.backend.commands.createBooking.successes).toBe(1);
    expect(snapshot.backend.totalLatencyMs).toBe(940);
    expect(snapshot.recentEvents.length).toBeGreaterThanOrEqual(4);
  });

  it('publishes a full snapshot when a bound context is flushed', async () => {
    const publisher = jest.fn(async () => true);
    rideCostTelemetryService.setPublisher(publisher);

    const context = rideCostTelemetryService.bindContextToBooking({
      sourceMeta: {
        userId: 'driver_9',
        userType: 'driver',
        platform: 'android',
      },
      bookingId: 'booking_driver_9',
    });

    rideCostTelemetryService.recordBackendCommand(
      'acceptRide',
      { phase: 'attempt' },
      context,
    );

    const flushed = await rideCostTelemetryService.flushContext(context);

    expect(flushed).toBe(true);
    expect(publisher).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_driver_9',
        sourceKey: 'driver:driver_9',
        snapshot: expect.objectContaining({
          bookingId: 'booking_driver_9',
          backend: expect.objectContaining({
            totalAttempts: 1,
          }),
        }),
      }),
    );
  });

  it('does not reuse a bound booking context as the next draft for the same source', () => {
    const firstDraft = rideCostTelemetryService.ensureContext({
      sourceMeta: {
        userId: 'customer_1',
        userType: 'customer',
      },
    });

    const bound = rideCostTelemetryService.bindContextToBooking({
      ...firstDraft,
      bookingId: 'booking_old',
    });

    const nextDraft = rideCostTelemetryService.ensureContext({
      sourceMeta: {
        userId: 'customer_1',
        userType: 'customer',
      },
    });

    expect(bound.contextId).not.toBe(nextDraft.contextId);
    expect(nextDraft.bookingId).toBe(null);
  });

  it('can rotate an open draft context for the same source before binding a booking', () => {
    const firstDraft = rideCostTelemetryService.ensureContext({
      sourceMeta: {
        userId: 'customer_3',
        userType: 'customer',
        platform: 'ios',
      },
    });

    rideCostTelemetryService.recordGoogleUsage(
      RIDE_TELEMETRY_GOOGLE_SKUS.DIRECTIONS_LEGACY,
      { requestCount: 1, billableUnits: 1 },
      firstDraft,
    );

    const rotatedDraft = rideCostTelemetryService.rotateDraftContext({
      sourceMeta: {
        userId: 'customer_3',
        userType: 'customer',
        platform: 'ios',
      },
    });
    const freshDraft = rideCostTelemetryService.ensureContext({
      sourceMeta: {
        userId: 'customer_3',
        userType: 'customer',
        platform: 'ios',
      },
    });

    expect(rotatedDraft.contextId).not.toBe(firstDraft.contextId);
    expect(rotatedDraft.bookingId).toBe(null);
    expect(freshDraft.contextId).toBe(rotatedDraft.contextId);
    expect(freshDraft.contextId).not.toBe(firstDraft.contextId);
  });

  it('preserves a bound source key when later calls only provide a contextId', () => {
    const draft = rideCostTelemetryService.ensureContext({
      sourceMeta: {
        userId: 'customer_4',
        userType: 'customer',
        platform: 'ios',
      },
    });

    const bound = rideCostTelemetryService.bindContextToBooking({
      ...draft,
      bookingId: 'booking_source_preserve',
    });

    rideCostTelemetryService.recordBackendCommand(
      'updatePassengerLocation',
      { phase: 'success', latencyMs: 120 },
      {
        contextId: bound.contextId,
        bookingId: 'booking_source_preserve',
      },
    );

    const snapshot = rideCostTelemetryService.getSnapshot({
      contextId: bound.contextId,
    });

    expect(snapshot.sourceKey).toBe('customer:customer_4');
    expect(snapshot.backend.commands.updatePassengerLocation.successes).toBe(1);
  });

  it('merges telemetry into the authoritative booking when a source is rebound', () => {
    const sourceMeta = {
      userId: 'customer_5',
      userType: 'customer',
      platform: 'ios',
    };
    const provisionalDraft = rideCostTelemetryService.ensureContext({ sourceMeta });

    rideCostTelemetryService.recordGoogleUsage(
      RIDE_TELEMETRY_GOOGLE_SKUS.DIRECTIONS_LEGACY,
      { requestCount: 1, billableUnits: 1, metadata: { surface: 'ride_request' } },
      provisionalDraft,
    );

    const provisionalBooking = rideCostTelemetryService.bindContextToBooking({
      ...provisionalDraft,
      bookingId: 'booking_provisional',
    });

    const authoritativeBooking = rideCostTelemetryService.bindContextToBooking({
      sourceMeta,
      bookingId: 'booking_authoritative',
    });

    rideCostTelemetryService.recordBackendCommand(
      'updatePassengerLocation',
      { phase: 'success', latencyMs: 87 },
      authoritativeBooking,
    );

    const rebound = rideCostTelemetryService.bindContextToBooking({
      contextId: provisionalBooking.contextId,
      bookingId: 'booking_authoritative',
      sourceMeta,
    });
    const snapshot = rideCostTelemetryService.getSnapshot({
      contextId: rebound.contextId,
    });

    expect(rebound.contextId).toBe(authoritativeBooking.contextId);
    expect(snapshot.bookingId).toBe('booking_authoritative');
    expect(snapshot.google.skus.directionsLegacy.requestCount).toBe(1);
    expect(snapshot.backend.commands.updatePassengerLocation.successes).toBe(1);
  });

  it('can persist and flush immediately after binding a booking context', async () => {
    const publisher = jest.fn(async () => true);
    const setItem = jest.fn(async () => true);
    const getItem = jest.fn(async () => null);

    rideCostTelemetryService.setPublisher(publisher);
    rideCostTelemetryService.storageAdapter = { setItem, getItem };

    const context = rideCostTelemetryService.ensureContext({
      sourceMeta: {
        userId: 'customer_2',
        userType: 'customer',
        platform: 'ios',
      },
    });

    rideCostTelemetryService.recordGoogleUsage(
      RIDE_TELEMETRY_GOOGLE_SKUS.AUTOCOMPLETE_LEGACY_PER_REQUEST,
      { requestCount: 1, billableUnits: 1 },
      context,
    );

    const bound = rideCostTelemetryService.bindContextToBooking({
      ...context,
      bookingId: 'booking_immediate_flush',
    });

    rideCostTelemetryService.persistContextSoon(bound);
    rideCostTelemetryService.flushContextSoon(bound);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(setItem).toHaveBeenCalled();
    expect(publisher).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_immediate_flush',
        sourceKey: 'customer:customer_2',
      }),
    );
  });
});
