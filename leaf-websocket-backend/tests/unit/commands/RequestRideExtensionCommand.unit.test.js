jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn()
}));

jest.mock('../../../services/ride-state-manager', () => ({
  STATES: {
    IN_PROGRESS: 'IN_PROGRESS',
    REASSIGNED_IN_PROGRESS: 'REASSIGNED_IN_PROGRESS'
  },
  getBookingState: jest.fn()
}));

jest.mock('../../../services/event-sourcing', () => ({
  recordEvent: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../services/fare-estimation-service', () => ({
  estimateRideFare: jest.fn()
}));

jest.mock('../../../utils/trace-context', () => ({
  runWithTraceId: jest.fn(async (_traceId, fn) => fn())
}));

jest.mock('../../../utils/trace-validator', () => ({
  validateAndEnsureTraceIdInCommand: jest.fn(() => 'trace_test')
}));

jest.mock('../../../utils/prometheus-metrics', () => ({
  metrics: {
    recordCommand: jest.fn()
  }
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn()
}));

const redisPool = require('../../../utils/redis-pool');
const RideStateManager = require('../../../services/ride-state-manager');
const eventSourcing = require('../../../services/event-sourcing');
const fareEstimationService = require('../../../services/fare-estimation-service');
const RequestRideExtensionCommand = require('../../../commands/RequestRideExtensionCommand');

function buildRedisMock({ bookingHash, activeBooking }) {
  const activeBookingRaw = JSON.stringify(activeBooking);
  const pipeline = {
    hset: jest.fn(() => pipeline),
    hget: jest.fn(() => pipeline),
    exec: jest.fn().mockResolvedValue([
      [null, 1],
      [null, activeBookingRaw]
    ])
  };
  const redis = {
    hgetall: jest.fn(async (key) => (key === 'booking:booking_1' ? bookingHash : {})),
    hget: jest.fn(async (key) => (key === 'bookings:active' ? activeBookingRaw : null)),
    hset: jest.fn().mockResolvedValue(1),
    multi: jest.fn(() => pipeline)
  };

  return { redis, pipeline };
}

describe('RequestRideExtensionCommand', () => {
  let bookingHash;
  let activeBooking;
  let redis;
  let pipeline;
  let previousRouteRecalculationCostCents;

  beforeEach(() => {
    jest.clearAllMocks();
    previousRouteRecalculationCostCents = process.env.RIDE_EXTENSION_ROUTE_RECALCULATION_COST_CENTS;
    process.env.RIDE_EXTENSION_ROUTE_RECALCULATION_COST_CENTS = '25';
    bookingHash = {
      customerId: 'customer_1',
      driverId: 'driver_1',
      status: 'IN_PROGRESS',
      estimatedFare: '80.00',
      carType: 'Leaf Plus',
      pickupLocation: JSON.stringify({ lat: -22.9, lng: -43.2, add: 'Origem' }),
      currentLocation: JSON.stringify({ lat: -22.91, lng: -43.21, add: 'Local atual' }),
      tollFee: '0'
    };
    activeBooking = {
      bookingId: 'booking_1',
      customerId: 'customer_1',
      driverId: 'driver_1',
      status: 'IN_PROGRESS',
      estimate: 80,
      currentLocation: { lat: -22.91, lng: -43.21, add: 'Local atual' }
    };
    ({ redis, pipeline } = buildRedisMock({ bookingHash, activeBooking }));
    redisPool.getConnection.mockReturnValue(redis);
    RideStateManager.getBookingState.mockResolvedValue('IN_PROGRESS');
    fareEstimationService.estimateRideFare.mockResolvedValue({
      estimatedFare: 91.23,
      routeMetrics: {
        distanceKm: 12.4,
        durationSecs: 1500,
        source: 'backend_extension_estimate'
      },
      pricingPayload: {
        final_price: 91.23,
        operational_state: 'NORMAL'
      },
      pricingAudit: {
        rateCardVersion: 'v1'
      }
    });
  });

  afterEach(() => {
    if (previousRouteRecalculationCostCents === undefined) {
      delete process.env.RIDE_EXTENSION_ROUTE_RECALCULATION_COST_CENTS;
    } else {
      process.env.RIDE_EXTENSION_ROUTE_RECALCULATION_COST_CENTS = previousRouteRecalculationCostCents;
    }
  });

  it('uses the backend fare estimate as the authoritative extension fare', async () => {
    const command = new RequestRideExtensionCommand({
      bookingId: 'booking_1',
      customerId: 'customer_1',
      newEndLocation: { lat: -22.99, lng: -43.31, add: 'Novo destino' },
      newFare: 91,
      routeDistanceKm: 12.3,
      routeDurationSecs: 1480
    });

    const result = await command.execute();

    expect(result.success).toBe(true);
    expect(result.data.newFare).toBe(91.23);
    expect(result.data.fareDelta).toBe(11.23);
    expect(result.data.diffFare).toBe(11.98);
    expect(result.data.passengerPayableFare).toBe(91.98);
    expect(result.data.extensionOperationalCost).toBe(0.75);
    expect(result.data.routeRecalculationCost).toBe(0.25);
    expect(result.data.paymentIntermediationFee).toBe(0.5);
    expect(fareEstimationService.estimateRideFare).toHaveBeenCalledWith(expect.objectContaining({
      redis,
      pickupLocation: expect.objectContaining({ lat: -22.91, lng: -43.21 }),
      destinationLocation: expect.objectContaining({ lat: -22.99, lng: -43.31 }),
      carType: 'Leaf Plus',
      clientEstimatedFare: 91
    }));
    const persistedPatch = pipeline.hset.mock.calls[0][1];
    const extensionRequest = JSON.parse(persistedPatch.activeExtensionRequest);
    expect(extensionRequest).toEqual(expect.objectContaining({
      newFare: 91.23,
      fareDelta: 11.23,
      diffFare: 11.98,
      passengerPayableFare: 91.98,
      paymentAmountBeforeExtensionCents: 8000,
      extensionChargeAmountCents: 1198,
      extensionOperationalCostCents: 75,
      routeRecalculationCostCents: 25,
      paymentIntermediationFeeCents: 50,
      requestedClientFare: 91,
      serverEstimatedFare: 91.23,
      fareAuthority: 'backend_extension_estimate'
    }));
    expect(eventSourcing.recordEvent).toHaveBeenCalledWith(
      'ride.updated',
      expect.objectContaining({
        type: 'EXTENSION_REQUESTED',
        extensionRequest: expect.objectContaining({
          fareAuthority: 'backend_extension_estimate'
        })
      })
    );
  });

  it('blocks extension requests when the client fare diverges from backend pricing', async () => {
    const command = new RequestRideExtensionCommand({
      bookingId: 'booking_1',
      customerId: 'customer_1',
      newEndLocation: { lat: -22.99, lng: -43.31, add: 'Novo destino' },
      newFare: 140
    });

    const result = await command.execute();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Tarifa da extensão diverge');
    expect(pipeline.hset).not.toHaveBeenCalled();
    expect(eventSourcing.recordEvent).not.toHaveBeenCalled();
  });
});
