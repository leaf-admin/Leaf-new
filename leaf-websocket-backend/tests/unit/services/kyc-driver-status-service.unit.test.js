const mockRedis = {
  hgetall: jest.fn(),
  hset: jest.fn(),
  expire: jest.fn(),
  zrem: jest.fn()
};
const mockFirestoreDocs = new Map();
const mockFirestoreSets = [];
const mockCommitDriverOnlineProjection = jest.fn();

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn(() => mockRedis)
}));

jest.mock('../../../services/KYCNotificationService', () =>
  jest.fn().mockImplementation(() => ({
    sendCustomNotification: jest.fn(),
    sendVerificationSuccess: jest.fn()
  }))
);

jest.mock('../../../services/driver-online-projection-service', () => ({
  commitDriverOnlineProjection: (...args) => mockCommitDriverOnlineProjection(...args)
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

jest.mock('firebase-admin', () => ({
  firestore: Object.assign(
    jest.fn(() => ({
      collection: (collectionName) => ({
        doc: (id) => ({
          get: jest.fn(async () => {
            const key = `${collectionName}/${id}`;
            return {
              exists: mockFirestoreDocs.has(key),
              data: () => mockFirestoreDocs.get(key)
            };
          }),
          set: jest.fn(async (payload, options = {}) => {
            mockFirestoreSets.push({ collectionName, id, payload, options });
            const key = `${collectionName}/${id}`;
            const previous = mockFirestoreDocs.get(key) || {};
            mockFirestoreDocs.set(key, options.merge ? { ...previous, ...payload } : { ...payload });
          })
        })
      })
    })),
    {
      FieldValue: {
        serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
        delete: jest.fn(() => 'FIELD_DELETE')
      }
    }
  )
}));

const kycDriverStatusService = require('../../../services/kyc-driver-status-service');

describe('KYCDriverStatusService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFirestoreDocs.clear();
    mockFirestoreSets.length = 0;
    mockRedis.hset.mockResolvedValue(1);
    mockRedis.hgetall.mockResolvedValue({});
    mockRedis.expire.mockResolvedValue(1);
    mockRedis.zrem.mockResolvedValue(1);
    mockCommitDriverOnlineProjection.mockResolvedValue({ success: true });
  });

  it('forces a KYC-blocked driver offline through the canonical atomic projection', async () => {
    await kycDriverStatusService.forceDriverOffline('driver_blocked');

    expect(mockCommitDriverOnlineProjection).toHaveBeenCalledWith(
      mockRedis,
      expect.objectContaining({
        driverId: 'driver_blocked',
        eligibleGeoKey: 'driver_locations_eligible',
        isOnline: false,
        dispatchEligible: false,
        ttlSeconds: 30 * 24 * 60 * 60,
        fields: expect.objectContaining({
          isOnline: 'false',
          status: 'OFFLINE',
          dispatchEligible: 'false',
          dispatchEligibilityCode: 'KYC_BLOCKED'
        })
      })
    );
    expect(mockRedis.hset).not.toHaveBeenCalled();
    expect(mockRedis.zrem).toHaveBeenCalledWith('drivers:available', 'driver_blocked');
  });

  it('commits KYC block fields and offline discovery state in the same Redis projection', async () => {
    await kycDriverStatusService.blockDriver('driver_blocked', 'biometric mismatch');

    expect(mockCommitDriverOnlineProjection).toHaveBeenCalledTimes(1);
    expect(mockCommitDriverOnlineProjection).toHaveBeenCalledWith(
      mockRedis,
      expect.objectContaining({
        driverId: 'driver_blocked',
        isOnline: false,
        dispatchEligible: false,
        fields: expect.objectContaining({
          kyc_status: 'blocked',
          kyc_blocked: 'true',
          kyc_blocked_reason: 'biometric mismatch',
          status: 'OFFLINE',
          dispatchEligibilityCode: 'KYC_BLOCKED'
        })
      })
    );
    expect(mockRedis.hset).not.toHaveBeenCalled();
    expect(mockFirestoreSets).toHaveLength(2);
  });

  it('does not persist a successful KYC block when the atomic Redis transition fails', async () => {
    mockCommitDriverOnlineProjection.mockRejectedValueOnce(new Error('atomic projection failed'));

    await expect(
      kycDriverStatusService.blockDriver('driver_blocked', 'biometric mismatch')
    ).rejects.toThrow('atomic projection failed');

    expect(mockFirestoreSets).toHaveLength(0);
    expect(mockRedis.zrem).not.toHaveBeenCalled();
  });

  it('fails the KYC offline transition when Redis does not confirm the atomic projection', async () => {
    mockCommitDriverOnlineProjection.mockRejectedValueOnce(new Error('atomic projection failed'));

    await expect(
      kycDriverStatusService.forceDriverOffline('driver_blocked')
    ).rejects.toThrow('atomic projection failed');

    expect(mockRedis.zrem).not.toHaveBeenCalled();
  });

  it('keeps the canonical KYC block successful when only the unread legacy index cleanup fails', async () => {
    mockRedis.zrem.mockRejectedValueOnce(new Error('legacy index unavailable'));

    await expect(
      kycDriverStatusService.forceDriverOffline('driver_blocked')
    ).resolves.toBeUndefined();

    expect(mockCommitDriverOnlineProjection).toHaveBeenCalledTimes(1);
  });

  it('rejects manual KYC unblock without audit before mutating state', async () => {
    await expect(
      kycDriverStatusService.unblockDriver('driver_1', { manualOverride: true })
    ).rejects.toMatchObject({
      code: 'KYC_UNBLOCK_AUDIT_REQUIRED'
    });

    expect(mockRedis.hset).not.toHaveBeenCalled();
    expect(mockFirestoreSets).toHaveLength(0);
  });

  it('persists manual KYC unblock audit with previous and next state', async () => {
    mockFirestoreDocs.set('users/driver_2', {
      kycStatus: 'blocked',
      kycBlocked: true,
      kycBlockedReason: 'manual_review'
    });

    await kycDriverStatusService.unblockDriver('driver_2', {
      manualOverride: true,
      confidence: 1,
      similarityScore: 1,
      audit: {
        actorId: 'admin_1',
        actorRole: 'admin',
        reason: 'Documentos revisados e identidade validada',
        provenance: 'dashboard_driver_application_approval',
        evidence: [{ type: 'cnh', ref: 'doc_1' }]
      }
    });

    const userWrite = mockFirestoreSets.find((entry) => entry.collectionName === 'users' && entry.id === 'driver_2');
    expect(userWrite.payload).toMatchObject({
      kycStatus: 'approved',
      kycBlocked: false,
      kycManualOverrideActorId: 'admin_1',
      kycManualOverrideReason: 'Documentos revisados e identidade validada',
      kycManualOverrideAudit: expect.objectContaining({
        action: 'kyc_unblock',
        actorId: 'admin_1',
        previousState: expect.objectContaining({
          kycStatus: 'blocked',
          kycBlocked: true
        }),
        nextState: {
          kycStatus: 'approved',
          kycBlocked: false
        }
      })
    });
  });

  it('fails closed when KYC status cannot be read', async () => {
    mockRedis.hgetall.mockRejectedValue(new Error('redis unavailable'));

    await expect(kycDriverStatusService.isDriverBlocked('driver_error')).resolves.toMatchObject({
      blocked: true,
      code: 'KYC_STATUS_UNAVAILABLE',
      source: 'error'
    });

    await expect(kycDriverStatusService.canDriverWork('driver_error')).resolves.toBe(false);
  });
});
