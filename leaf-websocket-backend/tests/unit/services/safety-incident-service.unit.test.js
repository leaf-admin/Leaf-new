const { SafetyIncidentService } = require('../../../services/safety-incident-service');

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
});
