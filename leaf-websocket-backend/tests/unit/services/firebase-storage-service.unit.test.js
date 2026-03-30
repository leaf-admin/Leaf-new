jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

describe('firebase-storage-service', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('usa helper centralizado do RTDB para fallback da CNH', async () => {
    const getFromRealtimeDBMock = jest
      .fn()
      .mockResolvedValueOnce({ fileUrl: 'https://files.example/cnh-front.png' });

    jest.doMock('../../../firebase-config', () => ({
      initializeFirebase: jest.fn(),
      getStorage: jest.fn(() => ({})),
      getFirestore: jest.fn(() => null),
      getFromRealtimeDB: (...args) => getFromRealtimeDBMock(...args)
    }));

    const FirebaseStorageService = require('../../../services/firebase-storage-service');
    const service = new FirebaseStorageService();
    const result = await service.getCNHUrl('driver-1');

    expect(result).toBe('https://files.example/cnh-front.png');
    expect(getFromRealtimeDBMock).toHaveBeenCalledWith('users/driver-1/documents/cnh');
  });
});
