'use strict';

jest.mock('../../../firebase-config', () => ({
  getRealtimeDB: jest.fn()
}));

jest.mock('../../../services/driver-activation-state-service', () => ({
  resolveDriverActivationState: jest.fn().mockResolvedValue({
    canGoOnline: false,
    state: 'VEHICLE_PENDING',
    label: 'Veiculo pendente',
    vehicle: {},
    liveness: {}
  })
}));

jest.mock('../../../services/driver-application-service', () => ({
  syncDriverApplication: jest.fn().mockResolvedValue(null)
}));

jest.mock('../../../services/ocr-service', () => ({}));

jest.mock('../../../services/document-ai-extraction-service', () => ({}));

jest.mock('../../../services/cnh-face-biometric-service', () => jest.fn());

jest.mock('../../../services/cnh-document-identity-validator', () => ({
  validateCnhDocumentIdentity: jest.fn()
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

jest.mock('../../../utils/prometheus-metrics', () => ({
  metrics: {
    recordRealtimeUpdate: jest.fn(),
    recordHotpathLatency: jest.fn()
  }
}));

const firebaseConfig = require('../../../firebase-config');
const driverApplicationService = require('../../../services/driver-application-service');
const {
  commitDocumentSubmissionState,
  runWithCurrentDocumentBinding,
  updateDocumentState
} = require('../../../services/driver-document-analysis-queue');

function clone(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

function splitPath(path = '') {
  return String(path || '').split('/').filter(Boolean);
}

function createDb(initialState = {}) {
  let state = clone(initialState) || {};
  const rootUpdates = [];
  const transactions = [];
  const transactionChains = new Map();

  function read(path = '') {
    const segments = splitPath(path);
    let cursor = state;
    for (const segment of segments) {
      if (!cursor || typeof cursor !== 'object') return null;
      cursor = cursor[segment];
    }
    return cursor === undefined ? null : clone(cursor);
  }

  function write(path = '', value) {
    const segments = splitPath(path);
    if (segments.length === 0) {
      state = value === null ? {} : clone(value);
      return;
    }
    let cursor = state;
    segments.slice(0, -1).forEach((segment) => {
      if (!cursor[segment] || typeof cursor[segment] !== 'object') cursor[segment] = {};
      cursor = cursor[segment];
    });
    const leaf = segments[segments.length - 1];
    if (value === null) {
      delete cursor[leaf];
    } else {
      cursor[leaf] = clone(value);
    }
  }

  function applyUpdate(basePath, payload) {
    Object.entries(payload || {}).forEach(([relativePath, value]) => {
      const targetPath = [basePath, relativePath].filter(Boolean).join('/');
      write(targetPath, value);
    });
  }

  function snapshot(path) {
    return { val: () => read(path) };
  }

  return {
    rootUpdates,
    transactions,
    read,
    ref(path = '') {
      return {
        once: async () => snapshot(path),
        update: async (payload) => {
          if (!path) rootUpdates.push(clone(payload));
          applyUpdate(path, payload);
        },
        set: async (value) => {
          write(path, value);
        },
        transaction: async (updater) => {
          const prior = transactionChains.get(path) || Promise.resolve();
          const next = prior.then(() => {
            const before = read(path);
            const proposed = updater(clone(before));
            if (proposed === undefined) {
              transactions.push({ path, before, after: before, committed: false });
              return { committed: false, snapshot: snapshot(path) };
            }
            write(path, proposed);
            const after = read(path);
            transactions.push({ path, before, after, committed: true });
            return { committed: true, snapshot: snapshot(path) };
          });
          transactionChains.set(path, next.catch(() => undefined));
          return next;
        }
      };
    }
  };
}

function documentMetadata(submissionId, documentType, marker) {
  return {
    submissionId,
    fileName: `${documentType}-${marker}.pdf`,
    fileType: 'application/pdf',
    fileSize: 1024,
    fileUrl: `https://storage.leaf.test/${documentType}-${marker}.pdf`,
    filePath: `driver-activation/driver_1/${documentType}/${marker}.pdf`,
    fileUrlExpiresAt: '2026-07-22T00:00:00.000Z',
    documentSha256: marker.repeat(64),
    storageGeneration: marker === 'a' ? '1700000000000001' : '1700000000000002',
    uploadedAt: '2026-07-21T10:00:00.000Z',
    createdAt: '2026-07-21T10:00:00.000Z'
  };
}

function currentDocument(documentType, metadata) {
  return {
    ...metadata,
    documentType,
    status: 'in_review'
  };
}

function currentUserDocument(documentType, metadata) {
  return {
    ...metadata,
    type: documentType,
    status: 'pending',
    analysisStatus: 'in_review',
    lastSubmissionId: metadata.submissionId
  };
}

function createDbWithCurrentDocument(documentType, currentMetadata, historyMetadata = []) {
  return createDb({
    driver_activation: {
      driver_1: {
        documents: {
          [documentType]: currentDocument(documentType, currentMetadata)
        },
        documents_history: Object.fromEntries(
          historyMetadata.map((metadata) => [
            metadata.submissionId,
            currentDocument(documentType, metadata)
          ])
        )
      }
    },
    users: {
      driver_1: {
        documents: {
          [documentType]: currentUserDocument(documentType, currentMetadata)
        }
      }
    },
    driver_documents_index_stats: {
      [documentType]: {
        pending: 1,
        approved: 0,
        rejected: 0
      }
    }
  });
}

describe('driver-document-analysis-queue CRLV persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('persists a normalized CRLV identity in both activation and dashboard document projections', async () => {
    const metadata = documentMetadata('submission_1', 'crlv', 'a');
    const db = createDbWithCurrentDocument('crlv', metadata, [metadata]);
    firebaseConfig.getRealtimeDB.mockReturnValue(db);

    await updateDocumentState({
      driverId: 'driver_1',
      documentType: 'crlv',
      submissionId: 'submission_1',
      status: 'approved',
      data: {
        placa: 'rja-2d41',
        modelo: 'Honda City',
        cor: 'branca',
        anoModelo: '2024',
        renavam: '123.456.789-00',
        rawText: 'conteudo sensivel que nao deve ser persistido'
      },
      extractionSource: 'pdf_text',
      model: 'test-model',
      metadata
    });

    const documentUpdate = db.rootUpdates[0];
    expect(documentUpdate['driver_activation/driver_1/documents/crlv'].data).toEqual(
      expect.objectContaining({
        plate: 'RJA2D41',
        model: 'Honda City',
        color: 'BRANCO',
        vehicleColor: 'BRANCO',
        renavam: '12345678900'
      })
    );
    expect(documentUpdate['driver_activation/driver_1/documents/crlv'].data.rawText).toBeUndefined();
    expect(documentUpdate['users/driver_1/documents/crlv'].analysisData).toEqual(
      documentUpdate['users/driver_1/documents/crlv'].extractedData
    );
    expect(driverApplicationService.syncDriverApplication).toHaveBeenCalledWith('driver_1', {
      db,
      includeRatings: false
    });
  });

  it('fails an approved CRLV update when extracted vehicle model or color is missing', async () => {
    const metadata = documentMetadata('submission_missing_color', 'crlv', 'a');
    const db = createDbWithCurrentDocument('crlv', metadata, [metadata]);
    firebaseConfig.getRealtimeDB.mockReturnValue(db);

    await updateDocumentState({
      driverId: 'driver_1',
      documentType: 'crlv',
      submissionId: 'submission_missing_color',
      status: 'approved',
      data: {
        placa: 'rja-2d41',
        modelo: 'Honda City',
        renavam: '123.456.789-00'
      },
      extractionSource: 'pdf_text',
      model: 'test-model',
      metadata
    });

    const documentUpdate = db.rootUpdates[0];
    expect(documentUpdate['driver_activation/driver_1/documents/crlv']).toMatchObject({
      status: 'failed',
      reason: 'CRLV sem dados obrigatórios de veículo (placa, RENAVAM, modelo e cor).'
    });
    expect(documentUpdate['users/driver_1/documents/crlv']).toMatchObject({
      status: 'rejected',
      analysisStatus: 'failed',
      rejectionReason: 'CRLV sem dados obrigatórios de veículo (placa, RENAVAM, modelo e cor).'
    });
    expect(documentUpdate['driver_documents_index/crlv/approved/driver_1']).toBeNull();
    expect(documentUpdate['driver_documents_index/crlv/rejected/driver_1']).toEqual(
      expect.objectContaining({
        driverId: 'driver_1',
        documentType: 'crlv',
        status: 'rejected'
      })
    );
  });

  it('keeps a concurrent stale CNH result only as superseded history', async () => {
    const staleMetadata = documentMetadata('cnh_submission_a', 'cnh', 'a');
    const currentMetadata = documentMetadata('cnh_submission_b', 'cnh', 'b');
    const db = createDbWithCurrentDocument('cnh', currentMetadata, [staleMetadata, currentMetadata]);
    firebaseConfig.getRealtimeDB.mockReturnValue(db);

    const [staleResult, currentResult] = await Promise.all([
      updateDocumentState({
        driverId: 'driver_1',
        documentType: 'cnh',
        submissionId: staleMetadata.submissionId,
        status: 'failed',
        reason: 'CNH antiga reprovada',
        data: { nome: 'Pessoa A', cpf: '11111111111' },
        extractionSource: 'pdf_text',
        model: 'test-model-a',
        metadata: staleMetadata,
        biometricState: {
          userPayload: { submissionId: staleMetadata.submissionId, embedding: [0.1] },
          activationPayload: { submissionId: staleMetadata.submissionId, status: 'generated' }
        }
      }),
      updateDocumentState({
        driverId: 'driver_1',
        documentType: 'cnh',
        submissionId: currentMetadata.submissionId,
        status: 'approved',
        data: { nome: 'Pessoa B', cpf: '22222222222' },
        extractionSource: 'pdf_text',
        model: 'test-model-b',
        metadata: currentMetadata,
        biometricState: {
          userPayload: { submissionId: currentMetadata.submissionId, embedding: [0.2] },
          activationPayload: { submissionId: currentMetadata.submissionId, status: 'generated' }
        }
      })
    ]);

    expect(staleResult).toMatchObject({ stale: true, superseded: true });
    expect(currentResult).toMatchObject({ stale: false, superseded: false });
    expect(db.read('driver_activation/driver_1/documents/cnh')).toEqual(expect.objectContaining({
      submissionId: currentMetadata.submissionId,
      documentSha256: currentMetadata.documentSha256,
      storageGeneration: currentMetadata.storageGeneration,
      status: 'approved',
      data: expect.objectContaining({ nome: 'Pessoa B' })
    }));
    expect(db.read('users/driver_1/documents/cnh')).toEqual(expect.objectContaining({
      lastSubmissionId: currentMetadata.submissionId,
      status: 'approved',
      analysisStatus: 'approved'
    }));
    expect(db.read('driver_activation/driver_1/documents_history/cnh_submission_a')).toEqual(
      expect.objectContaining({
        status: 'superseded',
        resultStatus: 'failed',
        supersededBySubmissionId: currentMetadata.submissionId,
        result: expect.objectContaining({
          status: 'failed',
          data: expect.objectContaining({ nome: 'Pessoa A' })
        })
      })
    );
    expect(db.read('driver_documents_index/cnh/rejected/driver_1')).toBeNull();
    expect(db.read('driver_documents_index/cnh/approved/driver_1')).toEqual(expect.objectContaining({
      submissionId: currentMetadata.submissionId
    }));
    expect(db.read('users/driver_1/biometrics/cnhFace')).toEqual({
      submissionId: currentMetadata.submissionId,
      embedding: [0.2]
    });
    expect(db.read('driver_activation/driver_1/biometrics/cnhFace')).toEqual({
      submissionId: currentMetadata.submissionId,
      status: 'generated'
    });
    expect(db.rootUpdates).toHaveLength(1);
    expect(driverApplicationService.syncDriverApplication).toHaveBeenCalledTimes(1);
    expect(db.transactions.filter(({ path }) => path.startsWith('driver_documents_index_stats/')))
      .toHaveLength(2);
  });

  it('never materializes the vehicle from a concurrent stale CRLV result', async () => {
    const staleMetadata = documentMetadata('crlv_submission_a', 'crlv', 'a');
    const currentMetadata = documentMetadata('crlv_submission_b', 'crlv', 'b');
    const db = createDbWithCurrentDocument('crlv', currentMetadata, [staleMetadata, currentMetadata]);
    firebaseConfig.getRealtimeDB.mockReturnValue(db);

    const [staleResult, currentResult] = await Promise.all([
      updateDocumentState({
        driverId: 'driver_1',
        documentType: 'crlv',
        submissionId: staleMetadata.submissionId,
        status: 'approved',
        data: {
          placa: 'AAA1A11',
          modelo: 'Veiculo Antigo',
          cor: 'preta',
          renavam: '11111111111'
        },
        extractionSource: 'pdf_text',
        model: 'test-model-a',
        metadata: staleMetadata
      }),
      updateDocumentState({
        driverId: 'driver_1',
        documentType: 'crlv',
        submissionId: currentMetadata.submissionId,
        status: 'approved',
        data: {
          placa: 'BBB2B22',
          modelo: 'Veiculo Atual',
          cor: 'branca',
          renavam: '22222222222'
        },
        extractionSource: 'pdf_text',
        model: 'test-model-b',
        metadata: currentMetadata
      })
    ]);

    expect(staleResult).toMatchObject({ stale: true, superseded: true, vehicleLink: null });
    expect(currentResult).toMatchObject({ stale: false, superseded: false });
    expect(db.read('driver_activation/driver_1/documents/crlv')).toEqual(expect.objectContaining({
      submissionId: currentMetadata.submissionId,
      status: 'approved',
      data: expect.objectContaining({ plate: 'BBB2B22' })
    }));
    expect(db.read('driver_activation/driver_1/documents_history/crlv_submission_a')).toEqual(
      expect.objectContaining({
        status: 'superseded',
        resultStatus: 'approved',
        supersededBySubmissionId: currentMetadata.submissionId,
        result: expect.objectContaining({
          data: expect.objectContaining({ plate: 'AAA1A11' })
        })
      })
    );
    expect(db.read('vehicle_plate_index/AAA1A11')).toBeNull();
    expect(db.read('vehicles/vehicle_crlv_AAA1A11')).toBeNull();
    expect(db.read('user_vehicles/driver_1/crlv_AAA1A11')).toBeNull();
    expect(db.read('vehicle_plate_index/BBB2B22')).toBe('vehicle_crlv_BBB2B22');
    expect(db.read('driver_documents_index/crlv/approved/driver_1')).toEqual(expect.objectContaining({
      submissionId: currentMetadata.submissionId
    }));
    expect(db.rootUpdates).toHaveLength(1);
    expect(driverApplicationService.syncDriverApplication).toHaveBeenCalledTimes(1);
    expect(db.transactions.filter(({ path }) => path.startsWith('driver_documents_index_stats/')))
      .toHaveLength(2);
  });

  it('rejects a stale CNH review racing a newer upload commit', async () => {
    const reviewedMetadata = documentMetadata('cnh_review_a', 'cnh', 'a');
    const uploadedMetadata = documentMetadata('cnh_upload_b', 'cnh', 'b');
    const db = createDbWithCurrentDocument('cnh', reviewedMetadata, [reviewedMetadata]);
    firebaseConfig.getRealtimeDB.mockReturnValue(db);
    const staleReviewMutation = jest.fn(async ({ db: mutationDb, lease }) => {
      await lease.assertHeld();
      await mutationDb.ref().update({
        'driver_activation/driver_1/documents/cnh/status': 'failed',
        'driver_documents_index/cnh/rejected/driver_1/reviewMarker': 'stale-review'
      });
    });

    const uploadPromise = commitDocumentSubmissionState({
      db,
      driverId: 'driver_1',
      documentType: 'cnh',
      activationDocument: currentDocument('cnh', uploadedMetadata),
      userDocument: currentUserDocument('cnh', uploadedMetadata),
      updatedAt: '2026-07-21T11:00:00.000Z'
    });
    const staleReviewPromise = runWithCurrentDocumentBinding({
      db,
      driverId: 'driver_1',
      documentType: 'cnh',
      expectedBinding: reviewedMetadata,
      scope: 'dashboard_document_review'
    }, staleReviewMutation);

    const [uploadResult, staleReviewResult] = await Promise.allSettled([
      uploadPromise,
      staleReviewPromise
    ]);

    expect(uploadResult.status).toBe('fulfilled');
    expect(staleReviewResult.status).toBe('rejected');
    expect(staleReviewResult.reason).toMatchObject({
      code: 'DRIVER_ACTIVATION_DOCUMENT_BINDING_MISMATCH'
    });
    expect(staleReviewMutation).not.toHaveBeenCalled();
    expect(db.read('driver_activation/driver_1/documents/cnh')).toEqual(expect.objectContaining({
      submissionId: uploadedMetadata.submissionId,
      status: 'in_review'
    }));
    expect(db.read('driver_documents_index/cnh/rejected/driver_1')).toBeNull();
  });

  it('rejects a stale CRLV review racing the current OCR result', async () => {
    const reviewedMetadata = documentMetadata('crlv_review_a', 'crlv', 'a');
    const currentMetadata = documentMetadata('crlv_ocr_b', 'crlv', 'b');
    const db = createDbWithCurrentDocument('crlv', currentMetadata, [reviewedMetadata, currentMetadata]);
    firebaseConfig.getRealtimeDB.mockReturnValue(db);
    const staleReviewMutation = jest.fn(async ({ db: mutationDb, lease }) => {
      await lease.assertHeld();
      await mutationDb.ref().update({
        'driver_activation/driver_1/documents/crlv/status': 'failed',
        'driver_documents_index/crlv/rejected/driver_1/reviewMarker': 'stale-review'
      });
    });

    const ocrPromise = updateDocumentState({
      driverId: 'driver_1',
      documentType: 'crlv',
      submissionId: currentMetadata.submissionId,
      status: 'approved',
      data: {
        placa: 'CCC3C33',
        modelo: 'Veiculo Atual',
        cor: 'cinza',
        renavam: '33333333333'
      },
      extractionSource: 'pdf_text',
      model: 'test-model-b',
      metadata: currentMetadata
    });
    const staleReviewPromise = runWithCurrentDocumentBinding({
      db,
      driverId: 'driver_1',
      documentType: 'crlv',
      expectedBinding: reviewedMetadata,
      scope: 'dashboard_document_review'
    }, staleReviewMutation);

    const [ocrResult, staleReviewResult] = await Promise.allSettled([
      ocrPromise,
      staleReviewPromise
    ]);

    expect(ocrResult.status).toBe('fulfilled');
    expect(staleReviewResult.status).toBe('rejected');
    expect(staleReviewResult.reason).toMatchObject({
      code: 'DRIVER_ACTIVATION_DOCUMENT_BINDING_MISMATCH'
    });
    expect(staleReviewMutation).not.toHaveBeenCalled();
    expect(db.read('driver_activation/driver_1/documents/crlv')).toEqual(expect.objectContaining({
      submissionId: currentMetadata.submissionId,
      status: 'approved',
      data: expect.objectContaining({ plate: 'CCC3C33' })
    }));
    expect(db.read('driver_documents_index/crlv/rejected/driver_1')).toBeNull();
    expect(db.read('vehicle_plate_index/CCC3C33')).toBe('vehicle_crlv_CCC3C33');
  });
});
