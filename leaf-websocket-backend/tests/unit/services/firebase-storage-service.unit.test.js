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

  test('baixa exatamente a generation aprovada e retorna metadados canônicos', async () => {
    const imageBuffer = Buffer.from('approved-cnh');
    const download = jest.fn().mockResolvedValue([imageBuffer]);
    const getMetadata = jest.fn().mockResolvedValue([{
      generation: '1737000000000000',
      size: String(imageBuffer.length),
      contentType: 'application/pdf',
      md5Hash: 'canonical-md5'
    }]);
    const file = jest.fn(() => ({ download, getMetadata }));
    const bucket = jest.fn(() => ({ file }));

    jest.doMock('firebase-admin', () => ({ apps: [{}] }));
    jest.doMock('../../../firebase-config', () => ({
      initializeFirebase: jest.fn(),
      getStorage: jest.fn(() => ({ bucket })),
      getFirestore: jest.fn(() => null),
      getFromRealtimeDB: jest.fn()
    }));

    const FirebaseStorageService = require('../../../services/firebase-storage-service');
    const service = new FirebaseStorageService();
    const result = await service.downloadStoragePath(
      'driver-activation/driver-1/cnh/document.pdf',
      { generation: '1737000000000000', includeMetadata: true }
    );

    expect(file).toHaveBeenCalledWith(
      'driver-activation/driver-1/cnh/document.pdf',
      { generation: '1737000000000000' }
    );
    expect(result).toEqual({
      buffer: imageBuffer,
      metadata: {
        generation: '1737000000000000',
        size: String(imageBuffer.length),
        contentType: 'application/pdf',
        md5Hash: 'canonical-md5'
      }
    });
  });

  test('falha fechada quando a generation baixada diverge da aprovação', async () => {
    const download = jest.fn().mockResolvedValue([Buffer.from('approved-cnh')]);
    const getMetadata = jest.fn().mockResolvedValue([{
      generation: '1737000000000001'
    }]);
    const file = jest.fn(() => ({ download, getMetadata }));
    const bucket = jest.fn(() => ({ file }));

    jest.doMock('firebase-admin', () => ({ apps: [{}] }));
    jest.doMock('../../../firebase-config', () => ({
      initializeFirebase: jest.fn(),
      getStorage: jest.fn(() => ({ bucket })),
      getFirestore: jest.fn(() => null),
      getFromRealtimeDB: jest.fn()
    }));

    const FirebaseStorageService = require('../../../services/firebase-storage-service');
    const service = new FirebaseStorageService();

    await expect(service.downloadStoragePath(
      'driver-activation/driver-1/cnh/document.pdf',
      { generation: '1737000000000000', includeMetadata: true }
    )).rejects.toMatchObject({
      code: 'FIREBASE_STORAGE_GENERATION_MISMATCH'
    });
  });
});
