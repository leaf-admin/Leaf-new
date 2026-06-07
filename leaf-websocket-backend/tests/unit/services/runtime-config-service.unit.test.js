const mockGet = jest.fn();
const mockSet = jest.fn();
const mockAdd = jest.fn();
const mockWhere = jest.fn();
const mockLimit = jest.fn();
const mockCollection = jest.fn();
const mockDoc = jest.fn();

jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP')
    }
  }
}));

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => ({
    collection: mockCollection
  }))
}));

jest.mock('../../../services/payment-runtime-profile-service', () => ({
  getRuntimeSummary: jest.fn().mockResolvedValue({
    success: true,
    defaultEnvironment: 'production',
    canarySandboxEnabled: false,
    globalSandboxEnabled: false,
    activeProfileCount: 0
  })
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

function resetFirestoreMocks() {
  mockGet.mockReset();
  mockSet.mockReset().mockResolvedValue(undefined);
  mockAdd.mockReset().mockResolvedValue({ id: 'hist_1' });
  mockWhere.mockReset().mockReturnThis();
  mockLimit.mockReset().mockReturnThis();
  mockDoc.mockReset().mockReturnValue({
    get: mockGet,
    set: mockSet
  });
  mockCollection.mockReset().mockImplementation((name) => {
    if (name === 'runtime_config_history') {
      return { add: mockAdd };
    }
    return {
      where: mockWhere,
      limit: mockLimit,
      get: mockGet,
      doc: mockDoc
    };
  });
}

describe('RuntimeConfigService', () => {
  let RuntimeConfigService;

  beforeEach(() => {
    jest.resetModules();
    resetFirestoreMocks();
    ({ RuntimeConfigService } = require('../../../services/runtime-config-service'));
  });

  it('builds conservative backend-first defaults', async () => {
    mockGet.mockResolvedValue({ docs: [] });
    const service = new RuntimeConfigService({ cacheTtlMs: 0 });
    const config = await service.buildEffectiveConfig();

    expect(config.schemaVersion).toBe(1);
    expect(config.paymentRuntime.appMayCallProviderDirectly).toBe(false);
    expect(config.mapsRoutingPolicy).toMatchObject({
      backendOnly: true,
      clientDirectGoogleFallback: false
    });
    expect(config.notificationPolicy).toMatchObject({
      androidNativePersistentSlotEnabled: true,
      androidPersistentNotificationId: 43001,
      iosLiveActivityEnabled: false,
      iosLiveActivityMode: 'disabled',
      iosNotificationFallbackEnabled: true
    });
    expect(config.supportPolicy.autoReplyEnabled).toBe(false);
  });

  it('applies matching safe overrides and ignores unsupported domains', async () => {
    mockGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'ovr_1',
          data: () => ({
            status: 'active',
            scope: 'users',
            userIds: ['user_1'],
            priority: 10,
            config: {
              featureGates: { smartPushEnabled: true },
              paymentRuntime: { appMayCallProviderDirectly: true }
            }
          })
        }
      ]
    });
    const service = new RuntimeConfigService({ cacheTtlMs: 0 });
    const config = await service.buildEffectiveConfig({ userId: 'user_1' });

    expect(config.featureGates.smartPushEnabled).toBe(true);
    expect(config.paymentRuntime.appMayCallProviderDirectly).toBe(false);
    expect(config.appliedOverrides).toEqual([
      expect.objectContaining({ overrideId: 'ovr_1' })
    ]);
  });

  it('requires allowlist for user scoped overrides', async () => {
    const service = new RuntimeConfigService({ cacheTtlMs: 0 });
    const result = service.validateOverridePayload({
      scope: 'users',
      config: { featureGates: { smartPushEnabled: true } }
    });

    expect(result).toMatchObject({
      ok: false,
      error: 'Overrides por usuário/telefone precisam de allowlist'
    });
  });

  it('upserts overrides and records history without secrets', async () => {
    mockGet.mockResolvedValue({ exists: false, data: () => ({}) });
    const service = new RuntimeConfigService({ cacheTtlMs: 0 });
    const result = await service.upsertOverride(
      {
        overrideId: 'ovr_1',
        scope: 'canary',
        userIds: ['user_1'],
        status: 'paused',
        config: {
          featureGates: { leafDelasEnabled: false },
          token: 'must-not-persist'
        }
      },
      { id: 'admin_1' }
    );

    expect(result.success).toBe(true);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        config: { featureGates: { leafDelasEnabled: false } },
        updatedBy: 'admin_1'
      }),
      { merge: true }
    );
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      action: 'runtime_override.created',
      actorId: 'admin_1'
    }));
  });
});
