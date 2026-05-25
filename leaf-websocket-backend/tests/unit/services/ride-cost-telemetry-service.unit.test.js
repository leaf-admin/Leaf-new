const redisData = new Map();
const redisHashes = new Map();
const recentScores = new Map();
const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  zadd: jest.fn(),
  expire: jest.fn(),
  hset: jest.fn(),
  hgetall: jest.fn(),
  zrevrange: jest.fn(),
};

const mockEnsureConnection = jest.fn(async () => undefined);
const mockGetConnection = jest.fn(() => mockRedis);

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: (...args) => mockEnsureConnection(...args),
  getConnection: (...args) => mockGetConnection(...args),
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
}));

const service = require('../../../services/ride-cost-telemetry-service');

describe('ride-cost-telemetry-service', () => {
  beforeEach(() => {
    redisData.clear();
    redisHashes.clear();
    recentScores.clear();
    jest.clearAllMocks();

    mockGetConnection.mockImplementation(() => mockRedis);
    mockRedis.get.mockImplementation(async (key) => redisData.get(key) || null);
    mockRedis.set.mockImplementation(async (key, value) => {
      redisData.set(key, value);
      return 'OK';
    });
    mockRedis.zadd.mockImplementation(async (_key, score, member) => {
      recentScores.set(member, score);
      return 1;
    });
    mockRedis.expire.mockImplementation(async () => 1);
    mockRedis.hset.mockImplementation(async (key, value) => {
      redisHashes.set(key, {
        ...(redisHashes.get(key) || {}),
        ...value,
      });
      return 1;
    });
    mockRedis.hgetall.mockImplementation(async (key) => redisHashes.get(key) || {});
    mockRedis.zrevrange.mockImplementation(async (_key, start, end) => {
      const ordered = Array.from(recentScores.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([member]) => member);
      return ordered.slice(start, end + 1);
    });
  });

  it('persists a booking report and aggregates Google/backend totals', async () => {
    const report = await service.ingestSnapshot({
      bookingId: 'booking_123',
      sourceMeta: {
        userId: 'customer_1',
        userType: 'customer',
        platform: 'ios',
      },
      pricingSheet: {
        provider: 'google_maps_platform',
      },
      snapshot: {
        google: {
          skus: {
            directionsLegacy: {
              label: 'Directions',
              family: 'Routes APIs Legacy',
              unit: 'request',
              requestCount: 2,
              billableUnits: 2,
              estimatedCostUsd: 0.01,
            },
          },
        },
        backend: {
          commands: {
            createBooking: {
              attempts: 1,
              successes: 1,
              errors: 0,
              emits: 0,
              totalLatencyMs: 812,
            },
          },
        },
        woovi: {
          transferFeeUsd: 9,
        },
      },
    });

    expect(report.bookingId).toBe('booking_123');
    expect(report.totals.sourceCount).toBe(1);
    expect(report.totals.google.requestCount).toBe(2);
    expect(report.totals.google.billableUnits).toBe(2);
    expect(report.totals.google.estimatedCostUsd).toBe(0.01);
    expect(report.totals.google.directions.requestCount).toBe(2);
    expect(report.totals.google.directions.byUserType.customer).toBe(2);
    expect(report.totals.backend.attempts).toBe(1);
    expect(report.totals.backend.successes).toBe(1);
    expect(report.totals.backend.totalLatencyMs).toBe(812);
    expect(report.totals.cost.totalUsd).toBeCloseTo(0.01, 6);
    expect(report.totals.cost.budgetStatus).toBe('within_budget');
    expect(report.totals.cost.excludedCostProviders).toEqual(['woovi', 'payment_processor']);
    expect(redisHashes.get('booking:booking_123')).toEqual(
      expect.objectContaining({
        costTelemetryGoogleUsd: '0.01',
        costTelemetryGoogleBillableUnits: '2',
        costTelemetrySourceCount: '1',
        costTelemetryTotalUsd: '0.01',
        costTelemetryDirectionsRequests: '2',
        costTelemetryPassengerDirectionsRequests: '2',
      }),
    );
  });

  it('overwrites a source snapshot and merges totals across independent sources', async () => {
    await service.ingestSnapshot({
      bookingId: 'booking_multi',
      sourceMeta: {
        userId: 'customer_1',
        userType: 'customer',
      },
      snapshot: {
        google: {
          skus: {
            autocompleteLegacyPerRequest: {
              label: 'Autocomplete',
              family: 'Places API Legacy',
              unit: 'request',
              requestCount: 1,
              billableUnits: 1,
              estimatedCostUsd: 0.00283,
            },
          },
        },
        backend: {
          commands: {
            createBooking: {
              attempts: 1,
              successes: 0,
              errors: 1,
              emits: 0,
              totalLatencyMs: 400,
            },
          },
        },
      },
    });

    await service.ingestSnapshot({
      bookingId: 'booking_multi',
      sourceMeta: {
        userId: 'customer_1',
        userType: 'customer',
      },
      snapshot: {
        google: {
          skus: {
            autocompleteLegacyPerRequest: {
              label: 'Autocomplete',
              family: 'Places API Legacy',
              unit: 'request',
              requestCount: 2,
              billableUnits: 2,
              estimatedCostUsd: 0.00566,
            },
          },
        },
        backend: {
          commands: {
            createBooking: {
              attempts: 1,
              successes: 1,
              errors: 0,
              emits: 0,
              totalLatencyMs: 510,
            },
          },
        },
      },
    });

    const report = await service.ingestSnapshot({
      bookingId: 'booking_multi',
      sourceMeta: {
        userId: 'driver_7',
        userType: 'driver',
      },
      snapshot: {
        google: {
          skus: {
            directionsLegacy: {
              label: 'Directions',
              family: 'Routes APIs Legacy',
              unit: 'request',
              requestCount: 1,
              billableUnits: 1,
              estimatedCostUsd: 0.005,
            },
          },
        },
        backend: {
          commands: {
            acceptRide: {
              attempts: 1,
              successes: 1,
              errors: 0,
              emits: 0,
              totalLatencyMs: 320,
            },
          },
        },
      },
    });

    expect(report.totals.sourceCount).toBe(2);
    expect(report.totals.google.requestCount).toBe(3);
    expect(report.totals.google.estimatedCostUsd).toBeCloseTo(0.01066, 5);
    expect(report.totals.google.directions.requestCount).toBe(1);
    expect(report.totals.google.directions.byUserType.driver).toBe(1);
    expect(report.totals.google.directions.byUserType.customer).toBe(0);
    expect(report.totals.backend.attempts).toBe(2);
    expect(report.totals.backend.successes).toBe(2);
    expect(report.totals.backend.errors).toBe(0);
    expect(report.totals.backend.totalLatencyMs).toBe(830);
    expect(Object.keys(report.sources)).toEqual(
      expect.arrayContaining(['customer:customer_1', 'driver:driver_7']),
    );
  });

  it('aggregates directions dimensions to explain where requests came from', async () => {
    const report = await service.ingestSnapshot({
      bookingId: 'booking_dimensions',
      sourceMeta: {
        userId: 'driver_42',
        userType: 'driver',
        surface: 'driver_map',
      },
      snapshot: {
        google: {
          skus: {
            directionsLegacy: {
              label: 'Directions',
              family: 'Routes APIs Legacy',
              unit: 'request',
              requestCount: 3,
              billableUnits: 3,
              estimatedCostUsd: 0.015,
              breakdown: {
                bySurface: {
                  driver_enroute_pickup: {
                    requestCount: 2,
                    billableUnits: 2,
                    estimatedCostUsd: 0.01,
                  },
                  driver_active_trip: {
                    requestCount: 1,
                    billableUnits: 1,
                    estimatedCostUsd: 0.005,
                  },
                },
                byRouteScope: {
                  driver_to_pickup: {
                    requestCount: 2,
                    billableUnits: 2,
                    estimatedCostUsd: 0.01,
                  },
                  pickup_to_destination: {
                    requestCount: 1,
                    billableUnits: 1,
                    estimatedCostUsd: 0.005,
                  },
                },
                byCaller: {
                  'prototypeRideRuntime.js:enroute': {
                    requestCount: 3,
                    billableUnits: 3,
                    estimatedCostUsd: 0.015,
                  },
                },
              },
            },
          },
        },
      },
    });

    expect(report.totals.google.directions.requestCount).toBe(3);
    expect(report.totals.google.directions.byUserType.driver).toBe(3);
    expect(report.totals.google.directions.bySurface.driver_enroute_pickup.requestCount).toBe(2);
    expect(report.totals.google.directions.bySurface.driver_active_trip.requestCount).toBe(1);
    expect(report.totals.google.directions.byRouteScope.driver_to_pickup.billableUnits).toBe(2);
    expect(report.totals.google.directions.byRouteScope.pickup_to_destination.billableUnits).toBe(1);
  });

  it('ingests backend-authoritative Google SKU usage for a booking', async () => {
    const report = await service.ingestGoogleSkuUsage({
      bookingId: 'booking_backend_authoritative',
      skuKey: 'placeDetailsLegacy',
      sourceKey: 'backend:places:details',
      sourceMeta: {
        userId: 'customer_backend',
        userType: 'customer',
        surface: 'places_details_backend',
      },
      requestCount: 1,
      billableUnits: 1,
      metadata: {
        telemetrySurface: 'places_details_backend',
        routeScope: 'destination_resolution',
        callerFrame: 'routes/places-routes.js',
        cacheMode: 'none',
      },
    });

    expect(report.bookingId).toBe('booking_backend_authoritative');
    expect(report.totals.sourceCount).toBe(1);
    expect(report.totals.google.requestCount).toBe(1);
    expect(report.totals.google.billableUnits).toBe(1);
    expect(report.totals.google.estimatedCostUsd).toBe(0.017);
    expect(report.totals.google.skus.placeDetailsLegacy.estimatedCostUsd).toBe(0.017);
    expect(report.totals.google.skus.placeDetailsLegacy.breakdown.bySurface.places_details_backend).toEqual(
      expect.objectContaining({
        requestCount: 1,
        billableUnits: 1,
      }),
    );
    expect(report.totals.cost.totalUsd).toBe(0.017);
    expect(redisHashes.get('booking:booking_backend_authoritative')).toEqual(
      expect.objectContaining({
        costTelemetryGoogleUsd: '0.017',
        costTelemetryGoogleBillableUnits: '1',
        costTelemetryTotalUsd: '0.017',
      }),
    );
  });

  it('returns a fallback report from booking hash when the main report key is missing', async () => {
    redisHashes.set('booking:booking_hash_fallback', {
      status: 'completed',
      customerId: 'customer_x',
      driverId: 'driver_x',
      createdAt: '1776822467016',
      updatedAt: '2026-04-22T01:49:22.444Z',
      costTelemetryGoogleUsd: '0.01',
      costTelemetryGoogleBillableUnits: '2',
      costTelemetrySourceCount: '0',
      costTelemetryTotalUsd: '0.01',
      costTelemetryTotalBrl: '0.0518',
      costTelemetryBudgetStatus: 'within_budget',
      costTelemetryDirectionsRequests: '2',
      costTelemetryDriverDirectionsRequests: '1',
      costTelemetryPassengerDirectionsRequests: '1',
    });

    const report = await service.getReport('booking_hash_fallback');

    expect(report).toEqual(
      expect.objectContaining({
        bookingId: 'booking_hash_fallback',
        fallback: true,
        fallbackSource: 'booking_hash',
      }),
    );
    expect(report.totals.google.estimatedCostUsd).toBe(0.01);
    expect(report.totals.google.billableUnits).toBe(2);
    expect(report.totals.google.directions.requestCount).toBe(2);
    expect(report.totals.google.directions.byUserType.driver).toBe(1);
    expect(report.totals.google.directions.byUserType.customer).toBe(1);
    expect(report.totals.cost.totalUsd).toBe(0.01);
    expect(report.totals.cost.totalBrl).toBe(0.0518);
    expect(redisData.get('ride_cost_telemetry:booking_hash_fallback')).toBeTruthy();
  });

  it('ingests operational usage and persists backend/infra counters in report and booking hash', async () => {
    const report = await service.ingestOperationalUsage({
      bookingId: 'booking_ops_usage',
      sourceKey: 'backend:completeTrip',
      sourceMeta: {
        userId: 'driver_ops',
        userType: 'driver',
      },
      backendCommand: 'completeTrip',
      backend: {
        attempts: 1,
        successes: 1,
        totalLatencyMs: 1234,
      },
      redis: {
        writes: 2,
      },
      database: {
        writes: 1,
      },
    });

    expect(report.totals.backend.attempts).toBe(1);
    expect(report.totals.backend.successes).toBe(1);
    expect(report.totals.backend.totalLatencyMs).toBe(1234);
    expect(report.totals.infrastructure.redis.writes).toBe(2);
    expect(report.totals.infrastructure.database.writes).toBe(1);
    expect(redisHashes.get('booking:booking_ops_usage')).toEqual(
      expect.objectContaining({
        costTelemetryBackendAttempts: '1',
        costTelemetryBackendSuccesses: '1',
        costTelemetryBackendErrors: '0',
        costTelemetryBackendLatencyMs: '1234',
        costTelemetryRedisWrites: '2',
        costTelemetryDatabaseWrites: '1',
      }),
    );
  });
});
