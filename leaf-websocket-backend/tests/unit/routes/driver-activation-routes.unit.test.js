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

const mockFirestoreUserGet = jest.fn();
const mockFirestoreUserDoc = jest.fn(() => ({
  get: mockFirestoreUserGet
}));
const mockFirestoreUsersCollection = jest.fn(() => ({
  doc: mockFirestoreUserDoc
}));
const mockFirestore = {
  collection: jest.fn((collectionName) => {
    if (collectionName === 'users') {
      return mockFirestoreUsersCollection();
    }
    throw new Error(`Unexpected Firestore collection: ${collectionName}`);
  })
};

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
const mockSetConsentBackgroundCheck = jest.fn();
const mockRecomputeDriverActivationStatus = jest.fn();
const mockSyncDriverApplication = jest.fn();
const mockRecordRealtimeUpdate = jest.fn();
const mockAssertCnhUploadAllowed = jest.fn();

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
  getFirestore: jest.fn(() => mockFirestore),
  getRealtimeDB: jest.fn(() => mockRealtimeDb)
}));

jest.mock('../../../services/driver-document-analysis-queue', () => ({
  driverDocumentAnalysisQueue: {
    enqueue: (...args) => mockQueueEnqueue(...args),
    getActivationSnapshot: jest.fn(),
    listActivationDocuments: jest.fn(),
    setConsentBackgroundCheck: (...args) => mockSetConsentBackgroundCheck(...args)
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

jest.mock('../../../services/kyc-identity-review-workflow-service', () => ({
  assertCnhUploadAllowed: (...args) => mockAssertCnhUploadAllowed(...args)
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

function uploadCnh(app = createApp()) {
  return request(app)
    .post('/api/drivers/me/activation/documents/cnh')
    .set('Authorization', 'Bearer firebase-token')
    .attach('pdf', Buffer.from('%PDF-1.4\n% leaf cnh test pdf'), {
      filename: 'cnh.pdf',
      contentType: 'application/pdf'
    });
}

function submitBackgroundCheckConsent(body, app = createApp()) {
  const requestBuilder = request(app)
    .post('/api/drivers/me/activation/consent/background-check')
    .set('Authorization', 'Bearer firebase-token');

  return body === undefined ? requestBuilder : requestBuilder.send(body);
}

describe('driver activation routes document upload storage boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyIdToken.mockResolvedValue({ uid: 'driver-1' });
    mockAssertCnhUploadAllowed.mockResolvedValue({ allowed: true });
    mockFirestoreUserGet.mockResolvedValue({
      exists: true,
      data: () => ({
        usertype: 'driver',
        name: 'Motorista Firestore'
      })
    });
    mockUserOnce.mockResolvedValue({
      val: () => ({
        usertype: 'driver'
      })
    });
    mockRootUpdate.mockResolvedValue(undefined);
    mockStorageFileSave.mockResolvedValue(undefined);
    mockStorageFileGetSignedUrl.mockResolvedValue(['https://storage.leaf.test/driver-activation/driver-1/crlv.pdf']);
    mockRecomputeDriverActivationStatus.mockResolvedValue({ canGoOnline: false });
    mockSetConsentBackgroundCheck.mockResolvedValue({ canGoOnline: false });
    mockSyncDriverApplication.mockResolvedValue(undefined);
  });

  it('authorizes a canonical Firestore driver when the legacy RTDB profile is empty', async () => {
    mockUserOnce.mockResolvedValueOnce({
      val: () => null
    });

    const response = await uploadCrlv();

    expect(response.status).toBe(202);
    expect(mockFirestore.collection).toHaveBeenCalledWith('users');
    expect(mockFirestoreUserDoc).toHaveBeenCalledWith('driver-1');
    expect(mockUserOnce).not.toHaveBeenCalled();
    expect(mockQueueEnqueue).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-driver from canonical Firestore even when token claims say driver', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'driver-1', userType: 'driver' });
    mockFirestoreUserGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ usertype: 'customer' })
    });

    const response = await uploadCrlv();

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      success: false,
      message: 'Endpoint disponível apenas para motoristas autenticados.'
    });
    expect(mockUserOnce).not.toHaveBeenCalled();
    expect(mockStorageFileSave).not.toHaveBeenCalled();
    expect(mockQueueEnqueue).not.toHaveBeenCalled();
  });

  it('authorizes the driver claim when the canonical profile does not declare a role', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'driver-1', userType: 'driver' });
    mockFirestoreUserGet.mockResolvedValueOnce({
      exists: false,
      data: () => null
    });
    mockUserOnce.mockResolvedValueOnce({
      val: () => null
    });

    const response = await uploadCrlv();

    expect(response.status).toBe(202);
    expect(mockUserOnce).toHaveBeenCalledTimes(1);
    expect(mockQueueEnqueue).toHaveBeenCalledTimes(1);
  });

  it('does not authorize a driver role that exists only in the legacy RTDB profile', async () => {
    mockFirestoreUserGet.mockResolvedValueOnce({
      exists: false,
      data: () => null
    });
    mockUserOnce.mockResolvedValueOnce({
      val: () => ({ usertype: 'driver' })
    });

    const response = await uploadCrlv();

    expect(response.status).toBe(403);
    expect(mockUserOnce).toHaveBeenCalledTimes(1);
    expect(mockStorageFileSave).not.toHaveBeenCalled();
    expect(mockQueueEnqueue).not.toHaveBeenCalled();
  });

  it('fails closed when the canonical Firestore profile lookup fails', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'driver-1', userType: 'driver' });
    mockFirestoreUserGet.mockRejectedValueOnce(new Error('firestore unavailable'));

    const response = await uploadCrlv();

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      code: 'DRIVER_PROFILE_LOOKUP_FAILED'
    });
    expect(mockUserOnce).not.toHaveBeenCalled();
    expect(mockStorageFileSave).not.toHaveBeenCalled();
    expect(mockQueueEnqueue).not.toHaveBeenCalled();
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

  it('blocks a CNH replacement while identity review is active before storing the file', async () => {
    mockAssertCnhUploadAllowed.mockRejectedValueOnce(Object.assign(
      new Error('hold'),
      { code: 'KYC_IDENTITY_REVIEW_HOLD' }
    ));

    const response = await uploadCnh();

    expect(response.status).toBe(423);
    expect(response.body).toEqual(expect.objectContaining({
      success: false,
      code: 'KYC_IDENTITY_REVIEW_HOLD'
    }));
    expect(mockStorageFileSave).not.toHaveBeenCalled();
    expect(mockQueueEnqueue).not.toHaveBeenCalled();
  });

  it('does not apply the CNH identity-review guard to a CRLV upload', async () => {
    const response = await uploadCrlv();

    expect(response.status).toBe(202);
    expect(mockAssertCnhUploadAllowed).not.toHaveBeenCalled();
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

  it('rejects a background-check consent request without an explicit boolean', async () => {
    const response = await submitBackgroundCheckConsent({});

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      code: 'BACKGROUND_CHECK_CONSENT_BOOLEAN_REQUIRED'
    });
    expect(mockSetConsentBackgroundCheck).not.toHaveBeenCalled();
  });

  it('records background-check consent only when the boolean is explicit', async () => {
    const response = await submitBackgroundCheckConsent({ accepted: true });

    expect(response.status).toBe(200);
    expect(mockSetConsentBackgroundCheck).toHaveBeenCalledWith(expect.objectContaining({
      driverId: 'driver-1',
      accepted: true
    }));
  });
});
