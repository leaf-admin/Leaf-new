const {
  MODEL_VERSION,
  buildDemandPrediction,
  resolveDemandLevel
} = require('../../../services/demand-prediction-service');

describe('demand-prediction-service', () => {
  it('classifies severe demand imbalance and recommends driver smart push', () => {
    const prediction = buildDemandPrediction({
      h3: '89a8a0a',
      city: 'rio_de_janeiro',
      areaLabel: 'Barra da Tijuca',
      current: {
        openRequests: 14,
        availableDrivers: 2,
        requestsLast15m: 16,
        avgPickupEtaMin: 11
      },
      baseline: {
        expectedRequests15m: 4,
        expectedAvailableDrivers: 8
      },
      generatedAt: '2026-05-19T12:00:00.000Z'
    });

    expect(prediction.modelVersion).toBe(MODEL_VERSION);
    expect(prediction.level).toBe('critical');
    expect(prediction.score).toBeGreaterThanOrEqual(0.82);
    expect(prediction.smartPush.allowed).toBe(true);
    expect(prediction.smartPush.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          audience: 'drivers',
          templateId: 'driver_demand_critical',
          priority: 'high'
        })
      ])
    );
  });

  it('keeps low demand quiet to avoid noisy pushes', () => {
    const prediction = buildDemandPrediction({
      areaLabel: 'Centro',
      current: {
        openRequests: 1,
        availableDrivers: 12,
        requestsLast15m: 2,
        avgPickupEtaMin: 3
      },
      baseline: {
        expectedRequests15m: 6,
        expectedAvailableDrivers: 9
      }
    });

    expect(prediction.level).toBe('low');
    expect(prediction.smartPush.allowed).toBe(false);
    expect(prediction.smartPush.recommendations).toEqual([]);
  });

  it('can include passenger smart push when behavior signals are eligible', () => {
    const prediction = buildDemandPrediction({
      areaLabel: 'Shopping Leblon',
      current: {
        openRequests: 5,
        availableDrivers: 3,
        requestsLast15m: 8,
        avgPickupEtaMin: 8
      },
      baseline: {
        expectedRequests15m: 4,
        expectedAvailableDrivers: 4
      },
      behavior: {
        userId: 'customer_1',
        lastRideHoursAgo: 48,
        favoriteZoneMatch: true,
        smartPushOptIn: true
      }
    });

    expect(prediction.smartPush.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          audience: 'passengers',
          templateId: 'passenger_favorite_zone_active'
        })
      ])
    );
  });

  it('uses stable score thresholds', () => {
    expect(resolveDemandLevel(0.2)).toBe('low');
    expect(resolveDemandLevel(0.4)).toBe('medium');
    expect(resolveDemandLevel(0.7)).toBe('high');
    expect(resolveDemandLevel(0.9)).toBe('critical');
  });
});
