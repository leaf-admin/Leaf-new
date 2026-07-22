jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

jest.mock('firebase-admin', () => ({
  apps: [{}]
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

  test('downloads the exact approved Storage generation and returns integrity metadata', async () => {
    const file = {
      download: jest.fn(async () => [Buffer.from('approved-cnh-pdf')]),
      getMetadata: jest.fn(async () => [{
        generation: '1784000000000000',
        size: '16',
        contentType: 'application/pdf',
        metadata: {
          driverId: 'driver-1',
          documentType: 'cnh'
        }
      }])
    };
    const bucket = { file: jest.fn(() => file) };
    const storage = { bucket: jest.fn(() => bucket) };
    jest.doMock('../../../firebase-config', () => ({
      initializeFirebase: jest.fn(),
      getStorage: jest.fn(() => storage),
      getFirestore: jest.fn(() => null),
      getFromRealtimeDB: jest.fn()
    }));

    const FirebaseStorageService = require('../../../services/firebase-storage-service');
    const service = new FirebaseStorageService();
    const result = await service.downloadStoragePath(
      'driver-activation/driver-1/cnh/current.pdf',
      { generation: '1784000000000000', includeMetadata: true }
    );

    expect(bucket.file).toHaveBeenCalledWith(
      'driver-activation/driver-1/cnh/current.pdf',
      { generation: '1784000000000000' }
    );
    expect(result.buffer).toEqual(Buffer.from('approved-cnh-pdf'));
    expect(result.metadata.generation).toBe('1784000000000000');
    expect(result.metadata.customMetadata).toEqual({
      driverId: 'driver-1',
      documentType: 'cnh'
    });
  });

  test('fails closed when the downloaded Storage generation differs', async () => {
    const storage = {
      bucket: jest.fn(() => ({
        file: jest.fn(() => ({
          download: jest.fn(async () => [Buffer.from('cnh')]),
          getMetadata: jest.fn(async () => [{ generation: '1784000000000001' }])
        }))
      }))
    };
    jest.doMock('../../../firebase-config', () => ({
      initializeFirebase: jest.fn(),
      getStorage: jest.fn(() => storage),
      getFirestore: jest.fn(() => null),
      getFromRealtimeDB: jest.fn()
    }));

    const FirebaseStorageService = require('../../../services/firebase-storage-service');
    const service = new FirebaseStorageService();

    await expect(service.downloadStoragePath(
      'driver-activation/driver-1/cnh/current.pdf',
      { generation: '1784000000000000' }
    )).rejects.toMatchObject({ code: 'FIREBASE_STORAGE_GENERATION_MISMATCH' });
  });
});
