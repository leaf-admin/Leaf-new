jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => null)
}));

const {
  CanonicalDriverDocumentApprovalService,
  sha256Buffer
} = require('../../../services/canonical-driver-document-approval-service');

function createFakeFirestore() {
  const documents = new Map();
  const snapshot = (path) => ({
    exists: documents.has(path),
    data: () => documents.get(path)
  });
  const docRef = (path) => ({
    path,
    get: jest.fn(async () => snapshot(path)),
    set: jest.fn(async (data, options = {}) => {
      const previous = documents.get(path) || {};
      documents.set(path, options.merge ? { ...previous, ...data } : data);
    }),
    collection: (name) => collectionRef(`${path}/${name}`)
  });
  const collectionRef = (path) => ({
    doc: (id) => docRef(`${path}/${id}`)
  });
  return {
    documents,
    collection: (name) => collectionRef(name),
    runTransaction: jest.fn(async (handler) => {
      const writes = [];
      const transaction = {
        get: jest.fn(async (ref) => snapshot(ref.path)),
        set: jest.fn((ref, data, options = {}) => writes.push({ ref, data, options }))
      };
      const result = await handler(transaction);
      writes.forEach(({ ref, data, options }) => {
        const previous = documents.get(ref.path) || {};
        documents.set(ref.path, options.merge ? { ...previous, ...data } : data);
      });
      return result;
    })
  };
}

function binding(overrides = {}) {
  return {
    driverId: 'driver-1',
    documentType: 'cnh',
    submissionId: 'submission-1',
    filePath: 'driver-activation/driver-1/cnh/submission-1.pdf',
    documentSha256: sha256Buffer(Buffer.from('cnh-pdf')),
    storageGeneration: '1784000000000000',
    uploadedAt: '2026-07-13T20:00:00.000Z',
    fileSize: 7,
    ...overrides
  };
}

describe('canonical-driver-document-approval-service', () => {
  test('stores a new upload as pending with immutable hash and generation', async () => {
    const firestore = createFakeFirestore();
    const service = new CanonicalDriverDocumentApprovalService({
      firestoreProvider: () => firestore,
      now: () => new Date('2026-07-13T20:01:00.000Z')
    });

    await service.markPending(binding());

    expect(firestore.documents.get(
      'driver_canonical_document_approvals/driver-1/documents/cnh'
    )).toEqual(expect.objectContaining({
      status: 'pending',
      analysisStatus: 'in_review',
      submissionId: 'submission-1',
      documentSha256: binding().documentSha256,
      storageGeneration: '1784000000000000',
      approvalSource: null
    }));
  });

  test('promotes only the exact current binding after an authenticated manual review', async () => {
    const firestore = createFakeFirestore();
    let now = new Date('2026-07-13T20:01:00.000Z');
    const service = new CanonicalDriverDocumentApprovalService({
      firestoreProvider: () => firestore,
      now: () => now
    });
    await service.markPending(binding());
    now = new Date('2026-07-13T20:05:00.000Z');

    const pendingReview = await service.beginManualReview({
      ...binding(),
      action: 'approve',
      analysisStatus: 'approved',
      reviewedBy: 'admin-1',
      reviewedByEmail: 'admin@leaf.app.br'
    });

    await expect(service.requireApprovedCnh('driver-1')).rejects.toMatchObject({
      code: 'KYC_CANONICAL_APPROVED_CNH_REQUIRED'
    });

    await service.finalizeManualReview({
      ...binding(),
      reviewSyncToken: pendingReview.reviewSyncToken
    });

    await expect(service.requireApprovedCnh('driver-1')).resolves.toEqual(
      expect.objectContaining({
        status: 'approved',
        analysisStatus: 'approved',
        approvalSource: 'dashboard_manual_review',
        reviewedBy: 'admin-1',
        reviewedAt: '2026-07-13T20:05:00.000Z'
      })
    );
  });

  test('blocks manual approval while automated analysis is still in review', async () => {
    const firestore = createFakeFirestore();
    const service = new CanonicalDriverDocumentApprovalService({
      firestoreProvider: () => firestore
    });
    await service.markPending(binding());

    await expect(service.beginManualReview({
      ...binding(),
      action: 'approve',
      analysisStatus: 'in_review',
      reviewedBy: 'admin-1'
    })).rejects.toMatchObject({
      code: 'KYC_CANONICAL_DOCUMENT_ANALYSIS_NOT_APPROVED'
    });

    expect(firestore.documents.get(
      'driver_canonical_document_approvals/driver-1/documents/cnh'
    )).toMatchObject({
      status: 'pending',
      analysisStatus: 'in_review'
    });
  });

  test('revokes an approved anchor before mirroring a rejection to RTDB', async () => {
    const firestore = createFakeFirestore();
    const service = new CanonicalDriverDocumentApprovalService({
      firestoreProvider: () => firestore
    });
    await service.markPending(binding());
    await service.recordManualReview({
      ...binding(),
      action: 'approve',
      analysisStatus: 'approved',
      reviewedBy: 'admin-1'
    });

    await service.beginManualReview({
      ...binding(),
      action: 'reject',
      analysisStatus: 'approved',
      rejectionReason: 'Documento revogado',
      reviewedBy: 'admin-1'
    });

    await expect(service.requireApprovedCnh('driver-1')).rejects.toMatchObject({
      code: 'KYC_CANONICAL_APPROVED_CNH_REQUIRED'
    });
  });

  test('rejects a review when generation differs from the uploaded binding', async () => {
    const firestore = createFakeFirestore();
    const service = new CanonicalDriverDocumentApprovalService({
      firestoreProvider: () => firestore
    });
    await service.markPending(binding());

    await expect(service.recordManualReview({
      ...binding({ storageGeneration: '1784000000000001' }),
      action: 'approve',
      analysisStatus: 'approved',
      reviewedBy: 'admin-1'
    })).rejects.toMatchObject({
      code: 'KYC_CANONICAL_DOCUMENT_BINDING_MISMATCH'
    });
  });

  test('does not treat automated analysis without manual approval as a face anchor', async () => {
    const firestore = createFakeFirestore();
    const service = new CanonicalDriverDocumentApprovalService({
      firestoreProvider: () => firestore
    });
    await service.markPending(binding());
    const path = 'driver_canonical_document_approvals/driver-1/documents/cnh';
    firestore.documents.set(path, {
      ...firestore.documents.get(path),
      analysisStatus: 'approved'
    });

    await expect(service.requireApprovedCnh('driver-1')).rejects.toMatchObject({
      code: 'KYC_CANONICAL_APPROVED_CNH_REQUIRED'
    });
  });
});
