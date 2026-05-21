jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockAuthenticateJWT = jest.fn((req, _res, next) => {
  req.user = {
    id: 'admin_1',
    role: 'admin',
    email: 'admin@leaf.test'
  };
  next();
});
const mockRequireRole = jest.fn(() => (_req, _res, next) => next());
const mockLogStructured = jest.fn();
const mockLogError = jest.fn();
const mockRedisConnection = { pipeline: jest.fn() };
const mockGetAggregatedCells = jest.fn();

jest.mock('../../../middleware/jwt-auth', () => ({
  authenticateJWT: mockAuthenticateJWT,
  requireRole: mockRequireRole
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: mockLogStructured,
  logError: mockLogError
}));

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn(() => mockRedisConnection)
}));

jest.mock('../../../services/pricing-h3-read-model-service', () => ({
  DEFAULT_RESOLUTION: 8,
  getAggregatedCells: mockGetAggregatedCells
}));

function createApp() {
  const demandRoutes = require('../../../routes/demand-predictions');
  const app = express();
  app.use(express.json());
  app.use('/api/demand', demandRoutes);
  return app;
}

describe('demand prediction routes', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAggregatedCells.mockResolvedValue({
      usable: false,
      reason: 'empty',
      cells: []
    });
    process.env = { ...originalEnv };
    delete process.env.ENABLE_DEMAND_PREDICTION;
    process.env.LEAF_LAUNCH_PROFILE = 'pilot_controlled';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('keeps prediction preview behind the launch feature flag', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/demand/predictions/preview')
      .send({
        current: { openRequests: 10, availableDrivers: 2 }
      });

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      code: 'FEATURE_DISABLED_IN_LAUNCH_PROFILE',
      feature: 'demand_prediction'
    });
    expect(mockAuthenticateJWT).toHaveBeenCalled();
    expect(mockRequireRole).toHaveBeenCalledWith(['admin', 'super-admin', 'manager', 'development']);
    expect(mockLogStructured).toHaveBeenCalledWith(
      'warn',
      'Preview de demanda bloqueado por feature flag',
      expect.objectContaining({
        service: 'demand-predictions',
        operation: 'preview',
        adminUserId: 'admin_1'
      })
    );
  });

  it('returns a production-shaped prediction envelope when explicitly enabled', async () => {
    process.env.ENABLE_DEMAND_PREDICTION = 'true';
    const app = createApp();

    const response = await request(app)
      .post('/api/demand/predictions/preview')
      .send({
        h3: '89a8a0a',
        city: 'rio_de_janeiro',
        areaLabel: 'Leblon',
        current: {
          openRequests: 14,
          availableDrivers: 2,
          requestsLast15m: 16,
          avgPickupEtaMin: 11
        },
        baseline: {
          expectedRequests15m: 4,
          expectedAvailableDrivers: 8
        }
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.prediction).toEqual(
      expect.objectContaining({
        modelVersion: 'leaf-demand-v0.1-heuristic',
        level: 'critical',
        smartPush: expect.objectContaining({
          allowed: true
        })
      })
    );
    expect(mockLogStructured).toHaveBeenCalledWith(
      'info',
      'Preview de demanda gerado',
      expect.objectContaining({
        service: 'demand-predictions',
        operation: 'preview',
        adminUserId: 'admin_1',
        demandLevel: 'critical',
        smartPushAllowed: true
      })
    );
  });

  it('can source current demand from the live H3 read model', async () => {
    process.env.ENABLE_DEMAND_PREDICTION = 'true';
    mockGetAggregatedCells.mockResolvedValueOnce({
      usable: true,
      reason: 'ok',
      lastMutationAt: '2026-05-19T12:00:00.000Z',
      cells: [
        {
          h3Index: '89a8a0a',
          resolution: 8,
          metrics: {
            openRequests: 18,
            demand: 20,
            availableDrivers: 2,
            busyDrivers: 4,
            updatedAt: '2026-05-19T12:00:00.000Z'
          }
        }
      ]
    });
    const app = createApp();

    const response = await request(app)
      .post('/api/demand/predictions/preview')
      .send({
        h3: '89a8a0a',
        city: 'rio_de_janeiro',
        baseline: {
          expectedRequests15m: 4,
          expectedAvailableDrivers: 8
        }
      });

    expect(response.status).toBe(200);
    expect(mockGetAggregatedCells).toHaveBeenCalledWith(mockRedisConnection, {
      cells: ['89a8a0a'],
      resolution: 8
    });
    expect(response.body.dataSource).toBe('pricing_h3_read_model');
    expect(response.body.prediction.current).toEqual(
      expect.objectContaining({
        openRequests: 18,
        availableDrivers: 2,
        busyDrivers: 4
      })
    );
    expect(response.body.liveSnapshot).toEqual(
      expect.objectContaining({
        usable: true,
        reason: 'ok'
      })
    );
  });
});
