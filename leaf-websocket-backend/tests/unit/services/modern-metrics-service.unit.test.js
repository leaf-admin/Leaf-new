jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn(() => ({
    hgetall: jest.fn().mockResolvedValue({}),
    hlen: jest.fn().mockResolvedValue(0),
    scard: jest.fn().mockResolvedValue(0),
    hget: jest.fn().mockResolvedValue('0')
  }))
}));

describe('modern-metrics-service rounding', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('getRidesStats rounds totalValue to two decimals', async () => {
    const firestoreMock = {
      collection: jest.fn(() => ({
        where: jest.fn(() => ({
          where: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({
              docs: [
                {
                  id: 'ride-1',
                  data: () => ({
                    status: 'COMPLETED',
                    createdAt: new Date('2026-04-06T10:00:00Z'),
                    finalPrice: 10.13,
                    authoritativeSnapshot: true,
                    financialSnapshotSource: 'backend_final'
                  })
                },
                {
                  id: 'ride-2',
                  data: () => ({
                    status: 'PAID',
                    createdAt: new Date('2026-04-06T10:10:00Z'),
                    finalPrice: 12.57,
                    authoritativeSnapshot: true,
                    financialSnapshotSource: 'backend_final'
                  })
                },
                {
                  id: 'ride-3',
                  data: () => ({
                    status: 'COMPLETED',
                    createdAt: new Date('2026-04-06T10:20:00Z'),
                    finalPrice: 226.96999999999997,
                    authoritativeSnapshot: true,
                    financialSnapshotSource: 'backend_final'
                  })
                }
              ]
            })
          }))
        }))
      }))
    };

    jest.doMock('../../../firebase-config', () => ({
      getFirestore: () => firestoreMock
    }));

    const service = require('../../../services/modern-metrics-service');
    const result = await service.getRidesStats({ period: 'today' });

    expect(result.totalValue).toBe(249.67);
    expect(result.averageValue).toBe(83.22);
  });

  test('getFinancialRidesStats rounds totalValue to two decimals', async () => {
    const firestoreMock = {
      collection: jest.fn(() => ({
        where: jest.fn(() => ({
          where: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({
              docs: [
                {
                  id: 'ride-1',
                  data: () => ({
                    status: 'COMPLETED',
                    createdAt: new Date('2026-04-06T10:00:00Z'),
                    finalPrice: 100.105,
                    authoritativeSnapshot: true,
                    financialSnapshotSource: 'backend_final'
                  })
                },
                {
                  id: 'ride-2',
                  data: () => ({
                    status: 'PAID',
                    createdAt: new Date('2026-04-06T10:10:00Z'),
                    finalPrice: 50.205,
                    authoritativeSnapshot: true,
                    financialSnapshotSource: 'backend_final'
                  })
                }
              ]
            })
          }))
        }))
      }))
    };

    jest.doMock('../../../firebase-config', () => ({
      getFirestore: () => firestoreMock
    }));

    const service = require('../../../services/modern-metrics-service');
    const result = await service.getFinancialRidesStats({ period: 'today' });

    expect(result.totalValue).toBe(150.31);
    expect(result.averageValue).toBe(75.16);
    expect(result.reconciledRides).toBe(2);
    expect(result.pendingReconciliationRides).toBe(0);
  });

  test('getFinancialRidesStats excludes completed rides without backend_final snapshot from money totals', async () => {
    const firestoreMock = {
      collection: jest.fn(() => ({
        where: jest.fn(() => ({
          where: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({
              docs: [
                {
                  id: 'ride-final',
                  data: () => ({
                    status: 'COMPLETED',
                    createdAt: new Date('2026-04-06T10:00:00Z'),
                    finalPrice: 81.17,
                    authoritativeSnapshot: true,
                    financialSnapshotSource: 'backend_final'
                  })
                },
                {
                  id: 'ride-pending',
                  data: () => ({
                    status: 'COMPLETED',
                    createdAt: new Date('2026-04-06T10:10:00Z'),
                    finalPrice: 27.5,
                    estimatedFare: 27.5
                  })
                }
              ]
            })
          }))
        }))
      }))
    };

    jest.doMock('../../../firebase-config', () => ({
      getFirestore: () => firestoreMock
    }));

    const service = require('../../../services/modern-metrics-service');
    const result = await service.getFinancialRidesStats({ period: 'today' });

    expect(result.totalRides).toBe(2);
    expect(result.reconciledRides).toBe(1);
    expect(result.pendingReconciliationRides).toBe(1);
    expect(result.totalValue).toBe(81.17);
    expect(result.averageValue).toBe(81.17);
  });
});
