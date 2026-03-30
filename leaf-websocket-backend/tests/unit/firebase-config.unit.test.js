describe('firebase-config legacy metrics', () => {
  let metricsMock;
  let refMock;
  let setMock;
  let updateMock;
  let onceMock;

  function loadModule({ snapshotExists = true, snapshotValue = { ok: true } } = {}) {
    jest.resetModules();

    metricsMock = {
      recordLegacyDependencyAccess: jest.fn()
    };

    setMock = jest.fn().mockResolvedValue(undefined);
    updateMock = jest.fn().mockResolvedValue(undefined);
    onceMock = jest.fn().mockResolvedValue({
      exists: () => snapshotExists,
      val: () => snapshotValue
    });
    refMock = jest.fn(() => ({
      set: setMock,
      update: updateMock,
      once: onceMock
    }));

    const firestoreFn = jest.fn(() => ({}));
    firestoreFn.FieldValue = {
      serverTimestamp: jest.fn(() => 'server-ts')
    };

    const databaseFn = jest.fn(() => ({
      ref: refMock
    }));
    databaseFn.ServerValue = {
      TIMESTAMP: 'server-ts'
    };

    jest.doMock('firebase-admin', () => ({
      apps: [],
      app: jest.fn(() => ({})),
      initializeApp: jest.fn(() => ({})),
      credential: {
        cert: jest.fn(() => ({ projectId: 'leaf-app' }))
      },
      firestore: firestoreFn,
      database: databaseFn,
      storage: jest.fn(() => ({}))
    }));

    jest.doMock('fs', () => ({
      existsSync: jest.fn(() => true)
    }));

    jest.doMock('../../utils/prometheus-metrics', () => ({
      metrics: metricsMock
    }));

    jest.doMock('../../services/circuit-breaker-service', () => ({
      execute: jest.fn(async (_name, run, _fallback) => run())
    }));

    jest.doMock('../../utils/logger', () => ({
      logStructured: jest.fn()
    }));

    jest.doMock('../../utils/trace-context', () => ({}));

    return require('../../firebase-config');
  }

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('registra acesso bem-sucedido ao obter Realtime DB', () => {
    const firebaseConfig = loadModule();

    const db = firebaseConfig.getRealtimeDB();

    expect(db).toBeTruthy();
    expect(metricsMock.recordLegacyDependencyAccess).toHaveBeenCalledWith(expect.objectContaining({
      dependency: 'realtime_db',
      operation: 'get_instance',
      result: 'success'
    }));
  });

  test('registra escrita bem-sucedida no Realtime DB', async () => {
    const firebaseConfig = loadModule();
    firebaseConfig.getRealtimeDB();

    const result = await firebaseConfig.syncToRealtimeDB('drivers/test/status', { online: true });

    expect(result).toBe(true);
    expect(refMock).toHaveBeenCalledWith('drivers/test/status');
    expect(setMock).toHaveBeenCalled();
    expect(metricsMock.recordLegacyDependencyAccess).toHaveBeenCalledWith(expect.objectContaining({
      dependency: 'realtime_db',
      operation: 'write',
      result: 'success'
    }));
  });

  test('registra leitura vazia quando snapshot não existe', async () => {
    const firebaseConfig = loadModule({
      snapshotExists: false,
      snapshotValue: null
    });
    firebaseConfig.getRealtimeDB();

    const result = await firebaseConfig.getFromRealtimeDB('drivers/test');

    expect(result).toBeNull();
    expect(onceMock).toHaveBeenCalledWith('value');
    expect(metricsMock.recordLegacyDependencyAccess).toHaveBeenCalledWith(expect.objectContaining({
      dependency: 'realtime_db',
      operation: 'read',
      result: 'empty'
    }));
  });

  test('registra update bem-sucedido no Realtime DB', async () => {
    const firebaseConfig = loadModule();
    firebaseConfig.getRealtimeDB();

    const result = await firebaseConfig.updateRealtimeDB('users/test-driver', {
      kycStatus: 'approved'
    });

    expect(result).toBe(true);
    expect(refMock).toHaveBeenCalledWith('users/test-driver');
    expect(updateMock).toHaveBeenCalledWith({
      kycStatus: 'approved'
    });
    expect(metricsMock.recordLegacyDependencyAccess).toHaveBeenCalledWith(expect.objectContaining({
      dependency: 'realtime_db',
      operation: 'update',
      result: 'success'
    }));
  });
});
