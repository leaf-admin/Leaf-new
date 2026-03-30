jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(),
  getRealtimeDB: jest.fn()
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn()
  }
}));

describe('city-activation-state-service', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('prefere Firestore quando a configuração já existe', async () => {
    const firebaseConfig = require('../../../firebase-config');
    const firestoreData = {
      states: {
        SP: {
          enabled: true
        }
      }
    };

    const firestoreDoc = {
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => firestoreData
      })
    };

    firebaseConfig.getFirestore.mockReturnValue({
      collection: jest.fn().mockReturnValue({
        doc: jest.fn().mockReturnValue(firestoreDoc)
      })
    });
    firebaseConfig.getRealtimeDB.mockReturnValue({
      ref: jest.fn()
    });

    const service = require('../../../services/city-activation-state-service');
    const result = await service.getConfig();

    expect(result).toEqual(firestoreData);
    expect(firestoreDoc.get).toHaveBeenCalledTimes(1);
  });

  it('importa do RTDB legado para Firestore quando o documento ainda não existe', async () => {
    const firebaseConfig = require('../../../firebase-config');
    const legacyConfig = {
      states: {
        RJ: {
          enabled: true,
          cities: {
            rio: { active: true }
          }
        }
      }
    };

    const firestoreSet = jest.fn().mockResolvedValue(undefined);
    const firestoreDoc = {
      get: jest.fn().mockResolvedValue({
        exists: false
      }),
      set: firestoreSet
    };
    const firestore = {
      collection: jest.fn().mockReturnValue({
        doc: jest.fn().mockReturnValue(firestoreDoc)
      })
    };
    const legacyOnce = jest.fn().mockResolvedValue({
      val: () => legacyConfig
    });

    firebaseConfig.getFirestore.mockReturnValue(firestore);
    firebaseConfig.getRealtimeDB.mockReturnValue({
      ref: jest.fn().mockReturnValue({
        once: legacyOnce
      })
    });

    const service = require('../../../services/city-activation-state-service');
    const result = await service.getConfig();

    expect(result).toEqual(legacyConfig);
    expect(legacyOnce).toHaveBeenCalledWith('value');
    expect(firestoreSet).toHaveBeenCalledWith(
      expect.objectContaining({
        ...legacyConfig,
        source: 'legacy_rtdb_import',
        importedAt: expect.any(String)
      }),
      { merge: true }
    );
  });
});
