const mockUserRefs = new Map();
const mockAuditLogEvent = jest.fn();

function makeUserRef(userId) {
  if (!mockUserRefs.has(userId)) {
    mockUserRefs.set(userId, {
      get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
      set: jest.fn().mockResolvedValue(undefined)
    });
  }
  return mockUserRefs.get(userId);
}

jest.mock('firebase-admin', () => ({
  firestore: jest.fn(() => ({
    collection: jest.fn(() => ({
      doc: jest.fn((userId) => makeUserRef(userId))
    }))
  }))
}));

jest.mock('../../../services/audit-service', () => ({
  logEvent: (...args) => mockAuditLogEvent(...args)
}));

jest.mock('../../../utils/logger', () => ({
  logError: jest.fn(),
  logStructured: jest.fn()
}));

describe('dashboard-user-service', () => {
  let service;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockUserRefs.clear();
    mockAuditLogEvent.mockResolvedValue({ success: true, logId: 'audit_user_profile_update' });
    service = require('../../../services/dashboard-user-service');
  });

  it('updates dashboard user profile fields and records a safe audit entry', async () => {
    const ref = makeUserRef('customer_1');
    ref.get
      .mockResolvedValueOnce({
        exists: true,
        id: 'customer_1',
        data: () => ({
          name: 'Cliente Antigo',
          email: 'old@example.com',
          usertype: 'customer',
          approved: true,
          createdAt: '2026-06-01T10:00:00.000Z'
        })
      })
      .mockResolvedValueOnce({
        exists: true,
        id: 'customer_1',
        data: () => ({
          name: 'Cliente Novo',
          firstName: 'Cliente',
          lastName: 'Novo',
          email: 'new@example.com',
          mobile: '+5511999999999',
          usertype: 'customer',
          approved: true,
          updatedAt: '2026-06-10T10:00:00.000Z'
        })
      });

    const result = await service.updateUserProfile(
      'customer_1',
      {
        name: 'Cliente Novo',
        email: 'new@example.com',
        phone: '+5511999999999'
      },
      {
        operator: {
          id: 'admin_1',
          email: 'admin@leaf.test',
          role: 'manager'
        }
      }
    );

    expect(ref.set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Cliente Novo',
        firstName: 'Cliente',
        lastName: 'Novo',
        email: 'new@example.com',
        mobile: '+5511999999999',
        updatedAt: expect.any(String)
      }),
      { merge: true }
    );
    expect(result).toMatchObject({
      id: 'customer_1',
      email: 'new@example.com'
    });
    expect(mockAuditLogEvent).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'admin_1',
      action: 'dashboard.user.profile.update',
      resource: 'user',
      severity: 'INFO',
      details: expect.objectContaining({
        targetUserId: 'customer_1',
        fieldsChanged: ['email', 'firstName', 'lastName', 'mobile', 'name'],
        operatorEmail: 'admin@leaf.test',
        operatorRole: 'manager'
      }),
      success: true
    }));
  });
});
