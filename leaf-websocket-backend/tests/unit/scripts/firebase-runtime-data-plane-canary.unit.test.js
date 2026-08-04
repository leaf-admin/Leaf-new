const {
  CANARY_CONFIRMATION,
  runCanary,
  validateRunId
} = require('../../../scripts/ops/smoke-firebase-runtime-data-plane.cjs');

const RUN_ID = '0123456789abcdef0123456789abcdef';

function buildEnvironment(overrides = {}) {
  return {
    [CANARY_CONFIRMATION]: 'true',
    FIREBASE_PROJECT_ID: 'leaf-test-project',
    FIREBASE_STORAGE_BUCKET: 'leaf-test-project.firebasestorage.app',
    FIREBASE_DATABASE_URL: 'https://leaf-test-project-default-rtdb.firebaseio.com',
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      project_id: 'leaf-test-project',
      client_email: 'runtime@example.invalid'
    }),
    ...overrides
  };
}

function buildAdminMock({ storageBytes = Buffer.from(RUN_ID), cleanupFailure = null } = {}) {
  const firestoreData = { runId: RUN_ID };
  const firestoreDocument = {
    set: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue({ exists: true, data: () => firestoreData }),
    update: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockImplementation(async () => {
      if (cleanupFailure === 'firestore') throw new Error('firestore cleanup failed');
    })
  };
  const realtimeReference = {
    set: jest.fn().mockResolvedValue(undefined),
    once: jest.fn().mockResolvedValue({ val: () => ({ runId: RUN_ID }) }),
    update: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockImplementation(async () => {
      if (cleanupFailure === 'rtdb') throw new Error('rtdb cleanup failed');
    })
  };
  const storageFile = {
    save: jest.fn().mockResolvedValue(undefined),
    download: jest.fn().mockResolvedValue([storageBytes]),
    setMetadata: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockImplementation(async () => {
      if (cleanupFailure === 'storage') throw new Error('storage cleanup failed');
    })
  };
  const authClient = {
    createUser: jest.fn().mockResolvedValue({ uid: `ops-canary-${RUN_ID}` }),
    getUser: jest.fn().mockResolvedValue({ uid: `ops-canary-${RUN_ID}`, disabled: true }),
    updateUser: jest.fn().mockResolvedValue(undefined),
    deleteUser: jest.fn().mockImplementation(async () => {
      if (cleanupFailure === 'auth') throw new Error('auth cleanup failed');
    })
  };
  const app = {
    delete: jest.fn().mockImplementation(async () => {
      if (cleanupFailure === 'app') throw new Error('app cleanup failed');
    })
  };
  const adminImpl = {
    credential: { cert: jest.fn().mockReturnValue({}) },
    initializeApp: jest.fn().mockReturnValue(app),
    firestore: jest.fn().mockReturnValue({
      collection: jest.fn().mockReturnValue({ doc: jest.fn().mockReturnValue(firestoreDocument) })
    }),
    database: jest.fn().mockReturnValue({
      ref: jest.fn().mockReturnValue(realtimeReference)
    }),
    storage: jest.fn().mockReturnValue({
      bucket: jest.fn().mockReturnValue({ file: jest.fn().mockReturnValue(storageFile) })
    }),
    auth: jest.fn().mockReturnValue(authClient)
  };
  return {
    adminImpl,
    app,
    authClient,
    firestoreDocument,
    realtimeReference,
    storageFile
  };
}

describe('Firebase runtime data-plane canary', () => {
  it('requires explicit production mutation confirmation before initializing Firebase', async () => {
    const { adminImpl } = buildAdminMock();
    await expect(runCanary({
      environment: buildEnvironment({ [CANARY_CONFIRMATION]: 'false' }),
      adminImpl,
      runIdFactory: () => RUN_ID
    })).rejects.toThrow(`${CANARY_CONFIRMATION}=true é obrigatório`);
    expect(adminImpl.initializeApp).not.toHaveBeenCalled();
  });

  it('rejects unscoped identifiers before touching the data plane', async () => {
    const { adminImpl } = buildAdminMock();
    await expect(runCanary({
      environment: buildEnvironment({ FIREBASE_DATABASE_URL: 'https://example.com' }),
      adminImpl,
      runIdFactory: () => RUN_ID
    })).rejects.toThrow('FIREBASE_DATABASE_URL inválida');
    expect(() => validateRunId('../operational')).toThrow('Run ID inválido');
    expect(adminImpl.initializeApp).not.toHaveBeenCalled();
  });

  it('proves create, read, update and cleanup across each Firebase data plane', async () => {
    const mocks = buildAdminMock();
    const report = await runCanary({
      environment: buildEnvironment(),
      adminImpl: mocks.adminImpl,
      runIdFactory: () => RUN_ID
    });

    expect(report).toEqual({
      ok: true,
      runId: RUN_ID,
      projectId: 'leaf-test-project',
      bucketName: 'leaf-test-project.firebasestorage.app',
      checks: ['firestore', 'realtime_database', 'storage', 'firebase_auth'],
      fcm: 'covered_by_live_iam_preflight_without_sending_message'
    });
    expect(mocks.firestoreDocument.set).toHaveBeenCalled();
    expect(mocks.firestoreDocument.get).toHaveBeenCalled();
    expect(mocks.firestoreDocument.update).toHaveBeenCalled();
    expect(mocks.realtimeReference.set).toHaveBeenCalled();
    expect(mocks.realtimeReference.once).toHaveBeenCalledWith('value');
    expect(mocks.realtimeReference.update).toHaveBeenCalled();
    expect(mocks.storageFile.save).toHaveBeenCalled();
    expect(mocks.storageFile.download).toHaveBeenCalled();
    expect(mocks.storageFile.setMetadata).toHaveBeenCalled();
    expect(mocks.authClient.createUser).toHaveBeenCalled();
    expect(mocks.authClient.getUser).toHaveBeenCalled();
    expect(mocks.authClient.updateUser).toHaveBeenCalled();
    expect(mocks.authClient.deleteUser).toHaveBeenCalled();
    expect(mocks.storageFile.delete).toHaveBeenCalledWith({ ignoreNotFound: true });
    expect(mocks.realtimeReference.remove).toHaveBeenCalled();
    expect(mocks.firestoreDocument.delete).toHaveBeenCalled();
    expect(mocks.app.delete).toHaveBeenCalled();
    expect(JSON.stringify(report)).not.toContain('runtime@example.invalid');
  });

  it('cleans every resource already created when a later provider check fails', async () => {
    const mocks = buildAdminMock({ storageBytes: Buffer.from('wrong') });
    await expect(runCanary({
      environment: buildEnvironment(),
      adminImpl: mocks.adminImpl,
      runIdFactory: () => RUN_ID
    })).rejects.toThrow('Storage não confirmou a leitura');

    expect(mocks.authClient.deleteUser).not.toHaveBeenCalled();
    expect(mocks.storageFile.delete).toHaveBeenCalled();
    expect(mocks.realtimeReference.remove).toHaveBeenCalled();
    expect(mocks.firestoreDocument.delete).toHaveBeenCalled();
    expect(mocks.app.delete).toHaveBeenCalled();
  });

  it('fails closed when any canary cleanup is incomplete', async () => {
    const mocks = buildAdminMock({ cleanupFailure: 'storage' });
    await expect(runCanary({
      environment: buildEnvironment(),
      adminImpl: mocks.adminImpl,
      runIdFactory: () => RUN_ID
    })).rejects.toThrow('Canário Firebase sem limpeza integral: storage:storage cleanup failed');
  });
});
