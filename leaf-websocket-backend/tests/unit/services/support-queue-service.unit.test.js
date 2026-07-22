const { SupportQueueService } = require('../../../services/support-queue-service');

function createFirestoreMock() {
  const store = new Map();
  return {
    store,
    collection() {
      return {
        doc(id) {
          return {
            async set(value, options = {}) {
              const current = store.get(id) || {};
              store.set(id, options.merge ? { ...current, ...value } : value);
            }
          };
        }
      };
    }
  };
}

describe('support-queue-service', () => {
  it('classifies user-created safety tickets before queueing', async () => {
    const ticketService = {
      createTicket: jest.fn(async (payload) => ({
        ticket: {
          id: 'ticket-safety-1',
          ...payload,
          status: 'open',
          createdAt: '2026-04-07T18:00:00.000Z'
        }
      }))
    };
    const service = new SupportQueueService({
      firebase: { getFirestore: () => createFirestoreMock() },
      ticketService
    });

    const result = await service.createSupportTicket({
      subject: 'Emergência na corrida',
      description: 'O motorista me ameaçou durante a viagem.',
      category: 'general',
      priority: 'N3',
      requesterId: 'passenger_1'
    });

    expect(result.ticket.priority).toBe('N1');
    expect(result.queue.slaMinutes).toEqual({ ack: 5, firstResponse: 10 });
    expect(ticketService.createTicket).toHaveBeenCalledWith(expect.objectContaining({
      priority: 'N1',
      metadata: expect.objectContaining({
        supportClassification: expect.objectContaining({
          priority: 'N1',
          requestedPriority: 'N3',
          prioritySource: 'classifier'
        }),
        queue: expect.objectContaining({
          slaMinutes: { ack: 5, firstResponse: 10 }
        })
      })
    }));
  });

  it('ignores untrusted app priority inflation for standard tickets', async () => {
    const ticketService = {
      createTicket: jest.fn(async (payload) => ({
        ticket: {
          id: 'ticket-normal-1',
          ...payload,
          status: 'open',
          createdAt: '2026-04-07T18:00:00.000Z'
        }
      }))
    };
    const service = new SupportQueueService({
      firebase: { getFirestore: () => createFirestoreMock() },
      ticketService
    });

    const result = await service.createSupportTicket({
      subject: 'Dúvida de cadastro',
      description: 'Quero ajustar meu nome no perfil.',
      category: 'account',
      priority: 'N1',
      requesterId: 'passenger_1'
    });

    expect(result.ticket.priority).toBe('N3');
    expect(ticketService.createTicket).toHaveBeenCalledWith(expect.objectContaining({
      priority: 'N3',
      metadata: expect.objectContaining({
        supportClassification: expect.objectContaining({
          requestedPriority: 'N1',
          requestedPriorityTrusted: false
        })
      })
    }));
  });

  it('propagates the sandbox persistence context through create, read and queue mutation paths', async () => {
    const persistenceContext = Object.freeze({
      namespace: 'sandbox',
      profileId: 'qa-test-users-sandbox-durable',
      financialContextId: 'ctx_sandbox_1'
    });
    const ticket = {
      id: 'ticket-sandbox-1',
      priority: 'N3',
      status: 'open',
      createdAt: '2026-07-21T18:00:00.000Z',
      metadata: {}
    };
    const ticketService = {
      createTicket: jest.fn(async () => ({ ticket })),
      listTicketsByStatuses: jest.fn(async () => ({ tickets: [ticket] })),
      listMessages: jest.fn(async () => []),
      getTicket: jest.fn(async () => ticket),
      assignTicket: jest.fn(async () => ticket),
      updateTicketMetadata: jest.fn(async () => ticket)
    };
    const service = new SupportQueueService({ ticketService });

    await service.createSupportTicket({
      subject: 'Revisão de identidade',
      description: 'Solicitação sandbox isolada.',
      requesterId: 'driver-sandbox',
      userType: 'driver',
      persistenceContext
    });
    await service.getBacklog({ persistenceContext });
    await service.assignTicket('ticket-sandbox-1', {
      agentId: 'agent-1',
      agentName: 'Agente',
      actorId: 'agent-1'
    }, persistenceContext);

    expect(ticketService.createTicket).toHaveBeenCalledWith(expect.objectContaining({
      persistenceContext
    }));
    expect(ticketService.listTicketsByStatuses).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ persistenceContext })
    );
    expect(ticketService.assignTicket).toHaveBeenCalledWith(
      'ticket-sandbox-1',
      expect.any(Object),
      persistenceContext
    );
    expect(ticketService.updateTicketMetadata).toHaveBeenCalledWith(
      'ticket-sandbox-1',
      expect.any(Object),
      persistenceContext
    );
    expect(ticketService.getTicket).toHaveBeenCalledWith('ticket-sandbox-1', persistenceContext);
  });

  it('computes backlog summary and auto-escalates SLA breach', async () => {
    const firestore = createFirestoreMock();
    const ticket = {
      id: 'ticket-1',
      priority: 'N1',
      status: 'open',
      createdAt: '2026-04-07T18:00:00.000Z',
      assignedAgent: null,
      metadata: {}
    };
    const ticketService = {
      listTickets: jest.fn(async () => ({ tickets: [ticket] })),
      listMessages: jest.fn(async () => []),
      getTicket: jest.fn(async () => ticket),
      updateTicketMetadata: jest.fn(async () => ticket),
      escalateTicket: jest.fn(async () => ({ escalationLevel: 2 })),
      createTicket: jest.fn(),
      assignTicket: jest.fn(),
      resolveTicket: jest.fn()
    };

    const RealDate = Date;
    global.Date = class extends RealDate {
      constructor(...args) {
        if (args.length === 0) {
          return new RealDate('2026-04-07T18:12:00.000Z');
        }
        return new RealDate(...args);
      }
      static now() {
        return new RealDate('2026-04-07T18:12:00.000Z').getTime();
      }
      static parse(value) {
        return RealDate.parse(value);
      }
    };

    const service = new SupportQueueService({
      firebase: { getFirestore: () => firestore },
      ticketService
    });

    const summary = await service.getQueueSummary({ autoEscalate: true });

    expect(summary.overdueAckCount).toBe(1);
    expect(summary.backlogByPriority.N1).toBe(1);
    expect(ticketService.escalateTicket).toHaveBeenCalledWith('ticket-1', expect.objectContaining({
      reason: 'SLA de ack excedido'
    }), null);

    global.Date = RealDate;
  });

  it('keeps backlog reads side-effect free unless autoEscalate is explicit', async () => {
    const ticket = {
      id: 'ticket-read-only-1',
      priority: 'N1',
      status: 'open',
      createdAt: '2026-04-07T18:00:00.000Z',
      assignedAgent: null,
      metadata: {}
    };
    const ticketService = {
      listTickets: jest.fn(async () => ({ tickets: [ticket] })),
      listMessages: jest.fn(async () => []),
      getTicket: jest.fn(async () => ticket),
      escalateTicket: jest.fn(async () => ({ escalationLevel: 2 }))
    };

    const RealDate = Date;
    try {
      global.Date = class extends RealDate {
        constructor(...args) {
          if (args.length === 0) {
            return new RealDate('2026-04-07T18:12:00.000Z');
          }
          return new RealDate(...args);
        }
        static now() {
          return new RealDate('2026-04-07T18:12:00.000Z').getTime();
        }
        static parse(value) {
          return RealDate.parse(value);
        }
      };

      const service = new SupportQueueService({
        firebase: { getFirestore: () => createFirestoreMock() },
        ticketService
      });

      const summary = await service.getQueueSummary();

      expect(summary.overdueAckCount).toBe(1);
      expect(ticketService.escalateTicket).not.toHaveBeenCalled();
    } finally {
      global.Date = RealDate;
    }
  });
});
