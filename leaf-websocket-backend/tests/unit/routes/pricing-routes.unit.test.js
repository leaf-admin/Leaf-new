jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockGetConnection = jest.fn(() => ({}));
const mockEstimateRideFare = jest.fn();
const mockIsActive = jest.fn(() => false);
const mockValidateRideLocations = jest.fn(() => ({ valid: true }));

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
    recordPricingEvaluation: jest.fn()
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
    mockGetConnection.mockReturnValue({});
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
    expect(mockEstimateRideFare).toHaveBeenCalledWith(
      expect.objectContaining({
        pickupLocation: expect.objectContaining({ lat: -22.966, lng: -43.182 }),
        destinationLocation: expect.objectContaining({ lat: -22.974, lng: -43.207 })
      })
    );
  });
});
