jest.mock('../../../services/h3-map-service', () => ({
  collectSnapshot: jest.fn()
}));

jest.mock('../../../services/pricing-context-provider', () => ({
  buildDerivedPricingContext: jest.fn(),
  recordPricingEvaluation: jest.fn()
}));

jest.mock('../../../services/pricing', () => ({
  runDynamicPricingEngine: jest.fn()
}));

jest.mock('../../../utils/prometheus-metrics', () => ({
  metrics: {
    recordPricingEvaluation: jest.fn()
  }
}));

const h3 = require('h3-js');
const h3MapService = require('../../../services/h3-map-service');
const pricingContextProvider = require('../../../services/pricing-context-provider');
const { runDynamicPricingEngine } = require('../../../services/pricing');
const { materializePricingBaselines } = require('../../../services/pricing-baseline-materializer');

describe('pricing-baseline-materializer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('materializa células candidatas e resume estados operacionais', async () => {
    const cell = h3.latLngToCell(-22.9075, -43.1736, 9);

    h3MapService.collectSnapshot.mockResolvedValue({
      drivers: [{ location: { lat: -22.9075, lng: -43.1736 } }],
      openRequests: [{ pickupLocation: { lat: -22.9075, lng: -43.1736 } }],
      activeTrips: []
    });

    pricingContextProvider.buildDerivedPricingContext.mockResolvedValue({
      pricingContext: {
        trip: {
          distance_km: 1.5,
          duration_min_traffic: 4,
          eta_pickup_min: 5
        },
        operational: {
          current: {
            active_requests_5m: 2,
            idle_drivers: 1,
            avg_pickup_eta_min: 5,
            trip_time_inflation: 1.2,
            cancel_rate: 0.08,
            accept_rate: 0.82,
            avg_speed_kmh: 21
          },
          baseline: {
            expected_requests_5m: 1,
            expected_idle_drivers: 2,
            expected_pickup_eta_min: 4,
            expected_speed_kmh: 24,
            expected_cancel_rate: 0.05
          },
          state_context: {
            now: '2026-03-30T12:34:00.000Z'
          }
        }
      },
      metadata: {
        originCell: cell,
        baselineSource: 'redis_materialized',
        nowIso: '2026-03-30T12:34:00.000Z'
      }
    });

    runDynamicPricingEngine.mockReturnValue({
      pricingPayload: {
        operational_state: 'PRESSAO',
        dynamic_percentage: 7.5,
        minimum_fare_applied: false,
        score_pressao: 0.42,
        score_excecao: 0.18
      },
      exceptionalMode: {
        exceptional_mode_active: false
      }
    });

    const summary = await materializePricingBaselines({
      redis: { mocked: true },
      maxCells: 10,
      nowIso: '2026-03-30T12:34:00.000Z'
    });

    expect(summary.candidateCells).toBe(1);
    expect(summary.processedCells).toBe(1);
    expect(summary.failedCells).toBe(0);
    expect(summary.operationalStates.PRESSAO).toBe(1);
    expect(summary.baselineSources.redis_materialized).toBe(1);
    expect(pricingContextProvider.recordPricingEvaluation).toHaveBeenCalledTimes(1);
  });
});
