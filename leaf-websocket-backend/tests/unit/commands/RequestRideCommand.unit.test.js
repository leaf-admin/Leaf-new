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
    scoreExcecao: 0.11,
    pricingAudit: {
      originCell: '89a81082813ffff',
      baselineSource: 'redis_materialized',
      stateSource: 'redis_materialized'
    }
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
    recordCommand: jest.fn(),
    recordHotpathStageLatency: jest.fn()
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
      scoreExcecao: 0.11,
      pricingAudit: {
        originCell: '89a81082813ffff',
        baselineSource: 'redis_materialized',
        stateSource: 'redis_materialized'
      }
    });
    traceContext.runWithTraceId.mockImplementation(async (_traceId, fn) => fn());
    metrics.recordCommand.mockImplementation(() => {});
    metrics.recordHotpathStageLatency.mockImplementation(() => {});
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
    expect(rideQueueManager.enqueueRide).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: expect.stringMatching(/^booking_/),
        estimatedFare: 18.4,
        estimatedOperationalFee: expect.any(Number),
        estimatedPaymentIntermediationFee: expect.any(Number),
        estimatedTotalFees: expect.any(Number),
        estimatedDriverNetAmount: expect.any(Number),
        pricingSnapshotLocked: true,
        pricingSnapshotLockedAt: expect.any(String),
        routeDistanceKm: 5.2,
        routeDurationSecs: 780,
        pricingPayload: expect.objectContaining({
          final_price: 18.4,
          operational_state: 'PRESSAO'
        }),
        pricingAudit: expect.objectContaining({
          originCell: '89a81082813ffff',
          baselineSource: 'redis_materialized'
        }),
        operationalState: 'PRESSAO',
        scorePressao: 0.32,
        scoreExcecao: 0.11
      }),
      expect.objectContaining({
        deferEventSourcing: true
      })
    );
    expect(result.data.bookingData).toEqual(expect.objectContaining({
      estimatedFare: 18.4,
      estimatedOperationalFee: expect.any(Number),
      estimatedPaymentIntermediationFee: expect.any(Number),
      estimatedTotalFees: expect.any(Number),
      estimatedDriverNetAmount: expect.any(Number),
      pricingSnapshotLocked: true,
      pricingSnapshotLockedAt: expect.any(String),
      pricingPayload: expect.objectContaining({
        passenger_notice: 'Alta demanda nesta região'
      }),
      pricingAudit: expect.objectContaining({
        stateSource: 'redis_materialized'
      }),
      operationalState: 'PRESSAO'
    }));
    expect(result.data.perfBreakdownMs).toEqual(expect.objectContaining({
      validate: expect.any(Number),
      prepare: expect.any(Number),
      fareEstimation: expect.any(Number),
      bookingPayload: expect.any(Number),
      enqueue: expect.any(Number),
      stateUpdate: expect.any(Number),
      eventBuild: expect.any(Number),
      total: expect.any(Number)
    }));
    expect(result.data.event.type).toBe('ride.requested');
  });

  test('deve preservar metadados de pagamento embedado no bookingData ativo', async () => {
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
      paymentStatus: 'confirmed',
      paymentId: 'charge_123',
      paymentData: {
        chargeId: 'charge_123',
        rideId: 'ride_123',
        amountInCents: 1840,
        paymentStatus: 'confirmed',
        serverValidated: true,
        confirmedAt: '2026-04-07T23:59:00.000Z'
      }
    });

    const result = await command.execute();

    expect(result.success).toBe(true);
    expect(rideQueueManager.enqueueRide).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentStatus: 'confirmed',
        paymentChargeId: 'charge_123',
        paymentReferenceRideId: 'ride_123',
        paymentAmountInCents: 1840,
        paymentConfirmedAt: '2026-04-07T23:59:00.000Z'
      }),
      expect.objectContaining({
        deferEventSourcing: true
      })
    );
    expect(result.data.bookingData).toEqual(expect.objectContaining({
      paymentStatus: 'confirmed',
      paymentChargeId: 'charge_123',
      paymentReferenceRideId: 'ride_123',
      paymentAmountInCents: 1840,
      paymentConfirmedAt: '2026-04-07T23:59:00.000Z'
    }));
    expect(result.data.event).toEqual(expect.objectContaining({
      paymentStatus: 'confirmed'
    }));
  });

  test('deve travar tarifa e repasse pelo valor confirmado do pagamento server-side', async () => {
    fareEstimationService.estimateRideFare.mockResolvedValueOnce({
      estimatedFare: 14.76,
      routeMetrics: {
        distanceKm: 3.98,
        durationSecs: 512,
        source: 'client_route_metrics'
      },
      tollFee: 0,
      pricingPayload: {
        final_price: 14.76,
        operational_state: 'PRESSAO'
      },
      operationalState: 'PRESSAO',
      scorePressao: 0.345,
      scoreExcecao: 0.3,
      pricingAudit: {}
    });

    const command = new RequestRideCommand({
      customerId: 'customer_123',
      pickupLocation: { lat: -22.9846, lng: -43.2041 },
      destinationLocation: { lat: -22.96731, lng: -43.17933 },
      estimatedFare: 14.22,
      routeDistanceKm: 3.98,
      routeDurationSecs: 512,
      tollFee: 0,
      carType: 'Leaf Plus',
      paymentMethod: 'pix',
      paymentStatus: 'in_holding',
      paymentId: 'qa_bypass_123',
      paymentData: {
        chargeId: 'qa_bypass_123',
        rideId: 'ride_123',
        amountInCents: 1422,
        paymentStatus: 'in_holding',
        serverValidated: true,
        confirmedAt: '2026-05-11T19:53:35.740Z'
      }
    });

    const result = await command.execute();

    expect(result.success).toBe(true);
    expect(rideQueueManager.enqueueRide).toHaveBeenCalledWith(
      expect.objectContaining({
        estimatedFare: 14.22,
        paymentAmountInCents: 1422,
        estimatedOperationalFee: 0.99,
        estimatedPaymentIntermediationFee: 0.5,
        estimatedTotalFees: 1.49,
        estimatedDriverNetAmount: 12.73,
        pricingPayload: expect.objectContaining({
          final_price: 14.22,
          payment_amount_locked: true,
          server_estimated_final_price: 14.76
        })
      }),
      expect.objectContaining({
        deferEventSourcing: true
      })
    );
    expect(result.data.bookingData).toEqual(expect.objectContaining({
      estimatedFare: 14.22,
      estimatedDriverNetAmount: 12.73
    }));
    expect(result.data.event).toEqual(expect.objectContaining({
      estimatedFare: 14.22,
      estimatedDriverNetAmount: 12.73
    }));
  });

  test('deve manter pagamento pendente quando cliente envia status pago sem validação server-side', async () => {
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
      paymentStatus: 'confirmed',
      paymentId: 'charge_unsafe_client',
      paymentData: {
        chargeId: 'charge_unsafe_client',
        rideId: 'ride_unsafe_client',
        amountInCents: 1840,
        paymentStatus: 'confirmed'
      }
    });

    const result = await command.execute();

    expect(result.success).toBe(true);
    expect(rideQueueManager.enqueueRide).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentStatus: 'pending_payment',
        paymentChargeId: 'charge_unsafe_client',
        paymentReferenceRideId: 'ride_unsafe_client',
        paymentAmountInCents: 1840
      }),
      expect.objectContaining({
        deferEventSourcing: true
      })
    );
    expect(result.data.bookingData).toEqual(expect.objectContaining({
      paymentStatus: 'pending_payment',
      status: 'AWAITING_PAYMENT'
    }));
    expect(result.data.event).toEqual(expect.objectContaining({
      paymentStatus: 'pending_payment'
    }));
  });
});
