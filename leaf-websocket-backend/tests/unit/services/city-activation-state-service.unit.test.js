jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(),
  getRealtimeDB: jest.fn(),
  getFromRealtimeDB: jest.fn()
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
    firebaseConfig.getFromRealtimeDB.mockResolvedValue(null);

    const service = require('../../../services/city-activation-state-service');
    const result = await service.getConfig();

    expect(result).toEqual(firestoreData);
    expect(firestoreDoc.get).toHaveBeenCalledTimes(1);
  });

  it('não consulta o RTDB quando o documento ainda não existe', async () => {
    const firebaseConfig = require('../../../firebase-config');
    const firestoreDoc = {
      get: jest.fn().mockResolvedValue({ exists: false }),
      set: jest.fn()
    };
    firebaseConfig.getFirestore.mockReturnValue({
      collection: jest.fn().mockReturnValue({ doc: jest.fn().mockReturnValue(firestoreDoc) })
    });

    const service = require('../../../services/city-activation-state-service');
    const result = await service.getConfig();

    expect(result).toBeNull();
    expect(firebaseConfig.getFromRealtimeDB).not.toHaveBeenCalled();
    expect(firestoreDoc.set).not.toHaveBeenCalled();
  });
});
