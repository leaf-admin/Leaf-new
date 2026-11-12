const { SafetyIncidentService } = require('../../../services/safety-incident-service');
const { sealFinancialContext } = require('../../../services/financial-runtime-context');
const rideAnnotationStore = require('../../../services/ride-annotation-store');

// Ops review flags land on the ride annotation (native Firestore).
let annotationUpdates;
beforeEach(() => {
  annotationUpdates = [];
  jest.spyOn(rideAnnotationStore, 'updateAnnotation').mockImplementation(async (_firestore, root, id, patch) => {
    annotationUpdates.push({ root, id, patch });
  });
});
afterEach(() => jest.restoreAllMocks());

function createFirestoreMock() {
  const store = new Map();
  return {
    store,
    collection() {
      return {
        doc(id) {
          return {
            async get() {
              return {
                exists: store.has(id),
                id,
                data: () => store.get(id)
              };
            },
            async set(value, options = {}) {
              const current = store.get(id) || {};
              store.set(id, options.merge ? { ...current, ...value } : value);
            }
          };
        },
        async get() {
          return {
            docs: Array.from(store.entries()).map(([id, data]) => ({
              id,
              data: () => data
            }))
          };
        }
      };
    }
  };
}

describe('safety-incident-service', () => {
  it('creates incident, ticket and marks booking for ops review', async () => {
    const firestore = createFirestoreMock();
    const service = new SafetyIncidentService({
      firebase: {
        getFirestore: () => firestore
      },
      redis: {
        getConnection: () => ({
          hset: jest.fn(async () => 1),
          expire: jest.fn(async () => 1),
          zadd: jest.fn(async () => 1),
          zrem: jest.fn(async () => 1)
        })
      },
      queueService: {
        buildQueueMetadata: jest.fn(() => ({ ackTargetAt: '2026-04-07T18:05:00.000Z' })),
        createSupportTicket: jest.fn(async () => ({
          ticket: { id: 'ticket-1' }
        }))
      },
      trustService: {
        recordSignal: jest.fn()
      }
    });

    const incident = await service.createIncident({
      bookingId: 'booking-1',
      userId: 'passenger-1',
      userType: 'passenger',
      city: 'rio',
      regionHash: 'abc123',
      category: 'safety',
      severity: 'high',
      description: 'Motorista desviou da rota'
    });

    expect(incident.ticketId).toBe('ticket-1');
    expect(annotationUpdates[0]).toMatchObject({ root: 'bookings', id: 'booking-1' });
    expect(annotationUpdates[0].patch).toEqual(expect.objectContaining({
      opsReviewRequired: true,
      opsReviewIncidentId: incident.incidentId
    }));
  });

  it('records trust signal when confirmed passenger incident is resolved', async () => {
    const firestore = createFirestoreMock();
    const trustService = {
      recordSignal: jest.fn(async () => ({}))
    };
    const service = new SafetyIncidentService({
      firebase: { getFirestore: () => firestore, getRealtimeDB: () => null },
      redis: { getConnection: () => ({ hset: jest.fn(), expire: jest.fn(), zadd: jest.fn(), zrem: jest.fn() }) },
      queueService: {
        buildQueueMetadata: jest.fn(() => ({ ackTargetAt: '2026-04-07T18:05:00.000Z' })),
        createSupportTicket: jest.fn(async () => ({ ticket: { id: 'ticket-1' } }))
      },
      trustService
    });

    const incident = await service.createIncident({
      userId: 'passenger-1',
      userType: 'passenger',
      description: 'Fraude confirmada',
      category: 'fraud',
      severity: 'high'
    });

    await service.resolveIncident(incident.incidentId, {
      actorId: 'ops-1',
      resolutionCode: 'confirmed_incident'
    });

    expect(trustService.recordSignal).toHaveBeenCalledWith('passenger-1', 'confirmed_incident', expect.objectContaining({
      incidentId: incident.incidentId
    }));
  });

  it('isolates a sandbox incident, linked support ticket and booking review marker', async () => {
    const store = new Map();
    const collection = jest.fn((collectionName) => ({
      doc: (id) => ({
        set: async (value) => store.set(`${collectionName}/${id}`, value)
      })
    }));
    const redis = {
      hset: jest.fn(async () => 1),
      expire: jest.fn(async () => 1),
      zadd: jest.fn(async () => 1),
      zrem: jest.fn(async () => 1)
    };
    const queueService = {
      buildQueueMetadata: jest.fn(() => ({ ackTargetAt: '2026-07-13T12:05:00.000Z' })),
      createSupportTicket: jest.fn(async () => ({ ticket: { id: 'sandbox-ticket-1' } }))
    };
    const service = new SafetyIncidentService({
      firebase: {
        getFirestore: () => ({ collection })
      },
      redis: { getConnection: () => redis },
      queueService,
      trustService: { recordSignal: jest.fn() }
    });
    const financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable',
      paymentProfileSource: 'firestore',
      testUserSandbox: true
    });

    const incident = await service.createIncident({
      bookingId: 'sandbox-booking-1',
      userId: 'sandbox-passenger-1',
      userType: 'passenger',
      category: 'safety',
      severity: 'high',
      description: 'Incidente de teste isolado',
      persistenceContext: { financialContext }
    });

    expect(collection).toHaveBeenCalledWith('sandbox_ops_incidents');
    expect(collection).not.toHaveBeenCalledWith('ops_incidents');
    expect(annotationUpdates).toEqual([
      expect.objectContaining({ root: 'sandbox_bookings', id: 'sandbox-booking-1' })
    ]);
    expect(queueService.createSupportTicket).toHaveBeenCalledWith(expect.objectContaining({
      persistenceContext: expect.objectContaining({ namespace: 'sandbox' })
    }));
    expect(redis.hset).toHaveBeenCalledWith(
      expect.stringMatching(/^sandbox:ops:incident:/),
      expect.any(Object)
    );
    expect(redis.zadd).toHaveBeenCalledWith(
      'sandbox:ops:incidents:open',
      expect.any(Number),
      incident.incidentId
    );
    expect(redis.hset).not.toHaveBeenCalledWith(
      'booking:sandbox-booking-1',
      expect.any(Object)
    );
    expect(store.get(`sandbox_ops_incidents/${incident.incidentId}`)).toMatchObject({
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId
    });
  });

  it('fails before creating an incident when a sandbox signal lost its context', async () => {
    const collection = jest.fn();
    const queueService = {
      buildQueueMetadata: jest.fn(),
      createSupportTicket: jest.fn()
    };
    const service = new SafetyIncidentService({
      firebase: {
        getFirestore: () => ({ collection }),
        getRealtimeDB: () => null
      },
      redis: { getConnection: () => null },
      queueService,
      trustService: { recordSignal: jest.fn() }
    });

    await expect(service.createIncident({
      userId: 'sandbox-passenger-1',
      description: 'Contexto ausente',
      persistenceContext: { financialNamespace: 'sandbox' }
    })).rejects.toMatchObject({
      code: 'FINANCIAL_SANDBOX_CONTEXT_LOST'
    });
    expect(collection).not.toHaveBeenCalled();
    expect(queueService.createSupportTicket).not.toHaveBeenCalled();
  });
});

describe('safety-incident-service emergency package', () => {
  function createNestedFirestore() {
    const docs = new Map();
    const docRef = (path) => ({
      async get() {
        return { exists: docs.has(path), id: path.split('/').pop(), data: () => docs.get(path) };
      },
      async set(value, options = {}) {
        const current = docs.get(path) || {};
        docs.set(path, options.merge ? { ...current, ...value } : value);
      },
      collection: (name) => ({ doc: (id) => docRef(`${path}/${name}/${id}`) })
    });
    return { docs, collection: (name) => ({ doc: (id) => docRef(`${name}/${id}`) }) };
  }

  it('guarda o pacote fora do incidente e deixa no incidente só o indicador e o envio', async () => {
    const firestore = createNestedFirestore();
    const service = new SafetyIncidentService({
      firebase: { getFirestore: () => firestore },
      redis: { getConnection: () => null },
      queueService: { buildQueueMetadata: jest.fn(() => ({})) },
      trustService: { recordSignal: jest.fn() }
    });
    firestore.docs.set('ops_incidents/INC-1', { incidentId: 'INC-1', status: 'OPEN', timeline: [{ action: 'opened' }] });

    const stored = await service.attachEmergencyPackage('INC-1', {
      emergencyPackage: { version: 1, driver: { phone: '+5521900000001' } },
      publicSafetyDispatch: { status: 'disabled', agency: null }
    });

    expect(stored).toBe(true);
    const incidentDoc = firestore.docs.get('ops_incidents/INC-1');
    expect(incidentDoc.emergencyPackageAvailable).toBe(true);
    expect(incidentDoc.publicSafetyDispatch).toEqual({ status: 'disabled', agency: null });
    expect(JSON.stringify(incidentDoc)).not.toContain('+5521900000001');
    expect(incidentDoc.timeline.map((entry) => entry.action)).toEqual([
      'opened', 'emergency_package_stored', 'public_safety_dispatch_disabled'
    ]);
    await expect(service.getEmergencyPackage('INC-1')).resolves.toEqual(expect.objectContaining({
      incidentId: 'INC-1',
      driver: { phone: '+5521900000001' }
    }));
    const incident = await service.getIncident('INC-1');
    expect(incident.emergencyPackageAvailable).toBe(true);
  });
});
