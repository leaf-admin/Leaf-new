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
                { id: 'ride-1', data: () => ({ status: 'COMPLETED', createdAt: new Date('2026-04-06T10:00:00Z'), finalPrice: 10.13 }) },
                { id: 'ride-2', data: () => ({ status: 'PAID', createdAt: new Date('2026-04-06T10:10:00Z'), finalPrice: 12.57 }) },
                { id: 'ride-3', data: () => ({ status: 'COMPLETED', createdAt: new Date('2026-04-06T10:20:00Z'), finalPrice: 226.96999999999997 }) }
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
                { id: 'ride-1', data: () => ({ status: 'COMPLETED', createdAt: new Date('2026-04-06T10:00:00Z'), finalPrice: 100.105 }) },
                { id: 'ride-2', data: () => ({ status: 'PAID', createdAt: new Date('2026-04-06T10:10:00Z'), finalPrice: 50.205 }) }
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
  });
});
