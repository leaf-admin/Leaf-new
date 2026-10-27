'use strict';

jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockRealtimeData = {};
const mockRealtimeDb = {
  ref: jest.fn((path) => ({
    once: jest.fn(async () => ({ val: () => mockRealtimeData[path] || null }))
  }))
};
// users/{uid} and the ride annotations (served as `bookings`) live in Firestore.
const mockNativeRoots = { users: 'users', ride_annotations: 'bookings' };
const mockFirestore = {
  collection: jest.fn((name) => ({
    get: jest.fn(async () => ({
      docs: Object.entries(mockRealtimeData[mockNativeRoots[name]] || {})
        .map(([id, data]) => ({ id, data: () => data }))
    }))
  }))
};
const mockLogStructured = jest.fn();

jest.mock('../../../middleware/jwt-auth', () => ({
  authenticateJWT(req, res, next) {
    const role = String(req.get('X-Test-Role') || '').trim();
    if (!role) {
      return res.status(401).json({ success: false, error: 'Token não fornecido' });
    }
    req.user = { id: 'manager-1', email: 'manager@leaf.test', role, permissions: [] };
    return next();
  },
  requireRole(roles) {
    return (req, res, next) => {
      if (!req.user) return res.status(401).json({ success: false, error: 'Não autenticado' });
      if (!roles.includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Acesso negado' });
      }
      return next();
    };
  },
  requirePermission: () => (_req, _res, next) => next()
}));

jest.mock('../../../utils/jwt-secret-resolver', () => ({
  resolveJwtSecret: jest.fn(() => 'dashboard-operational-report-test-secret')
}));

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn(async () => undefined),
  getConnection: jest.fn(() => null),
  shutdown: jest.fn(async () => undefined)
}));

jest.mock('../../../firebase-config', () => ({
  getRealtimeDB: jest.fn(() => mockRealtimeDb),
  getFirestore: jest.fn(() => mockFirestore),
  initializeFirebase: jest.fn()
}));

jest.mock('../../../services/kyc-policy-service', () => ({}));

jest.mock('../../../utils/logger', () => ({
  logStructured: (...args) => mockLogStructured(...args),
  logError: jest.fn(),
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

const dashboardRoutes = require('../../../routes/dashboard');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', dashboardRoutes);
  return app;
}

// One base instant, so the expected averages are exact minutes.
const NOW_MS = Date.now();
function minutesAgo(minutes) {
  return new Date(NOW_MS - minutes * 60 * 1000).toISOString();
}

describe('GET /api/reports/comprehensive?reportType=operational', () => {
  beforeEach(() => {
    mockLogStructured.mockClear();
    mockRealtimeData.users = {};
    mockRealtimeData.cars = {};
    mockRealtimeData.bookings = {
      // Requested 120 min ago, accepted 6 min later, 20-minute trip.
      completedA: {
        status: 'COMPLETE',
        tripdate: minutesAgo(120),
        acceptedAt: minutesAgo(114),
        tripstart: minutesAgo(110),
        tripend: minutesAgo(90)
      },
      // Requested 60 min ago, accepted 4 min later, 30-minute trip.
      completedB: {
        status: 'PAID',
        tripdate: minutesAgo(60),
        acceptedAt: minutesAgo(56),
        tripstart: minutesAgo(50),
        tripend: minutesAgo(20)
      },
      cancelled: {
        status: 'CANCELLED',
        reason: 'Passageiro desistiu',
        tripdate: minutesAgo(30)
      }
    };
  });

  test('builds the report from completed trips instead of failing silently', async () => {
    const response = await request(buildApp())
      .get('/api/reports/comprehensive')
      .query({ reportType: 'operational', period: '7d' })
      .set('X-Test-Role', 'manager');

    expect(response.status).toBe(200);
    expect(mockLogStructured).not.toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('Erro ao gerar relatório'),
      expect.anything(),
      expect.anything()
    );
    expect(response.body.data.summary).toMatchObject({
      totalTrips: 3,
      completedTrips: 2,
      cancelledTrips: 1,
      avgWaitTime: '5 min',
      avgTripTime: '25 min'
    });
    expect(response.body.data.cancellationAnalysis).toEqual([
      expect.objectContaining({ reason: 'Passageiro desistiu', count: 1 })
    ]);
  });
});
