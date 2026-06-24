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
  updateDocumentState
} = require('../../../services/driver-document-analysis-queue');

function createDb() {
  const rootUpdates = [];

  return {
    rootUpdates,
    ref(path = '') {
      return {
        once: async () => ({
          val: () => path === 'users/driver_1/documents/crlv' ? { status: 'pending' } : {}
        }),
        update: async () => undefined,
        set: async () => undefined,
        transaction: async () => ({ committed: true })
      };
    },
    recordRootUpdate(payload) {
      rootUpdates.push(payload);
    }
  };
}

describe('driver-document-analysis-queue CRLV persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('persists a normalized CRLV identity in both activation and dashboard document projections', async () => {
    const db = createDb();
    const originalRef = db.ref.bind(db);
    db.ref = jest.fn((path = '') => {
      const ref = originalRef(path);
      if (!path) {
        ref.update = async (payload) => {
          db.recordRootUpdate(payload);
        };
      }
      return ref;
    });
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
      model: 'test-model'
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
    const db = createDb();
    const originalRef = db.ref.bind(db);
    db.ref = jest.fn((path = '') => {
      const ref = originalRef(path);
      if (!path) {
        ref.update = async (payload) => {
          db.recordRootUpdate(payload);
        };
      }
      return ref;
    });
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
      model: 'test-model'
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
});
