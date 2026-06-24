const mockFirestoreUserRefs = new Map();
const mockRealtimeSnapshots = new Map();
const mockRealtimeUpdates = [];
const mockTransactions = [];
const mockPassengerBlock = jest.fn();
const mockPassengerUnblock = jest.fn();
const mockFcmInitialize = jest.fn();
const mockSendNotificationToUser = jest.fn();
const mockAuditLogEvent = jest.fn();

const mockRedisMulti = {
  del: jest.fn(() => mockRedisMulti),
  hset: jest.fn(() => mockRedisMulti),
  zrem: jest.fn(() => mockRedisMulti),
  srem: jest.fn(() => mockRedisMulti),
  exec: jest.fn().mockResolvedValue([])
};
const mockRedis = {
  multi: jest.fn(() => mockRedisMulti)
};

function mockMakeFirestoreUserRef(userId) {
  if (!mockFirestoreUserRefs.has(userId)) {
    mockFirestoreUserRefs.set(userId, {
      get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
      set: jest.fn().mockResolvedValue(undefined)
    });
  }
  return mockFirestoreUserRefs.get(userId);
}

function mockMakeRealtimeSnapshot(path) {
  const value = mockRealtimeSnapshots.get(path);
  return {
    exists: () => value !== undefined,
    val: () => value || null
  };
}

const mockRealtimeDb = {
  ref: jest.fn((path = '') => ({
    once: jest.fn().mockResolvedValue(mockMakeRealtimeSnapshot(path)),
    update: jest.fn(async (payload) => {
      mockRealtimeUpdates.push({ path, payload });
    }),
    transaction: jest.fn(async (fn) => {
      mockTransactions.push({ path, result: fn(0) });
      return { committed: true };
    })
  }))
};

jest.mock('firebase-admin', () => ({
  firestore: jest.fn(() => ({
    collection: jest.fn(() => ({
      doc: jest.fn((userId) => mockMakeFirestoreUserRef(userId))
    }))
  }))
}));

jest.mock('../../../firebase-config', () => ({
  getRealtimeDB: jest.fn(() => mockRealtimeDb)
}));

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn(() => mockRedis),
  ensureConnection: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../services/passenger-trust-service', () => ({
  blockPassenger: (...args) => mockPassengerBlock(...args),
  unblockPassenger: (...args) => mockPassengerUnblock(...args)
}));

jest.mock('../../../services/fcm-service', () => jest.fn(() => ({
  initialize: (...args) => mockFcmInitialize(...args),
  sendNotificationToUser: (...args) => mockSendNotificationToUser(...args)
})));

jest.mock('../../../services/audit-service', () => ({
  logEvent: (...args) => mockAuditLogEvent(...args)
}));

jest.mock('../../../utils/logger', () => ({
  logError: jest.fn(),
  logStructured: jest.fn()
}));

describe('dashboard-user-management-service', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFirestoreUserRefs.clear();
    mockRealtimeSnapshots.clear();
    mockRealtimeUpdates.length = 0;
    mockTransactions.length = 0;
    mockRedisMulti.del.mockClear();
    mockRedisMulti.hset.mockClear();
    mockRedisMulti.zrem.mockClear();
    mockRedisMulti.srem.mockClear();
    mockRedisMulti.exec.mockClear();
    mockFcmInitialize.mockResolvedValue(undefined);
    mockSendNotificationToUser.mockResolvedValue({ success: true, summary: { success: 1 } });
    mockAuditLogEvent.mockResolvedValue({ success: true, logId: 'audit_1' });
    service = require('../../../services/dashboard-user-management-service');
  });

  it('blocks drivers in Firestore, RTDB and runtime Redis', async () => {
    mockMakeFirestoreUserRef('driver_1').get.mockResolvedValue({
      exists: true,
      data: () => ({ usertype: 'driver', approved: true, status: 'approved' })
    });
    mockRealtimeSnapshots.set('users/driver_1', { usertype: 'driver', approved: true, status: 'approved' });

    const result = await service.updateUserOperationalStatus(
      'driver_1',
      { status: 'blocked', reason: 'Risco operacional' },
      { operator: { id: 'admin_1', email: 'admin@leaf.test' } }
    );

    expect(result).toMatchObject({ success: true, userId: 'driver_1', userType: 'driver', status: 'blocked' });
    expect(mockMakeFirestoreUserRef('driver_1').set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'blocked',
        accountStatus: 'blocked',
        operationalBlocked: true,
        blockedReason: 'Risco operacional'
      }),
      { merge: true }
    );
    expect(mockRealtimeUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'users/driver_1',
        payload: expect.objectContaining({ status: 'blocked', operationalBlocked: true })
      })
    ]));
    expect(mockRedisMulti.del).toHaveBeenCalledWith('driver_eligibility_profile:driver_1');
    expect(mockRedisMulti.hset).toHaveBeenCalledWith('driver:driver_1', expect.objectContaining({
      status: 'OFFLINE',
      dispatchEligible: 'false',
      dispatchEligibilityCode: 'USER_STATUS_BLOCKED'
    }));
    expect(mockAuditLogEvent).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'admin_1',
      action: 'dashboard.user.operational_status.update',
      resource: 'user',
      severity: 'WARNING',
      details: expect.objectContaining({
        targetUserId: 'driver_1',
        targetUserType: 'driver',
        status: 'blocked',
        reason: 'Risco operacional',
        reasonCode: 'USER_STATUS_BLOCKED',
        operatorEmail: 'admin@leaf.test'
      }),
      success: true
    }));
  });

  it('suspends drivers with an expiry and removes dispatch eligibility immediately', async () => {
    mockMakeFirestoreUserRef('driver_suspended').get.mockResolvedValue({
      exists: true,
      data: () => ({ usertype: 'driver', approved: true, status: 'approved' })
    });
    mockRealtimeSnapshots.set('users/driver_suspended', {
      usertype: 'driver',
      approved: true,
      status: 'approved'
    });

    const result = await service.updateUserOperationalStatus(
      'driver_suspended',
      { status: 'suspended', reason: 'Revisao de seguranca', durationDays: 7 },
      { operator: { id: 'admin_1', email: 'admin@leaf.test' } }
    );

    expect(result).toMatchObject({
      success: true,
      userId: 'driver_suspended',
      userType: 'driver',
      status: 'suspended',
      reason: 'Revisao de seguranca'
    });
    expect(result.expiresAt).toEqual(expect.any(String));
    expect(mockMakeFirestoreUserRef('driver_suspended').set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'suspended',
        accountStatus: 'suspended',
        operationalBlocked: true,
        suspended: true,
        suspendedUntil: result.expiresAt
      }),
      { merge: true }
    );
    expect(mockRedisMulti.hset).toHaveBeenCalledWith('driver:driver_suspended', expect.objectContaining({
      status: 'OFFLINE',
      dispatchEligible: 'false',
      dispatchEligibilityCode: 'USER_STATUS_SUSPENDED'
    }));
    expect(mockAuditLogEvent).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'admin_1',
      action: 'dashboard.user.operational_status.update',
      details: expect.objectContaining({
        targetUserId: 'driver_suspended',
        status: 'suspended',
        reason: 'Revisao de seguranca',
        durationDays: 7,
        reasonCode: 'USER_STATUS_SUSPENDED'
      })
    }));
  });

  it('reactivates customers and clears passenger trust block', async () => {
    mockMakeFirestoreUserRef('customer_1').get.mockResolvedValue({
      exists: true,
      data: () => ({ usertype: 'customer', status: 'blocked' })
    });
    mockRealtimeSnapshots.set('users/customer_1', { usertype: 'customer', status: 'blocked' });

    const result = await service.updateUserOperationalStatus(
      'customer_1',
      { status: 'active', reason: 'Revisao concluida' },
      { operator: { id: 'support_1' } }
    );

    expect(result).toMatchObject({ success: true, userId: 'customer_1', userType: 'customer', status: 'active' });
    expect(mockMakeFirestoreUserRef('customer_1').set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'active',
        accountStatus: 'active',
        operationalBlocked: false
      }),
      { merge: true }
    );
    expect(mockPassengerUnblock).toHaveBeenCalledWith('customer_1', expect.objectContaining({
      operatorId: 'support_1',
      reasonCode: 'dashboard_reactivation'
    }));
    expect(mockAuditLogEvent).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'support_1',
      action: 'dashboard.user.operational_status.update',
      severity: 'INFO',
      details: expect.objectContaining({
        targetUserId: 'customer_1',
        targetUserType: 'customer',
        status: 'active'
      })
    }));
  });

  it('reactivates non-approved drivers without approving them', async () => {
    mockMakeFirestoreUserRef('driver_pending').get.mockResolvedValue({
      exists: true,
      data: () => ({ usertype: 'driver', approved: false, status: 'suspended' })
    });
    mockRealtimeSnapshots.set('users/driver_pending', {
      usertype: 'driver',
      approved: false,
      status: 'suspended'
    });

    const result = await service.updateUserOperationalStatus(
      'driver_pending',
      { status: 'active', reason: 'Fim da suspensão' },
      { operator: { id: 'admin_1' } }
    );

    expect(result).toMatchObject({
      success: true,
      userId: 'driver_pending',
      userType: 'driver',
      status: 'active'
    });
    expect(mockMakeFirestoreUserRef('driver_pending').set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'pending_review',
        accountStatus: 'pending_review',
        operationalBlocked: false
      }),
      { merge: true }
    );
  });

  it('requests driver documents without moving approved documents back to the review queue', async () => {
    mockMakeFirestoreUserRef('driver_2').get.mockResolvedValue({
      exists: true,
      data: () => ({ usertype: 'driver', approved: true })
    });
    mockRealtimeSnapshots.set('users/driver_2', { usertype: 'driver', approved: true });
    mockRealtimeSnapshots.set('users/driver_2/documents/cnh', {
      status: 'approved',
      uploadedAt: '2026-05-01T10:00:00.000Z',
      fileName: 'cnh.pdf',
      fileType: 'application/pdf'
    });

    const result = await service.requestDriverDocument(
      'driver_2',
      'cnh',
      { reason: 'Envie uma CNH mais recente' },
      { operator: { id: 'admin_1', email: 'admin@leaf.test' } }
    );

    expect(result).toMatchObject({
      success: true,
      driverId: 'driver_2',
      documentType: 'cnh',
      status: 'requested',
      previousStatus: 'approved'
    });
    expect(mockRealtimeUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: '',
        payload: expect.objectContaining({
          'users/driver_2/documents/cnh': expect.objectContaining({
            status: 'approved',
            requestStatus: 'requested',
            requiredUpdate: true,
            requestReason: 'Envie uma CNH mais recente'
          })
        })
      })
    ]));
    expect(mockRealtimeUpdates[0].payload).not.toHaveProperty('driver_documents_index/cnh/pending/driver_2');
    expect(mockRealtimeUpdates[0].payload).not.toHaveProperty('driver_documents_index/cnh/approved/driver_2');
    expect(mockMakeFirestoreUserRef('driver_2').set).toHaveBeenCalledWith(
      expect.objectContaining({
        documentRequests: expect.objectContaining({
          cnh: expect.objectContaining({ status: 'requested' })
        })
      }),
      { merge: true }
    );
    expect(mockSendNotificationToUser).toHaveBeenCalledWith('driver_2', expect.objectContaining({
      title: 'Documento pendente',
      data: expect.objectContaining({ documentType: 'cnh' })
    }));
    expect(mockAuditLogEvent).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'admin_1',
      action: 'dashboard.driver.document.request',
      resource: 'driver_document',
      severity: 'WARNING',
      details: expect.objectContaining({
        targetDriverId: 'driver_2',
        documentType: 'cnh',
        reason: 'Envie uma CNH mais recente',
        previousStatus: 'approved',
        status: 'requested',
        operatorEmail: 'admin@leaf.test',
        pushRequested: true,
        pushSuccess: true
      }),
      success: true
    }));
  });
});
