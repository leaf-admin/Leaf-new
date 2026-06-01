const { BackofficeSkuCostMonitorService } = require('../../../services/backoffice-sku-cost-monitor-service');

describe('backoffice-sku-cost-monitor-service', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      BACKOFFICE_INFRA_DAILY_COST_BRL: '0',
      WOOVI_PIX_CHARGE_FEE_CENTS: '0',
      BACKOFFICE_SKU_COST_WARNING_RATIO_PERCENT: '10',
      BACKOFFICE_SKU_COST_DANGER_RATIO_PERCENT: '45'
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('aggregates recent ride telemetry into SKU rows and finance projection', async () => {
    const telemetry = {
      getRecentReports: jest.fn().mockResolvedValue([
        {
          bookingId: 'ride-1',
          totals: {
            google: {
              skus: {
                placeDetailsLegacy: {
                  label: 'Places Details',
                  unit: 'request',
                  requestCount: 2,
                  billableUnits: 2,
                  estimatedCostUsd: 0.034
                },
                directionsLegacy: {
                  label: 'Directions/Routes',
                  unit: 'request',
                  requestCount: 1,
                  billableUnits: 1,
                  estimatedCostUsd: 0.005
                }
              }
            },
            backend: { attempts: 4, estimatedCostUsd: 0.000004 },
            infrastructure: {
              redis: { reads: 6, writes: 3, estimatedCostUsd: 0.000009 },
              firebase: { reads: 2, writes: 1, estimatedCostUsd: 0.000003 },
              database: { reads: 1, writes: 1, estimatedCostUsd: 0.000002 }
            }
          }
        }
      ])
    };
    const service = new BackofficeSkuCostMonitorService({ telemetry, usdBrlRate: 5 });

    const usage = await service.collectUsageSnapshot({ limit: 5 });
    const snapshot = service.attachFinancials(usage, {
      financialToday: { totalRides: 10 },
      ridesToday: { completedToday: 10 },
      operationalRevenue: { totalOperationalFee: 10, averageFee: 1 }
    });

    expect(telemetry.getRecentReports).toHaveBeenCalledWith(5);
    expect(snapshot.sampledRides).toBe(1);
    expect(snapshot.rows.find((row) => row.id === 'google.placeDetailsLegacy')).toMatchObject({
      provider: 'Google Maps',
      sku: 'Places Details',
      usage: 2,
      billableUnits: 2,
      totalCostBrl: 0.17
    });
    expect(snapshot.finance.operationalFeeTotalCents).toBe(1000);
    expect(snapshot.finance.projectedCostWithoutWooviTodayCents).toBeGreaterThan(0);
    expect(snapshot.finance.netAfterInfraCents).toBeLessThan(1000);
    expect(snapshot.status).toBe('warning');
  });

  it('returns no_data when there are no recent rides', async () => {
    const service = new BackofficeSkuCostMonitorService({
      telemetry: { getRecentReports: jest.fn().mockResolvedValue([]) },
      usdBrlRate: 5
    });

    const usage = await service.collectUsageSnapshot();
    const snapshot = service.attachFinancials(usage, {
      financialToday: { totalRides: 0 },
      operationalRevenue: { totalOperationalFee: 0 }
    });

    expect(snapshot.status).toBe('no_data');
    expect(snapshot.rows).toEqual([]);
    expect(snapshot.finance.netAfterInfraCents).toBe(0);
  });
});
