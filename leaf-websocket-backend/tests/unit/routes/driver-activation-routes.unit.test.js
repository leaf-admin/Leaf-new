'use strict';

jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockVerifyIdToken = jest.fn();
const mockStorageFileSave = jest.fn();
const mockStorageFileGetSignedUrl = jest.fn();
const mockStorageFile = jest.fn(() => ({
  save: mockStorageFileSave,
  getSignedUrl: mockStorageFileGetSignedUrl
}));
const mockStorageBucket = jest.fn(() => ({
  file: mockStorageFile
}));
const mockStorage = jest.fn(() => ({
  bucket: mockStorageBucket
}));

const mockUserOnce = jest.fn();
const mockRootUpdate = jest.fn();
const mockDbRef = jest.fn((path) => {
  if (path === 'users/driver-1') {
    return {
      once: mockUserOnce
    };
  }

  return {
    once: jest.fn(),
    update: mockRootUpdate
  };
});
const mockRealtimeDb = {
  ref: mockDbRef
};

const mockQueueEnqueue = jest.fn();
const mockRecomputeDriverActivationStatus = jest.fn();
const mockSyncDriverApplication = jest.fn();
const mockRecordRealtimeUpdate = jest.fn();

jest.mock('firebase-admin', () => ({
  apps: ['mock-app'],
  app: jest.fn(),
  auth: jest.fn(() => ({
    verifyIdToken: mockVerifyIdToken
  })),
  storage: mockStorage
}));

jest.mock('../../../firebase-config', () => ({
  initializeFirebase: jest.fn(),
  getRealtimeDB: jest.fn(() => mockRealtimeDb)
}));

jest.mock('../../../services/driver-document-analysis-queue', () => ({
  driverDocumentAnalysisQueue: {
    enqueue: (...args) => mockQueueEnqueue(...args),
    getActivationSnapshot: jest.fn(),
    listActivationDocuments: jest.fn(),
    setConsentBackgroundCheck: jest.fn()
  },
  ALLOWED_DRIVER_DOCUMENT_TYPES: ['cnh', 'crlv'],
  sanitizeDocumentType: (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return ['cnh', 'crlv'].includes(normalized) ? normalized : null;
  },
  recomputeDriverActivationStatus: (...args) => mockRecomputeDriverActivationStatus(...args)
}));

jest.mock('../../../services/driver-application-service', () => ({
  syncDriverApplication: (...args) => mockSyncDriverApplication(...args)
}));

jest.mock('../../../utils/prometheus-metrics', () => ({
  metrics: {
    recordRealtimeUpdate: (...args) => mockRecordRealtimeUpdate(...args)
  }
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const driverActivationRoutes = require('../../../routes/driver-activation');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/', driverActivationRoutes);
  return app;
}

function uploadCrlv(app = createApp()) {
  return request(app)
    .post('/api/drivers/me/activation/documents/crlv')
    .set('Authorization', 'Bearer firebase-token')
    .attach('pdf', Buffer.from('%PDF-1.4\n% leaf test pdf'), {
      filename: 'crlv.pdf',
      contentType: 'application/pdf'
    });
}

describe('driver activation routes document upload storage boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyIdToken.mockResolvedValue({ uid: 'driver-1' });
    mockUserOnce.mockResolvedValue({
      val: () => ({
        usertype: 'driver'
      })
    });
    mockRootUpdate.mockResolvedValue(undefined);
    mockStorageFileSave.mockResolvedValue(undefined);
    mockStorageFileGetSignedUrl.mockResolvedValue(['https://storage.leaf.test/driver-activation/driver-1/crlv.pdf']);
    mockRecomputeDriverActivationStatus.mockResolvedValue({ canGoOnline: false });
    mockSyncDriverApplication.mockResolvedValue(undefined);
  });

  it('fails closed before Realtime DB mutation when Firebase Storage save fails', async () => {
    mockStorageFileSave.mockRejectedValueOnce(new Error('storage unavailable'));

    const response = await uploadCrlv();

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      code: 'DRIVER_ACTIVATION_STORAGE_UPLOAD_FAILED',
      retryable: true
    });
    expect(mockRootUpdate).not.toHaveBeenCalled();
    expect(mockSyncDriverApplication).not.toHaveBeenCalled();
    expect(mockRecomputeDriverActivationStatus).not.toHaveBeenCalled();
    expect(mockQueueEnqueue).not.toHaveBeenCalled();
    expect(mockRecordRealtimeUpdate).not.toHaveBeenCalled();
  });

  it('fails closed before queueing analysis when Firebase Storage omits a signed URL', async () => {
    mockStorageFileGetSignedUrl.mockResolvedValueOnce(['']);

    const response = await uploadCrlv();

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      code: 'DRIVER_ACTIVATION_STORAGE_UPLOAD_FAILED',
      retryable: true
    });
    expect(mockRootUpdate).not.toHaveBeenCalled();
    expect(mockQueueEnqueue).not.toHaveBeenCalled();
  });

  it('persists and enqueues document analysis only after a durable Storage URL exists', async () => {
    const response = await uploadCrlv();

    expect(response.status).toBe(202);
    expect(mockStorageFileGetSignedUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'read',
        expires: expect.any(Date)
      })
    );
    const signedUrlExpiresAt = mockStorageFileGetSignedUrl.mock.calls[0][0].expires;
    expect(signedUrlExpiresAt.toISOString()).not.toBe('2035-01-01T00:00:00.000Z');
    expect(signedUrlExpiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 25 * 60 * 60 * 1000);
    expect(mockRootUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        'driver_activation/driver-1/documents/crlv': expect.objectContaining({
          status: 'in_review',
          fileUrl: 'https://storage.leaf.test/driver-activation/driver-1/crlv.pdf',
          filePath: expect.stringContaining('driver-activation/driver-1/crlv/'),
          fileUrlExpiresAt: expect.any(String)
        }),
        'users/driver-1/documents/crlv': expect.objectContaining({
          status: 'pending',
          analysisStatus: 'in_review',
          fileUrl: 'https://storage.leaf.test/driver-activation/driver-1/crlv.pdf',
          filePath: expect.stringContaining('driver-activation/driver-1/crlv/'),
          fileUrlExpiresAt: expect.any(String)
        })
      })
    );
    expect(mockQueueEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        driverId: 'driver-1',
        documentType: 'crlv',
        fileUrl: 'https://storage.leaf.test/driver-activation/driver-1/crlv.pdf',
        filePath: expect.stringContaining('driver-activation/driver-1/crlv/'),
        fileUrlExpiresAt: expect.any(String)
      })
    );
  });
});
