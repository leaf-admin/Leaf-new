const mockCollectionGet = jest.fn();
const mockCollectionDocSet = jest.fn();
const mockCollectionDocGet = jest.fn();
const mockRealtimeOnce = jest.fn();
const mockRealtimeRef = jest.fn(() => ({
  once: mockRealtimeOnce
}));
const mockFirestoreCollection = jest.fn(() => ({
  get: mockCollectionGet,
  doc: jest.fn(() => ({
    get: mockCollectionDocGet,
    set: mockCollectionDocSet
  }))
}));

jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP')
    }
  }
}));

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => ({
    collection: mockFirestoreCollection,
    batch: jest.fn(() => ({
      set: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined)
    }))
  })),
  getRealtimeDB: jest.fn(() => ({
    ref: mockRealtimeRef
  }))
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn()
}));

function mockFirestoreApplications(applications = []) {
  mockCollectionGet.mockResolvedValue({
    docs: applications.map((application) => ({
      data: () => application
    }))
  });
}

describe('driver-application-service', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    mockFirestoreApplications([]);
    mockRealtimeOnce.mockResolvedValue({ val: () => ({}) });
    service = require('../../../services/driver-application-service');
  });

  it('does not mark applications with only MEI documents as in_review while MEI is not required', async () => {
    const application = await service.buildApplication('driver_mei', {
      db: {},
      carsByDriverId: {},
      userVehiclesRaw: {},
      vehiclesRaw: {},
      userData: {
        usertype: 'driver',
        firstName: 'Maria',
        lastName: 'Silva',
        documents: {
          mei: {
            status: 'pending',
            fileUrl: 'https://storage.test/mei.pdf',
            fileType: 'application/pdf',
            uploadedAt: '2026-05-20T12:00:00.000Z'
          }
        }
      }
    });

    expect(application).toMatchObject({
      driverId: 'driver_mei',
      status: 'pending'
    });
    expect(application.documents).not.toHaveProperty('mei');
    expect(application.documents.all_documents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'mei',
        status: 'pending',
        fileUrl: 'https://storage.test/mei.pdf'
      })
    ]));
  });

  it('excludes MEI from the review queue and skips document requests that are not submissions', async () => {
    mockFirestoreApplications([
      {
        id: 'driver_mei',
        driverId: 'driver_mei',
        driver: {
          name: 'Maria Silva',
          email: 'maria@leaf.test',
          approved: false,
          status: 'pending'
        },
        documents: {
          all_documents: [
            {
              type: 'mei',
              status: 'pending',
              fileUrl: 'https://storage.test/mei.pdf',
              fileName: 'mei.pdf',
              fileType: 'application/pdf',
              uploadedAt: '2026-05-20T12:00:00.000Z'
            },
            {
              type: 'cnh',
              status: 'requested',
              requestStatus: 'requested',
              requestedAt: '2026-05-21T09:00:00.000Z'
            },
            {
              type: 'antecedentes_criminais',
              status: 'pending',
              fileUrl: 'https://storage.test/background.pdf',
              fileName: 'background.pdf',
              fileType: 'application/pdf',
              uploadedAt: '2026-05-21T10:00:00.000Z'
            }
          ]
        }
      }
    ]);

    const result = await service.listReviewQueue({
      documentType: 'all',
      status: 'pending'
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      driverId: 'driver_mei',
      documentType: 'antecedentes_criminais',
      status: 'pending',
      fileName: 'background.pdf'
    });
    expect(result.summary).toMatchObject({
      total: 1,
      byStatus: {
        pending: 1,
        approved: 0,
        rejected: 0
      }
    });
  });

  it('builds a lightweight review queue summary from denormalized counters', async () => {
    mockRealtimeOnce.mockResolvedValue({
      val: () => ({
        cnh: {
          pending: 2,
          approved: 4
        },
        crlv: {
          pending: '3',
          rejected: 1
        }
      })
    });

    const result = await service.getReviewQueueSummary();

    expect(mockRealtimeRef).toHaveBeenCalledWith('driver_documents_index_stats');
    expect(result).toMatchObject({
      source: 'driver_documents_index_stats',
      summary: {
        total: 10,
        byStatus: {
          pending: 5,
          approved: 4,
          rejected: 1
        }
      }
    });
  });

  it('prefers the active canonical CRLV vehicle over the legacy cars mirror', async () => {
    const application = await service.buildApplication('driver_vehicle', {
      db: {},
      carsByDriverId: {
        driver_vehicle: [{
          carMake: 'Legacy',
          carModel: 'Car',
          carNumber: 'OLD0001',
          carColor: 'Cinza',
        }],
      },
      userVehiclesRaw: {
        uv_1: {
          vehicleId: 'vehicle_1',
          isActive: true,
          status: 'approved',
          approved: true,
        },
      },
      vehiclesRaw: {
        vehicle_1: {
          brand: 'Honda',
          model: 'City',
          plate: 'RJA2D41',
          color: 'BRANCO',
          year: 2024,
          ocrData: { source: 'crlv_pdf_ocr' },
        },
      },
      userData: {
        usertype: 'driver',
        approved: true,
        firstName: 'Maria',
      },
    });

    expect(application.vehicle).toEqual({
      make: 'Honda',
      model: 'City',
      year: 2024,
      plate: 'RJA2D41',
      color: 'BRANCO',
      identitySource: 'crlv_pdf_ocr',
    });
    expect(application.vehicleConfig).toEqual(expect.objectContaining({
      activeVehiclePlate: 'RJA2D41',
      activeVehicleModel: 'City',
      activeVehicleColor: 'BRANCO',
      activeVehicleIdentitySource: 'crlv_pdf_ocr',
    }));
  });
});
