jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockRootUpdate = jest.fn();
const mockAuditLogEvent = jest.fn();
const mockRedisHset = jest.fn();
const mockRedisDel = jest.fn();
const mockRedisZrem = jest.fn();
const mockRedisSrem = jest.fn();
const mockCommitDriverOnlineProjection = jest.fn();
const mockRedisEval = jest.fn(async () => {
  if (mockActiveTripReadError) throw mockActiveTripReadError;
  return [mockActiveTripId || '', ''];
});
const mockRedisGet = jest.fn(async (key) => {
  if (mockActiveTripReadError) throw mockActiveTripReadError;
  return key.startsWith('active_trip_by_driver:') ? mockActiveTripId : null;
});
const mockRedisHget = jest.fn(async (_key, field) => {
  if (mockActiveTripReadError) throw mockActiveTripReadError;
  return field === 'activeTripId' ? mockActiveTripId : null;
});
const mockRecomputeDriverActivationStatus = jest.fn();
const mockIoEmit = jest.fn();
const mockIoTo = jest.fn(() => ({ emit: mockIoEmit }));
let mockCrlvStatus = 'pending';
let mockCrlvPlate = 'ABC1D23';
let mockCrlvReadError = null;
let mockVehiclePlate = 'ABC1D23';
let mockVehicleReadError = null;
let mockActiveTripId = null;
let mockActiveTripReadError = null;

function snapshot(value, exists = value !== null && value !== undefined) {
  return {
    exists: () => exists,
    val: () => value,
  };
}

const mockRef = jest.fn((path) => ({
  once: jest.fn(async () => {
    if (path === 'users/driver-1') {
      return snapshot({ approved: true, carType: 'Leaf Plus' });
    }
    if (path === 'user_vehicles/driver-1') {
      return snapshot({
        'link-1': {
          id: 'link-1',
          vehicleId: 'vehicle-1',
          status: 'pending',
          approved: false,
          isActive: false,
        },
      });
    }
    if (path === 'driver_activation/driver-1/documents/crlv') {
      if (mockCrlvReadError) throw mockCrlvReadError;
      return snapshot({
        status: mockCrlvStatus,
        data: mockCrlvPlate ? { plate: mockCrlvPlate } : {},
      }, Boolean(mockCrlvStatus));
    }
    if (path === 'vehicles/vehicle-1') {
      if (mockVehicleReadError) throw mockVehicleReadError;
      return snapshot({
        plate: mockVehiclePlate,
        brand: 'Nissan',
        model: 'Leaf',
        color: 'BRANCO',
        year: 2025,
        category: 'plus',
      });
    }
    return snapshot(null, false);
  }),
  update: path === undefined ? mockRootUpdate : jest.fn(),
}));

const mockDb = { ref: mockRef };

jest.mock('../../../firebase-config', () => ({
  getRealtimeDB: jest.fn(() => mockDb),
}));

jest.mock('../../../middleware/jwt-auth', () => ({
  authenticateJWT: (req, _res, next) => {
    req.user = {
      id: 'admin-1',
      email: 'admin@leaf.test',
      role: 'admin',
    };
    next();
  },
  requireRole: () => (_req, _res, next) => next(),
  requirePermission: () => (_req, _res, next) => next(),
}));

jest.mock('../../../utils/jwt-secret-resolver', () => ({
  resolveJwtSecret: jest.fn(() => 'dashboard-test-secret'),
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn(),
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn(() => ({
    hset: mockRedisHset,
    del: mockRedisDel,
    zrem: mockRedisZrem,
    srem: mockRedisSrem,
    eval: mockRedisEval,
    get: mockRedisGet,
    hget: mockRedisHget,
  })),
}));

jest.mock('../../../utils/redis-scan', () => ({
  countKeys: jest.fn(),
}));

jest.mock('../../../services/audit-service', () => ({
  logEvent: mockAuditLogEvent,
}));
jest.mock('../../../services/driver-online-projection-service', () => ({
  commitDriverOnlineProjection: (...args) => mockCommitDriverOnlineProjection(...args),
}));

jest.mock('../../../services/kyc-driver-status-service', () => ({}));
jest.mock('../../../services/dashboard-live-data-service', () => ({ getDashboardLiveData: jest.fn() }));
jest.mock('../../../services/dashboard-user-service', () => ({
  listUsers: jest.fn(),
  getUserStats: jest.fn(),
  getUserDetails: jest.fn(),
  updateUserProfile: jest.fn(),
}));
jest.mock('../../../services/support-ticket-service', () => ({}));
jest.mock('../../../services/driver-application-service', () => ({ syncDriverApplication: jest.fn() }));
jest.mock('../../../services/driver-subscription-service', () => ({}));
jest.mock('../../../services/subscription-state-service', () => ({}));
jest.mock('../../../services/modern-metrics-service', () => ({}));
jest.mock('../../../services/h3-map-service', () => ({ helpers: {} }));
jest.mock('../../../services/h3-visual-policy-service', () => ({}));
jest.mock('../../../services/financial-reconciliation-dashboard-service', () => ({}));
jest.mock('../../../services/financial-ledger-service', () => jest.fn());
jest.mock('../../../services/backoffice-cost-guard-service', () => ({}));
jest.mock('../../../services/dashboard-user-management-service', () => ({
  DashboardUserManagementError: class DashboardUserManagementError extends Error {},
  updateUserOperationalStatus: jest.fn(),
}));
jest.mock('../../../services/driver-document-analysis-queue', () => ({
  recomputeDriverActivationStatus: mockRecomputeDriverActivationStatus,
}));
jest.mock('../../../services/dashboard-ride-monitoring-service', () => ({
  buildRecentRideActivities: jest.fn(),
  isRideRevenuePendingFinalSnapshot: jest.fn(),
  resolveRideDriverNetAmount: jest.fn(),
  resolveRideOperationalFee: jest.fn(),
  resolveRideRevenue: jest.fn(),
}));
jest.mock('../../../services/dashboard/reportMetrics', () => ({ getPeakHours: jest.fn() }));
jest.mock('../../../utils/admin-user-cache', () => ({ getAdminUser: jest.fn() }));
jest.mock('../../../services/promotion-service', () => ({}));

const dashboardRoutes = require('../../../routes/dashboard');

function createApp() {
  const app = express();
  app.set('io', { to: mockIoTo });
  app.use(express.json());
  app.use('/', dashboardRoutes);
  return app;
}

async function configureVehicle(body) {
  return request(createApp())
    .post('/api/drivers/driver-1/vehicle/config')
    .set('Authorization', 'Bearer dashboard-token')
    .send({ userVehicleId: 'link-1', ...body });
}

describe('dashboard vehicle configuration canonical CRLV gate', () => {
  beforeEach(() => {
    mockCrlvStatus = 'pending';
    mockCrlvPlate = 'ABC1D23';
    mockCrlvReadError = null;
    mockVehiclePlate = 'ABC1D23';
    mockVehicleReadError = null;
    mockActiveTripId = null;
    mockActiveTripReadError = null;
    mockRootUpdate.mockResolvedValue(undefined);
    mockAuditLogEvent.mockResolvedValue(undefined);
    mockRedisHset.mockResolvedValue(1);
    mockRedisDel.mockResolvedValue(1);
    mockRedisZrem.mockResolvedValue(1);
    mockRedisSrem.mockResolvedValue(1);
    mockCommitDriverOnlineProjection.mockResolvedValue({ success: true });
    mockRecomputeDriverActivationStatus.mockResolvedValue({
      canGoOnline: true,
      activationState: 'ACTIVE',
    });
  });

  it('treats a pending vehicle status as revocation even when activation was requested', async () => {
    const response = await configureVehicle({ setActive: true, vehicleStatus: 'pending' });

    expect(response.status).toBe(200);
    expect(mockRef).not.toHaveBeenCalledWith('driver_activation/driver-1/documents/crlv');
    expect(response.body.data).toMatchObject({
      setActive: false,
      requestedSetActive: true,
      operationalRevocation: {
        synced: true,
        dispatchEligible: false,
        offlineDeferred: false,
      },
    });
    expect(mockRootUpdate).toHaveBeenCalledWith(expect.objectContaining({
      'user_vehicles/driver-1/link-1/isActive': false,
      'users/driver-1/activeVehicleId': '',
    }));
  });

  it('blocks approval and activation while the canonical CRLV has failed', async () => {
    mockCrlvStatus = 'failed';

    const response = await configureVehicle({ setActive: true, vehicleStatus: 'approved' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      code: 'CANONICAL_CRLV_APPROVAL_REQUIRED',
      data: { crlvStatus: 'failed' },
    });
    expect(mockRootUpdate).not.toHaveBeenCalled();
  });

  it('does not treat a non-canonical active CRLV status as approved', async () => {
    mockCrlvStatus = 'active';

    const response = await configureVehicle({ setActive: true, vehicleStatus: 'approved' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      code: 'CANONICAL_CRLV_APPROVAL_REQUIRED',
      data: { crlvStatus: 'active' },
    });
    expect(mockRootUpdate).not.toHaveBeenCalled();
  });

  it('allows approval and activation when the canonical CRLV is approved', async () => {
    mockCrlvStatus = 'approved';

    const response = await configureVehicle({ setActive: true, vehicleStatus: 'approved' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        setActive: true,
        vehicleStatus: 'approved',
      },
    });
    expect(mockRootUpdate).toHaveBeenCalledWith(expect.objectContaining({
      'user_vehicles/driver-1/link-1/isActive': true,
      'user_vehicles/driver-1/link-1/status': 'approved',
      'user_vehicles/driver-1/link-1/approved': true,
      'user_vehicles/driver-1/link-1/plate': 'ABC1D23',
      'user_vehicles/driver-1/link-1/brand': 'Nissan',
      'user_vehicles/driver-1/link-1/model': 'Leaf',
      'user_vehicles/driver-1/link-1/color': 'BRANCO',
      'user_vehicles/driver-1/link-1/year': '2025',
      'users/driver-1/activeVehicleId': 'vehicle-1',
    }));
    expect(mockRedisHset).toHaveBeenCalledWith(
      'driver:driver-1',
      expect.objectContaining({
        vehicleApproved: 'true',
      })
    );
    expect(mockRecomputeDriverActivationStatus).toHaveBeenCalledWith('driver-1');
    expect(mockIoTo).toHaveBeenCalledWith('driver_driver-1');
    expect(mockIoEmit).toHaveBeenCalledWith(
      'driverDocumentStatusUpdated',
      expect.objectContaining({
        driverId: 'driver-1',
        canGoOnline: true,
        activationState: 'ACTIVE',
      })
    );
  });

  it('blocks an operational configuration when the approved CRLV has no canonical plate', async () => {
    mockCrlvStatus = 'approved';
    mockCrlvPlate = '';

    const response = await configureVehicle({ setActive: true, vehicleStatus: 'approved' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      code: 'CANONICAL_CRLV_VEHICLE_IDENTITY_REQUIRED',
      data: {
        crlvPlatePresent: false,
        vehiclePlatePresent: true,
      },
    });
    expect(mockRootUpdate).not.toHaveBeenCalled();
  });

  it('blocks an operational configuration when CRLV and selected vehicle plates differ', async () => {
    mockCrlvStatus = 'approved';
    mockCrlvPlate = 'ABC-1D23';
    mockVehiclePlate = 'XYZ9Z99';

    const response = await configureVehicle({ setActive: true, vehicleStatus: 'approved' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      code: 'CANONICAL_CRLV_VEHICLE_MISMATCH',
      data: {
        crlvPlate: 'ABC1D23',
        vehiclePlate: 'XYZ9Z99',
      },
    });
    expect(mockRootUpdate).not.toHaveBeenCalled();
  });

  it('fails closed when the selected canonical vehicle identity cannot be read', async () => {
    mockCrlvStatus = 'approved';
    mockVehicleReadError = new Error('vehicle catalog unavailable');

    const response = await configureVehicle({ setActive: true, vehicleStatus: 'approved' });

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      code: 'CANONICAL_VEHICLE_IDENTITY_UNAVAILABLE',
    });
    expect(mockRootUpdate).not.toHaveBeenCalled();
  });

  it('fails closed when the canonical CRLV status cannot be read', async () => {
    mockCrlvReadError = new Error('RTDB unavailable');

    const response = await configureVehicle({ setActive: true, vehicleStatus: 'active' });

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      code: 'CANONICAL_CRLV_STATUS_UNAVAILABLE',
    });
    expect(mockRootUpdate).not.toHaveBeenCalled();
  });

  it('allows a non-operational configuration without requiring CRLV approval', async () => {
    mockCrlvStatus = 'pending';

    const response = await configureVehicle({
      setActive: false,
      vehicleStatus: 'pending',
      category: 'plus',
    });

    expect(response.status).toBe(200);
    expect(mockRef).not.toHaveBeenCalledWith('driver_activation/driver-1/documents/crlv');
    expect(mockRootUpdate).toHaveBeenCalledWith(expect.objectContaining({
      'user_vehicles/driver-1/link-1/isActive': false,
      'user_vehicles/driver-1/link-1/status': 'pending',
      'users/driver-1/activeVehicleId': '',
    }));
    expect(mockCommitDriverOnlineProjection).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        driverId: 'driver-1',
        driverKey: 'driver:driver-1',
        eligibleGeoKey: 'driver_locations_eligible',
        isOnline: false,
        dispatchEligible: false,
        fields: expect.objectContaining({
          status: 'OFFLINE',
          isOnline: 'false',
          dispatchEligible: 'false',
          dispatchEligibilityCode: 'VEHICLE_CONFIGURATION_REVOKED',
        }),
      })
    );
    expect(mockRedisZrem).not.toHaveBeenCalled();
    expect(mockRedisSrem).not.toHaveBeenCalled();
    expect(response.body.data).toMatchObject({
      setActive: false,
      operationalSyncPending: false,
      operationalRevocation: {
        synced: true,
        dispatchEligible: false,
        offlineDeferred: false,
        activeTripStateKnown: true,
        reason: 'VEHICLE_CONFIGURATION_REVOKED',
      },
    });
  });

  it('never lets CRLV availability block an explicit vehicle revocation', async () => {
    mockCrlvReadError = new Error('CRLV unavailable');

    const response = await configureVehicle({
      setActive: false,
      vehicleStatus: 'approved',
    });

    expect(response.status).toBe(200);
    expect(mockRef).not.toHaveBeenCalledWith('driver_activation/driver-1/documents/crlv');
    expect(response.body.data).toMatchObject({
      setActive: false,
      requestedSetActive: false,
      operationalSyncPending: false,
      operationalRevocation: {
        synced: true,
        dispatchEligible: false,
      },
    });
  });

  it('preserves online continuity during an active trip while revoking dispatch eligibility', async () => {
    mockActiveTripId = 'trip-active-1';

    const response = await configureVehicle({
      setActive: false,
      vehicleStatus: 'inactive',
    });

    expect(response.status).toBe(200);
    expect(mockCommitDriverOnlineProjection).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        driverId: 'driver-1',
        projectionScope: 'eligibility_only',
        dispatchEligible: false,
        fields: expect.objectContaining({
          dispatchEligible: 'false',
          dispatchEligibilityCode: 'VEHICLE_CONFIGURATION_REVOKED_ACTIVE_TRIP',
          vehicleOfflinePendingAfterTrip: 'true',
          vehicleOfflineDeferredReason: 'ACTIVE_TRIP',
          activeTripId: 'trip-active-1',
        }),
      })
    );
    expect(
      mockCommitDriverOnlineProjection.mock.calls.some(([, payload]) => payload?.isOnline === false)
    ).toBe(false);
    expect(mockRedisZrem).not.toHaveBeenCalled();
    expect(mockRedisSrem).not.toHaveBeenCalled();
    expect(response.body.data.operationalRevocation).toMatchObject({
      synced: true,
      dispatchEligible: false,
      offlineDeferred: true,
      offlineDeferredReason: 'ACTIVE_TRIP',
      activeTripId: 'trip-active-1',
      activeTripStateKnown: true,
      reason: 'VEHICLE_CONFIGURATION_REVOKED_ACTIVE_TRIP',
    });
  });

  it('reports activation sync pending and emits a blocked fallback when recompute fails after revocation', async () => {
    mockRecomputeDriverActivationStatus.mockRejectedValueOnce(new Error('activation unavailable'));

    const response = await configureVehicle({ setActive: false, vehicleStatus: 'inactive' });

    expect(response.status).toBe(200);
    expect(response.body.message).toContain('sincronização operacional pendente');
    expect(response.body.data).toMatchObject({
      activationSyncPending: true,
      activationState: 'VEHICLE_PENDING',
      canGoOnline: false,
      operationalRevocation: {
        synced: true,
        dispatchEligible: false,
      },
    });
    expect(mockIoEmit).toHaveBeenCalledWith(
      'driverDocumentStatusUpdated',
      expect.objectContaining({
        driverId: 'driver-1',
        canGoOnline: false,
        activationState: 'VEHICLE_PENDING',
        activationSyncPending: true,
      })
    );
    expect(mockRootUpdate).toHaveBeenCalled();
  });

  it('reports operational synchronization pending when the atomic revocation rejects', async () => {
    mockCommitDriverOnlineProjection.mockRejectedValueOnce(new Error('atomic projection rejected'));

    const response = await configureVehicle({ setActive: false, vehicleStatus: 'inactive' });

    expect(response.status).toBe(200);
    expect(response.body.message).toContain('sincronização operacional pendente');
    expect(response.body.data).toMatchObject({
      operationalSyncPending: true,
      operationalRevocation: {
        requested: true,
        synced: false,
        dispatchEligible: false,
        offlineDeferred: true,
        offlineDeferredReason: 'OPERATIONAL_SYNC_PENDING',
      },
    });
  });
});
