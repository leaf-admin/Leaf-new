jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockRedis = {
  incr: jest.fn(),
  expire: jest.fn(),
  set: jest.fn()
};
const mockGetConnection = jest.fn(() => mockRedis);
const mockEstimateRideFare = jest.fn();
const mockIsActive = jest.fn(() => false);
const mockValidateRideLocations = jest.fn(() => ({ valid: true }));
const mockRecordPricingQuoteRequest = jest.fn();

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: () => mockGetConnection()
}));

jest.mock('../../../services/fare-estimation-service', () => ({
  estimateRideFare: (...args) => mockEstimateRideFare(...args)
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
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);
    mockRedis.set.mockResolvedValue('OK');
    mockGetConnection.mockReturnValue(mockRedis);
    mockIsActive.mockReturnValue(false);
    mockValidateRideLocations.mockReturnValue({ valid: true });
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

  it('returns quote for valid route and normalized coordinates', async () => {
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
    expect(response.body.estimatedFare).toBe(22.15);
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
        destinationLocation: expect.objectContaining({ lat: -22.974, lng: -43.207 })
      })
    );
  });

  it('correlates quote requests by temporary session id', async () => {
    mockRedis.incr.mockResolvedValue(2);
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
    expect(mockRedis.incr).toHaveBeenCalledWith(
      'pricing:quote-session:passenger_quote_test_1'
    );
    expect(mockRedis.expire).toHaveBeenCalledWith(
      'pricing:quote-session:passenger_quote_test_1',
      900
    );
    expect(mockRecordPricingQuoteRequest).toHaveBeenCalledWith({
      success: true,
      source: 'session'
    });
  });
});
