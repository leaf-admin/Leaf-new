const { SafetyIncidentService } = require('../../../services/safety-incident-service');
const { sealFinancialContext } = require('../../../services/financial-runtime-context');

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
    const bookingUpdates = [];
    const service = new SafetyIncidentService({
      firebase: {
        getFirestore: () => firestore,
        getRealtimeDB: () => ({
          ref: () => ({
            update: async (value) => bookingUpdates.push(value)
          })
        })
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
    expect(bookingUpdates[0]).toEqual(expect.objectContaining({
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
    const bookingRef = jest.fn(() => ({ update: jest.fn(async () => true) }));
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
        getFirestore: () => ({ collection }),
        getRealtimeDB: () => ({ ref: bookingRef })
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
    expect(bookingRef).toHaveBeenCalledWith('sandbox_bookings/sandbox-booking-1');
    expect(bookingRef).not.toHaveBeenCalledWith('bookings/sandbox-booking-1');
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
