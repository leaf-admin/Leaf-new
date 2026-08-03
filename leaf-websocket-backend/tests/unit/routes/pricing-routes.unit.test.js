jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockRedis = {
  eval: jest.fn(),
  get: jest.fn(),
  set: jest.fn()
};
const mockGetConnection = jest.fn(() => mockRedis);
const mockEstimateRideFare = jest.fn();
const mockHasPaymentEligibleDriver = jest.fn();
const mockIsActive = jest.fn(() => false);
const mockValidateRideLocations = jest.fn(() => ({ valid: true }));
const mockRecordPricingQuoteRequest = jest.fn();
const mockResolveTollFeeFromPricingPayload = jest.fn();
const mockFetchDirectionsRoute = jest.fn();
const mockDecodePolyline = jest.fn();

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: () => mockGetConnection()
}));

jest.mock('../../../services/fare-estimation-service', () => ({
  estimateRideFare: (...args) => mockEstimateRideFare(...args)
}));

jest.mock('../../../services/payment-driver-availability-guard', () => ({
  hasPaymentEligibleDriver: (...args) => mockHasPaymentEligibleDriver(...args)
}));

jest.mock('../../../services/pricing/calculateFare', () => ({
  RATE_CARD_VERSION: 'test-rate-card-v1',
  getPublicRateCards: () => ({
    leaf_plus: {
      display_name: 'Leaf Plus'
    }
  })
}));

jest.mock('../../../utils/prometheus-metrics', () => ({
  metrics: {
    recordPricingEvaluation: jest.fn(),
    recordPricingQuoteRequest: (...args) => mockRecordPricingQuoteRequest(...args)
  }
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn()
}));

jest.mock('../../../services/geofence-service', () => ({
  isActive: () => mockIsActive(),
  validateRideLocations: (...args) => mockValidateRideLocations(...args)
}));

jest.mock('../../../services/route-toll-service', () => ({
  resolveTollFeeFromPricingPayload: (...args) => mockResolveTollFeeFromPricingPayload(...args),
  decodePolyline: (...args) => mockDecodePolyline(...args)
}));

jest.mock('../../../services/places-cache-service', () => ({
  fetchDirectionsRoute: (...args) => mockFetchDirectionsRoute(...args)
}));

const pricingRoutes = require('../../../routes/pricing');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/', pricingRoutes);
  return app;
}

describe('pricing routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.eval.mockResolvedValue(1);
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue('OK');
    mockGetConnection.mockReturnValue(mockRedis);
    mockHasPaymentEligibleDriver.mockResolvedValue({
      success: true,
      hasDrivers: true,
      code: 'DRIVERS_AVAILABLE',
      candidates: 1,
      eligible: 1,
      radiusKm: 5,
      driverDistanceKm: 1.2,
      estimatedPickupEtaMin: 4
    });
    mockIsActive.mockReturnValue(false);
    mockValidateRideLocations.mockReturnValue({ valid: true });
    mockResolveTollFeeFromPricingPayload.mockReturnValue({
      tollFee: 0,
      tolls: [],
      tollCount: 0,
      source: 'leaf_toll_catalog',
      toleranceKm: 2
    });
    mockFetchDirectionsRoute.mockResolvedValue({
      cached: true,
      data: {
        distance_in_km: 9.7,
        time_in_secs: 920,
        duration_in_traffic: 980,
        polylinePoints: 'nuujC~|kgG_|B_|B_|B_|B'
      }
    });
    mockDecodePolyline.mockReturnValue([
      { latitude: -22.89, longitude: -43.32 },
      { latitude: -22.85, longitude: -43.28 }
    ]);
    mockEstimateRideFare.mockResolvedValue({
      estimatedFare: 22.15,
      normalizedCarType: 'leaf_plus',
      rateCardVersion: 'test-rate-card-v1',
      routeMetrics: {
        distanceKm: 9.7,
        durationSecs: 920
      },
      tollFee: 0,
      pricingPayload: { passenger_notice: null },
      pricingAudit: null,
      operationalState: 'NORMAL',
      scorePressao: 0,
      scoreExcecao: 0,
      exceptionalMode: null
    });
  });

  it('returns 400 when pickup/destination coordinates are missing', async () => {
    const app = createApp();
    const response = await request(app)
      .post('/pricing/quote')
      .send({
        pickupLocation: { lat: -22.97, lng: -43.18 },
        destinationLocation: { lat: null, lng: null }
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('pickup_and_destination_required');
    expect(mockEstimateRideFare).not.toHaveBeenCalled();
  });

  it('returns 503 without pricing when the server canonical route is not cached', async () => {
    mockFetchDirectionsRoute.mockResolvedValue({
      cached: false,
      cacheOnly: true,
      data: null,
      status: 'cache_miss'
    });
    const app = createApp();
    const response = await request(app)
      .post('/pricing/quote')
      .send({
        pickupLocation: { lat: -22.857, lng: -43.309 },
        destinationLocation: { lat: -22.9976583, lng: -43.3581268 },
        routeDistanceKm: 24.4,
        routeDurationSecs: 2100,
        carType: 'Leaf Plus'
      });

    expect(response.status).toBe(503);
    expect(response.body.error).toBe('canonical_route_required');
    expect(mockFetchDirectionsRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        startLoc: '-22.857,-43.309',
        destLoc: '-22.9976583,-43.3581268',
        cacheOnly: true
      })
    );
    expect(mockResolveTollFeeFromPricingPayload).not.toHaveBeenCalled();
    expect(mockEstimateRideFare).not.toHaveBeenCalled();
  });

  it('reuses the backend canonical route stored for the quote session after the traffic cache expires', async () => {
    const canonicalRoute = {
      distance_in_km: 9.7,
      time_in_secs: 920,
      duration_in_traffic: 980,
      polylinePoints: 'nuujC~|kgG_|B_|B_|B_|B'
    };
    mockFetchDirectionsRoute.mockResolvedValue({
      cached: false,
      cacheOnly: true,
      data: null,
      status: 'cache_miss'
    });
    mockRedis.get.mockResolvedValue(JSON.stringify({
      routeSignature: '-22.96600|-43.18200|-22.97400|-43.20700',
      canonicalRoute
    }));
    mockRedis.eval.mockResolvedValue(2);

    const response = await request(createApp())
      .post('/pricing/quote')
      .set('x-leaf-quote-session-id', 'passenger_quote_refresh_1')
      .send({
        pickupLocation: { lat: '-22.9660', lng: '-43.1820' },
        destinationLocation: { lat: '-22.9740', lng: '-43.2070' },
        routeDistanceKm: 0.1,
        routeDurationSecs: 1,
        routePolyline: 'client_route_must_not_be_used',
        carType: 'Leaf Plus'
      });

    expect(response.status).toBe(200);
    expect(response.headers['x-leaf-quote-route-source']).toBe('quote_session');
    expect(response.body.canonicalRouteSource).toBe('quote_session');
    expect(response.body.quoteRequestCount).toBe(2);
    expect(mockEstimateRideFare).toHaveBeenCalledWith(expect.objectContaining({
      routeDistanceKm: 9.7,
      routeDurationSecs: 980
    }));
    expect(mockRedis.get).toHaveBeenCalledWith(
      'pricing:quote-session-route:passenger_quote_refresh_1'
    );
  });

  it('rejects a stored quote-session route when its server signature does not match the requested route', async () => {
    mockFetchDirectionsRoute.mockResolvedValue({
      cached: false,
      cacheOnly: true,
      data: null,
      status: 'cache_miss'
    });
    mockRedis.get.mockResolvedValue(JSON.stringify({
      routeSignature: '-22.90000|-43.10000|-22.91000|-43.11000',
      canonicalRoute: {
        distance_in_km: 9.7,
        time_in_secs: 920,
        duration_in_traffic: 980,
        polylinePoints: 'nuujC~|kgG_|B_|B_|B_|B'
      }
    }));

    const response = await request(createApp())
      .post('/pricing/quote')
      .set('x-leaf-quote-session-id', 'passenger_quote_wrong_route_1')
      .send({
        pickupLocation: { lat: '-22.9660', lng: '-43.1820' },
        destinationLocation: { lat: '-22.9740', lng: '-43.2070' },
        carType: 'Leaf Plus'
      });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('CANONICAL_ROUTE_REQUIRED');
    expect(mockRedis.eval).not.toHaveBeenCalled();
    expect(mockEstimateRideFare).not.toHaveBeenCalled();
  });

  it('returns 422 when route exceeds operational distance guard', async () => {
    const app = createApp();
    const response = await request(app)
      .post('/pricing/quote')
      .send({
        pickupLocation: { lat: 37.7749, lng: -122.4194 },
        destinationLocation: { lat: -22.9105, lng: -43.1631 },
        carType: 'Leaf Plus'
      });

    expect(response.status).toBe(422);
    expect(response.body.error).toBe('route_distance_exceeds_limit');
    expect(mockEstimateRideFare).not.toHaveBeenCalled();
  });

  it('returns 422 when geofence validation fails for active geofence', async () => {
    mockIsActive.mockReturnValue(true);
    mockValidateRideLocations.mockReturnValue({
      valid: false,
      error: 'Destino fora da região de operação permitida'
    });

    const app = createApp();
    const response = await request(app)
      .post('/pricing/quote')
      .send({
        pickupLocation: { lat: -22.966, lng: -43.182 },
        destinationLocation: { lat: -22.91, lng: -43.16 },
        carType: 'Leaf Plus'
      });

    expect(response.status).toBe(422);
    expect(response.body.error).toBe('route_out_of_coverage');
    expect(mockEstimateRideFare).not.toHaveBeenCalled();
  });

  it('ignores client route metrics, geometry and pricing context in favor of the server route', async () => {
    const app = createApp();
    const response = await request(app)
      .post('/pricing/quote')
      .send({
        pickupLocation: { lat: '-22.9660', lng: '-43.1820' },
        destinationLocation: { lat: '-22.9740', lng: '-43.2070' },
        routeDistanceKm: 0.1,
        routeDurationSecs: 1,
        routePolyline: 'client_route_must_not_be_used',
        pricingContext: {
          trip: {
            duration_min_traffic: 1
          }
        },
        carType: 'Leaf Plus'
      });

    expect(response.status).toBe(200);
    expect(response.body.estimatedFare).toBe(22.15);
    expect(response.body.driverAvailability).toEqual(
      expect.objectContaining({
        status: 'available',
        hasDrivers: true,
        code: 'DRIVERS_AVAILABLE',
        pickupEtaMin: 4,
        driverDistanceKm: 1.2
      })
    );
    expect(response.body.quoteLockId).toMatch(/^ql_/);
    expect(response.body.quoteLockExpiresAt).toEqual(expect.any(String));
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^pricing:quote-lock:ql_/),
      expect.stringContaining('"payableAmountInCents":2215'),
      'EX',
      expect.any(Number)
    );
    expect(mockEstimateRideFare).toHaveBeenCalledWith(
      expect.objectContaining({
        pickupLocation: expect.objectContaining({ lat: -22.966, lng: -43.182 }),
        destinationLocation: expect.objectContaining({ lat: -22.974, lng: -43.207 }),
        routeDistanceKm: 9.7,
        routeDurationSecs: 980,
        pricingContext: null
      })
    );
    expect(mockResolveTollFeeFromPricingPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        routePolyline: 'nuujC~|kgG_|B_|B_|B_|B'
      })
    );
    expect(mockHasPaymentEligibleDriver).toHaveBeenCalledWith(
      expect.objectContaining({
        pickupLocation: expect.objectContaining({ lat: -22.966, lng: -43.182 }),
        destinationLocation: expect.objectContaining({ lat: -22.974, lng: -43.207 }),
        carType: 'leaf_plus',
        reserveDriver: false
      })
    );
  });

  it('resolve pedágio pela geometria antes de estimar a tarifa', async () => {
    mockResolveTollFeeFromPricingPayload.mockReturnValue({
      tollFee: 4,
      tolls: [
        {
          id: 'p09_linha_amarela',
          name: 'P09 - Linha Amarela',
          amount: 4
        }
      ],
      tollCount: 1,
      source: 'leaf_toll_catalog',
      toleranceKm: 2
    });
    mockEstimateRideFare.mockResolvedValueOnce({
      estimatedFare: 26.15,
      normalizedCarType: 'leaf_plus',
      rateCardVersion: 'test-rate-card-v1',
      routeMetrics: {
        distanceKm: 9.7,
        durationSecs: 920
      },
      tollFee: 4,
      pricingPayload: {
        final_price: 26.15,
        toll_fee: 4,
        passenger_notice: null
      },
      pricingAudit: null,
      operationalState: 'NORMAL',
      scorePressao: 0,
      scoreExcecao: 0,
      exceptionalMode: null
    });

    const app = createApp();
    const response = await request(app)
      .post('/pricing/quote')
      .send({
        pickupLocation: { lat: -22.89, lng: -43.32 },
        destinationLocation: { lat: -22.85, lng: -43.28 },
        routeDistanceKm: 9.7,
        routeDurationSecs: 920,
        routePolyline: 'client_geometry_must_be_ignored',
        carType: 'Leaf Plus'
      });

    expect(response.status).toBe(200);
    expect(mockResolveTollFeeFromPricingPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        routePolyline: 'nuujC~|kgG_|B_|B_|B_|B'
      })
    );
    expect(mockEstimateRideFare).toHaveBeenCalledWith(
      expect.objectContaining({
        tollFee: 4
      })
    );
    expect(response.body.tollFee).toBe(4);
    expect(response.body.tolls).toEqual([
      expect.objectContaining({
        id: 'p09_linha_amarela',
        amount: 4
      })
    ]);
    expect(response.body.tollDetection).toEqual(
      expect.objectContaining({
        source: 'leaf_toll_catalog',
        tollCount: 1
      })
    );
  });

  it('returns driver availability unavailable with quote when no eligible driver is nearby', async () => {
    mockHasPaymentEligibleDriver.mockResolvedValue({
      success: true,
      hasDrivers: false,
      code: 'NO_DRIVERS_AVAILABLE',
      candidates: 0,
      eligible: 0,
      radiusKm: 5
    });

    const app = createApp();
    const response = await request(app)
      .post('/pricing/quote')
      .send({
        pickupLocation: { lat: '-22.9660', lng: '-43.1820' },
        destinationLocation: { lat: '-22.9740', lng: '-43.2070' },
        routeDistanceKm: 9.7,
        routeDurationSecs: 920,
        carType: 'Leaf Plus'
      });

    expect(response.status).toBe(200);
    expect(response.body.driverAvailability).toEqual(
      expect.objectContaining({
        status: 'unavailable',
        hasDrivers: false,
        code: 'NO_DRIVERS_AVAILABLE',
        pickupEtaMin: null,
        candidates: 0,
        eligible: 0
      })
    );
  });

  it('correlates quote requests by temporary session id', async () => {
    mockRedis.eval.mockResolvedValue(2);
    const app = createApp();
    const response = await request(app)
      .post('/pricing/quote')
      .set('x-leaf-quote-session-id', 'passenger_quote_test_1')
      .send({
        pickupLocation: { lat: '-22.9660', lng: '-43.1820' },
        destinationLocation: { lat: '-22.9740', lng: '-43.2070' },
        routeDistanceKm: 9.7,
        routeDurationSecs: 920,
        carType: 'Leaf Plus'
      });

    expect(response.status).toBe(200);
    expect(response.headers['x-leaf-quote-session-id']).toBe('passenger_quote_test_1');
    expect(response.headers['x-leaf-quote-session-count']).toBe('2');
    expect(response.body.quoteSessionId).toBe('passenger_quote_test_1');
    expect(response.body.quoteRequestCount).toBe(2);
    expect(mockRedis.set).toHaveBeenCalledWith(
      'pricing:quote-session-route:passenger_quote_test_1',
      expect.stringContaining(
        '"routeSignature":"-22.96600|-43.18200|-22.97400|-43.20700"'
      ),
      'EX',
      900,
      'NX'
    );
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('INCR', KEYS[1])"),
      1,
      'pricing:quote-session:passenger_quote_test_1:leaf_plus',
      '900'
    );
    expect(mockRecordPricingQuoteRequest).toHaveBeenCalledWith({
      success: true,
      source: 'session'
    });
  });

  it('keeps the standard quote lock ttl for passengers routed to sandbox payment profile', async () => {
    const app = createApp();
    const response = await request(app)
      .post('/pricing/quote')
      .send({
        passengerId: 'passenger-sandbox',
        pickupLocation: { lat: '-22.9660', lng: '-43.1820' },
        destinationLocation: { lat: '-22.9740', lng: '-43.2070' },
        routeDistanceKm: 9.7,
        routeDurationSecs: 920,
        carType: 'Leaf Plus'
      });

    expect(response.status).toBe(200);
    expect(response.body.quoteLockTtlSeconds).toBe(120);
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^pricing:quote-lock:ql_/),
      expect.any(String),
      'EX',
      120
    );
  });

  it('caps the public quote ttl even when legacy smoke flags request a long lock', async () => {
    const previousLongTtlFlag = process.env.REAL_SMOKE_LONG_TTLS;
    process.env.REAL_SMOKE_LONG_TTLS = 'true';

    try {
      const response = await request(createApp())
        .post('/pricing/quote')
        .send({
          passengerId: 'passenger-smoke',
          pickupLocation: { lat: '-22.9660', lng: '-43.1820' },
          destinationLocation: { lat: '-22.9740', lng: '-43.2070' },
          routeDistanceKm: 9.7,
          routeDurationSecs: 920,
          carType: 'Leaf Plus'
        });

      expect(response.status).toBe(200);
      expect(response.body.quoteLockTtlSeconds).toBe(120);
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringMatching(/^pricing:quote-lock:ql_/),
        expect.any(String),
        'EX',
        120
      );
    } finally {
      if (previousLongTtlFlag === undefined) {
        delete process.env.REAL_SMOKE_LONG_TTLS;
      } else {
        process.env.REAL_SMOKE_LONG_TTLS = previousLongTtlFlag;
      }
    }
  });

  it('rejects a fourth automatic quote request for the same session and category', async () => {
    mockRedis.eval.mockResolvedValue(4);

    const response = await request(createApp())
      .post('/pricing/quote')
      .set('x-leaf-quote-session-id', 'passenger_quote_limited_1')
      .send({
        pickupLocation: { lat: '-22.9660', lng: '-43.1820' },
        destinationLocation: { lat: '-22.9740', lng: '-43.2070' },
        routeDistanceKm: 9.7,
        routeDurationSecs: 920,
        carType: 'Leaf Plus'
      });

    expect(response.status).toBe(409);
    expect(response.body).toEqual(expect.objectContaining({
      code: 'QUOTE_REFRESH_LIMIT_REACHED',
      retryable: false,
      requiresUserAction: true,
      maxAutomaticRefreshes: 2
    }));
    expect(mockEstimateRideFare).not.toHaveBeenCalled();
  });

  it('fails closed when the atomic quote refresh guard is unavailable', async () => {
    mockRedis.eval.mockRejectedValue(new Error('redis unavailable'));

    const response = await request(createApp())
      .post('/pricing/quote')
      .set('x-leaf-quote-session-id', 'passenger_quote_guard_failure_1')
      .send({
        pickupLocation: { lat: '-22.9660', lng: '-43.1820' },
        destinationLocation: { lat: '-22.9740', lng: '-43.2070' },
        routeDistanceKm: 9.7,
        routeDurationSecs: 920,
        carType: 'Leaf Plus'
      });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('QUOTE_REFRESH_GUARD_UNAVAILABLE');
    expect(mockEstimateRideFare).not.toHaveBeenCalled();
  });
});
