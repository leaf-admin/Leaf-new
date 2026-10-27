describe('firebase-config', () => {
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
    storageFailures = 0,
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

    const firestoreInstance = {};
    const storageInstance = {};
    const firebaseAppInstance = {};
    const realtimeDatabaseInstance = { ref: refMock };
    let remainingStorageFailures = storageFailures;

    const firestoreFn = jest.fn(() => firestoreInstance);
    firestoreFn.FieldValue = {
      serverTimestamp: jest.fn(() => 'server-ts')
    };

    // The Realtime Database is retired: the module must never open it.
    const databaseFn = jest.fn(() => realtimeDatabaseInstance);
    databaseFn.ServerValue = {
      TIMESTAMP: 'server-ts'
    };

    firebaseAdminMock = {
      apps: [],
      app: jest.fn(() => firebaseAppInstance),
      initializeApp: jest.fn(() => {
        firebaseAdminMock.apps.push(firebaseAppInstance);
        return firebaseAppInstance;
      }),
      credential: {
        cert: jest.fn(() => ({ projectId: 'leaf-app' }))
      },
      firestore: firestoreFn,
      database: databaseFn,
      storage: jest.fn(() => {
        if (remainingStorageFailures > 0) {
          remainingStorageFailures -= 1;
          throw new Error('storage peer unavailable');
        }
        return storageInstance;
      })
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

  test('não publica clientes parciais e reaproveita o app ao repetir inicialização', () => {
    const firebaseConfig = loadModule({ storageFailures: 1 });

    expect(firebaseConfig.initializeFirebase()).toBeNull();
    expect(firebaseConfig.initializeFirebase()).toBeTruthy();
    expect(firebaseConfig.getFirestore()).toBeTruthy();
    expect(firebaseConfig.getStorage()).toBeTruthy();

    expect(firebaseAdminMock.initializeApp).toHaveBeenCalledTimes(1);
    expect(firebaseAdminMock.app).toHaveBeenCalledTimes(1);
    expect(firebaseAdminMock.firestore).toHaveBeenCalledTimes(2);
    expect(firebaseAdminMock.storage).toHaveBeenCalledTimes(2);
  });

  test('nunca abre o Realtime Database nem expõe os helpers RTDB', () => {
    const firebaseConfig = loadModule();

    expect(firebaseConfig.initializeFirebase()).toBeTruthy();
    expect(firebaseAdminMock.database).not.toHaveBeenCalled();
    expect(firebaseAdminMock.initializeApp).toHaveBeenCalledWith(expect.not.objectContaining({ databaseURL: expect.anything() }));
    for (const legacy of ['getRealtimeDB', 'isRealtimeDBAvailable', 'getFromRealtimeDB', 'setRealtimeDB', 'updateRealtimeDB', 'updateRealtimeDBRoot']) {
      expect(firebaseConfig[legacy]).toBeUndefined();
    }
    expect(metricsMock.recordLegacyDependencyAccess).not.toHaveBeenCalled();
  });
});
