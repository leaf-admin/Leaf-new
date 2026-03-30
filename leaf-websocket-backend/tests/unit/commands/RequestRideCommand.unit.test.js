jest.mock('../../../services/ride-queue-manager', () => ({
  enqueueRide: jest.fn().mockResolvedValue({
    success: true,
    regionHash: 'abcde',
    bookingId: 'booking_mocked'
  })
}));

jest.mock('../../../services/ride-state-manager', () => ({
  STATES: {
    SEARCHING: 'SEARCHING'
  },
  updateBookingState: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn(() => ({ mocked: true }))
}));

jest.mock('../../../utils/geohash-utils', () => ({
  getRegionHash: jest.fn(() => 'abcde')
}));

jest.mock('../../../services/geofence-service', () => ({
  isActive: jest.fn(() => false),
  validateRideLocations: jest.fn(() => ({ valid: true }))
}));

jest.mock('../../../services/fare-estimation-service', () => ({
  estimateRideFare: jest.fn(async () => ({
    estimatedFare: 18.4,
    routeMetrics: {
      distanceKm: 5.2,
      durationSecs: 780,
      source: 'client_route_metrics'
    },
    tollFee: 0,
    clientFare: 17,
    fareDiff: 1.4,
    pricingPayload: {
      final_price: 18.4,
      score_pressao: 0.32,
      score_excecao: 0.11,
      operational_state: 'PRESSAO',
      passenger_notice: 'Alta demanda nesta região',
      driver_region_status: {
        state: 'PRESSAO',
        opportunity_level: 'MEDIUM',
        recommended_repositioning: true
      }
    },
    operationalState: 'PRESSAO',
    scorePressao: 0.32,
    scoreExcecao: 0.11
  }))
}));

jest.mock('../../../events/ride.requested', () => {
  return jest.fn().mockImplementation((data) => ({
    toJSON: () => ({ ...data, type: 'ride.requested' })
  }));
});

jest.mock('../../../utils/trace-context', () => ({
  runWithTraceId: jest.fn(async (_traceId, fn) => fn()),
  getCurrentTraceId: jest.fn(() => 'trace_test')
}));

jest.mock('../../../utils/trace-validator', () => ({
  validateAndEnsureTraceIdInCommand: jest.fn(() => 'trace_test')
}));

jest.mock('../../../utils/prometheus-metrics', () => ({
  metrics: {
    recordCommand: jest.fn()
  }
}));

const rideQueueManager = require('../../../services/ride-queue-manager');
const fareEstimationService = require('../../../services/fare-estimation-service');
const RideStateManager = require('../../../services/ride-state-manager');
const redisPool = require('../../../utils/redis-pool');
const GeoHashUtils = require('../../../utils/geohash-utils');
const geofenceService = require('../../../services/geofence-service');
const traceContext = require('../../../utils/trace-context');
const { metrics } = require('../../../utils/prometheus-metrics');
const RideRequestedEvent = require('../../../events/ride.requested');
const RequestRideCommand = require('../../../commands/RequestRideCommand');

describe('RequestRideCommand', () => {
  beforeEach(() => {
    rideQueueManager.enqueueRide.mockResolvedValue({
      success: true,
      regionHash: 'abcde',
      bookingId: 'booking_mocked'
    });
    RideStateManager.updateBookingState.mockResolvedValue(undefined);
    redisPool.ensureConnection.mockResolvedValue(undefined);
    redisPool.getConnection.mockReturnValue({ mocked: true });
    GeoHashUtils.getRegionHash.mockReturnValue('abcde');
    geofenceService.isActive.mockReturnValue(false);
    geofenceService.validateRideLocations.mockReturnValue({ valid: true });
    RideRequestedEvent.mockImplementation((data) => ({
      toJSON: () => ({ ...data, type: 'ride.requested' })
    }));
    fareEstimationService.estimateRideFare.mockResolvedValue({
      estimatedFare: 18.4,
      routeMetrics: {
        distanceKm: 5.2,
        durationSecs: 780,
        source: 'client_route_metrics'
      },
      tollFee: 0,
      clientFare: 17,
      fareDiff: 1.4,
      pricingPayload: {
        final_price: 18.4,
        score_pressao: 0.32,
        score_excecao: 0.11,
        operational_state: 'PRESSAO',
        passenger_notice: 'Alta demanda nesta região',
        driver_region_status: {
          state: 'PRESSAO',
          opportunity_level: 'MEDIUM',
          recommended_repositioning: true
        }
      },
      operationalState: 'PRESSAO',
      scorePressao: 0.32,
      scoreExcecao: 0.11
    });
    traceContext.runWithTraceId.mockImplementation(async (_traceId, fn) => fn());
    metrics.recordCommand.mockImplementation(() => {});
  });

  test('deve enriquecer bookingData com pricingPayload sem quebrar ride.requested', async () => {
    const command = new RequestRideCommand({
      customerId: 'customer_123',
      pickupLocation: { lat: -22.9, lng: -43.17 },
      destinationLocation: { lat: -22.91, lng: -43.18 },
      estimatedFare: 17,
      routeDistanceKm: 5,
      routeDurationSecs: 780,
      tollFee: 0,
      carType: 'Leaf Plus',
      paymentMethod: 'pix',
      pricingContext: {
        operational: {
          current: { active_requests_5m: 8, idle_drivers: 4 }
        }
      }
    });

    const result = await command.execute();

    expect(result.success).toBe(true);
    expect(fareEstimationService.estimateRideFare).toHaveBeenCalledWith(expect.objectContaining({
      redis: { mocked: true },
      pricingContext: {
        operational: {
          current: { active_requests_5m: 8, idle_drivers: 4 }
        }
      }
    }));
    expect(rideQueueManager.enqueueRide).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: expect.stringMatching(/^booking_/),
      estimatedFare: 18.4,
      routeDistanceKm: 5.2,
      routeDurationSecs: 780,
      pricingPayload: expect.objectContaining({
        final_price: 18.4,
        operational_state: 'PRESSAO'
      }),
      operationalState: 'PRESSAO',
      scorePressao: 0.32,
      scoreExcecao: 0.11
    }));
    expect(result.data.bookingData).toEqual(expect.objectContaining({
      estimatedFare: 18.4,
      pricingPayload: expect.objectContaining({
        passenger_notice: 'Alta demanda nesta região'
      }),
      operationalState: 'PRESSAO'
    }));
    expect(result.data.event.type).toBe('ride.requested');
  });
});
