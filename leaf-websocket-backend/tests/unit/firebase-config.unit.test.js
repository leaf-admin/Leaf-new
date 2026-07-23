describe('firebase-config legacy metrics', () => {
  const credentialEnvKeys = [
    'FIREBASE_SERVICE_ACCOUNT_JSON',
    'GOOGLE_APPLICATION_CREDENTIALS_JSON',
    'GOOGLE_APPLICATION_CREDENTIALS'
  ];
  const originalCredentialEnv = Object.fromEntries(
    credentialEnvKeys.map((key) => [key, process.env[key]])
  );
  let metricsMock;
  let refMock;
  let setMock;
  let updateMock;
  let rootUpdateMock;
  let onceMock;
  let firebaseAdminMock;
  let fsMock;
  let logStructuredMock;

  function loadModule({
    snapshotExists = true,
    snapshotValue = { ok: true },
    serviceAccountJson,
    googleCredentialsJson,
    googleCredentialsPath,
    credentialFileContent = JSON.stringify({
      project_id: 'leaf-app',
      client_email: 'firebase-admin@leaf-app.iam.gserviceaccount.com',
      private_key: 'test-private-key'
    }),
    credentialFileExists = true
  } = {}) {
    jest.resetModules();

    for (const key of credentialEnvKeys) {
      delete process.env[key];
    }
    if (serviceAccountJson !== undefined) {
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON = serviceAccountJson;
    }
    if (googleCredentialsJson !== undefined) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = googleCredentialsJson;
    }
    if (googleCredentialsPath !== undefined) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = googleCredentialsPath;
    }

    metricsMock = {
      recordLegacyDependencyAccess: jest.fn()
    };

    setMock = jest.fn().mockResolvedValue(undefined);
    updateMock = jest.fn().mockResolvedValue(undefined);
    rootUpdateMock = jest.fn().mockResolvedValue(undefined);
    onceMock = jest.fn().mockResolvedValue({
      exists: () => snapshotExists,
      val: () => snapshotValue
    });
    refMock = jest.fn((path) => {
      if (path === undefined || path === '') {
        return {
          update: rootUpdateMock
        };
      }

      return {
        set: setMock,
        update: updateMock,
        once: onceMock
      };
    });

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

    firebaseAdminMock = {
      apps: [],
      app: jest.fn(() => ({})),
      initializeApp: jest.fn(() => ({})),
      credential: {
        cert: jest.fn(() => ({ projectId: 'leaf-app' }))
      },
      firestore: firestoreFn,
      database: databaseFn,
      storage: jest.fn(() => ({}))
    };
    jest.doMock('firebase-admin', () => firebaseAdminMock);

    fsMock = {
      existsSync: jest.fn(() => credentialFileExists),
      readFileSync: jest.fn(() => credentialFileContent)
    };
    jest.doMock('fs', () => fsMock);

    jest.doMock('../../utils/prometheus-metrics', () => ({
      metrics: metricsMock
    }));

    jest.doMock('../../services/circuit-breaker-service', () => ({
      execute: jest.fn(async (_name, run, _fallback) => run())
    }));

    logStructuredMock = jest.fn();
    jest.doMock('../../utils/logger', () => ({
      logStructured: logStructuredMock
    }));

    jest.doMock('../../utils/trace-context', () => ({}));

    return require('../../firebase-config');
  }

  afterEach(() => {
    jest.clearAllMocks();
    for (const key of credentialEnvKeys) {
      const originalValue = originalCredentialEnv[key];
      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    }
  });

  test('prioriza GOOGLE_APPLICATION_CREDENTIALS antes do arquivo legado', () => {
    const credentialsPath = '/app/firebase-credentials.json';
    const serviceAccount = {
      project_id: 'leaf-app-mounted',
      client_email: 'mounted@leaf-app.iam.gserviceaccount.com',
      private_key: 'mounted-private-key'
    };
    const firebaseConfig = loadModule({
      googleCredentialsPath: credentialsPath,
      credentialFileContent: JSON.stringify(serviceAccount)
    });

    expect(firebaseConfig.initializeFirebase()).toBeTruthy();
    expect(fsMock.existsSync).toHaveBeenCalledWith(credentialsPath);
    expect(fsMock.readFileSync).toHaveBeenCalledWith(credentialsPath, 'utf8');
    expect(firebaseAdminMock.credential.cert).toHaveBeenCalledWith(serviceAccount);
  });

  test('mantém JSON inline prioritário sobre GOOGLE_APPLICATION_CREDENTIALS', () => {
    const inlineServiceAccount = {
      project_id: 'leaf-app-inline',
      client_email: 'inline@leaf-app.iam.gserviceaccount.com',
      private_key: 'inline-private-key'
    };
    const firebaseConfig = loadModule({
      serviceAccountJson: JSON.stringify(inlineServiceAccount),
      googleCredentialsPath: '/app/firebase-credentials.json'
    });

    expect(firebaseConfig.initializeFirebase()).toBeTruthy();
    expect(firebaseAdminMock.credential.cert).toHaveBeenCalledWith(inlineServiceAccount);
    expect(fsMock.readFileSync).not.toHaveBeenCalled();
  });

  test('não inclui conteúdo de credencial inválida nos logs', () => {
    const secretMarker = 'DO-NOT-LOG-PRIVATE-KEY';
    const firebaseConfig = loadModule({
      googleCredentialsPath: '/app/firebase-credentials.json',
      credentialFileContent: `{"private_key":"${secretMarker}",invalid-json}`
    });

    expect(firebaseConfig.initializeFirebase()).toBeNull();
    expect(JSON.stringify(logStructuredMock.mock.calls)).not.toContain(secretMarker);
    expect(logStructuredMock).toHaveBeenCalledWith(
      'error',
      'Erro ao inicializar Firebase',
      expect.objectContaining({
        error: 'Firebase credentials inválidas em GOOGLE_APPLICATION_CREDENTIALS'
      })
    );
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

  test('registra set bem-sucedido no Realtime DB', async () => {
    const firebaseConfig = loadModule();
    firebaseConfig.getRealtimeDB();

    const result = await firebaseConfig.setRealtimeDB('operations/test', {
      enabled: true
    });

    expect(result).toBe(true);
    expect(refMock).toHaveBeenCalledWith('operations/test');
    expect(setMock).toHaveBeenCalledWith({
      enabled: true
    });
    expect(metricsMock.recordLegacyDependencyAccess).toHaveBeenCalledWith(expect.objectContaining({
      dependency: 'realtime_db',
      operation: 'set',
      result: 'success'
    }));
  });

  test('registra update raiz bem-sucedido no Realtime DB', async () => {
    const firebaseConfig = loadModule();
    firebaseConfig.getRealtimeDB();

    const result = await firebaseConfig.updateRealtimeDBRoot({
      'ratings/rating-1': { rating: 5 }
    });

    expect(result).toBe(true);
    expect(refMock).toHaveBeenCalledWith();
    expect(rootUpdateMock).toHaveBeenCalledWith({
      'ratings/rating-1': { rating: 5 }
    });
    expect(metricsMock.recordLegacyDependencyAccess).toHaveBeenCalledWith(expect.objectContaining({
      dependency: 'realtime_db',
      operation: 'update_root',
      result: 'success'
    }));
  });
});
