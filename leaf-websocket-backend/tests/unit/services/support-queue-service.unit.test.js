const { SupportQueueService } = require('../../../services/support-queue-service');

function createFirestoreMock() {
  const store = new Map();
  const buildDoc = (key) => ({
    async create(value) {
      if (store.has(key)) {
        const error = new Error('already exists');
        error.code = 6;
        throw error;
      }
      store.set(key, value);
    },
    async set(value, options = {}) {
      const current = store.get(key) || {};
      store.set(key, options.merge ? { ...current, ...value } : value);
    },
    collection(name) {
      return {
        doc(id) {
          return buildDoc(`${key}/${name}/${id}`);
        }
      };
    }
  });
  return {
    store,
    collection(name) {
      return {
        doc(id) {
          return buildDoc(`${name}/${id}`);
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
    }));

    global.Date = RealDate;
  });

  it('claims each breached auto-escalation stage at most once', async () => {
    const firestore = createFirestoreMock();
    const ticket = {
      id: 'ticket-idempotent-1',
      priority: 'N1',
      status: 'open',
      createdAt: '2026-04-07T18:00:00.000Z',
      assignedAgent: null,
      metadata: {},
      queue: {
        overdueAck: true,
        overdueFirstResponse: false,
        ageHours: 0.1,
        autoEscalationStage: null
      }
    };
    const ticketService = {
      getTicket: jest.fn(async () => ticket),
      listMessages: jest.fn(async () => []),
      escalateTicket: jest.fn(async () => ({ escalationLevel: 2 }))
    };
    const service = new SupportQueueService({
      firebase: { getFirestore: () => firestore },
      ticketService
    });

    await Promise.all([
      service.maybeAutoEscalateTicket(ticket),
      service.maybeAutoEscalateTicket(ticket)
    ]);

    expect(ticketService.escalateTicket).toHaveBeenCalledTimes(1);
    expect(ticketService.escalateTicket).toHaveBeenCalledWith(
      'ticket-idempotent-1',
      expect.objectContaining({
        reason: 'SLA de ack excedido'
      })
    );
    expect(firestore.store.get(
      'support_tickets/ticket-idempotent-1/auto_escalations/ack'
    )).toEqual(expect.objectContaining({ status: 'claimed' }));
  });

  it('advances overdue stages once each without cycling back to ack', async () => {
    const firestore = createFirestoreMock();
    const ticket = {
      id: 'ticket-idempotent-2',
      priority: 'N1',
      status: 'open',
      createdAt: '2026-04-07T06:00:00.000Z',
      assignedAgent: null,
      metadata: {},
      queue: {
        overdueAck: true,
        overdueFirstResponse: true,
        ageHours: 13,
        autoEscalationStage: null
      }
    };
    const ticketService = {
      getTicket: jest.fn(async () => ticket),
      listMessages: jest.fn(async () => []),
      escalateTicket: jest.fn(async () => ({ escalationLevel: 2 }))
    };
    const service = new SupportQueueService({
      firebase: { getFirestore: () => firestore },
      ticketService
    });

    await service.maybeAutoEscalateTicket(ticket);
    ticket.queue.autoEscalationStage = 'ack';
    await service.maybeAutoEscalateTicket(ticket);
    ticket.queue.autoEscalationStage = 'first_response';
    await service.maybeAutoEscalateTicket(ticket);
    ticket.queue.autoEscalationStage = 'critical_backlog';
    await service.maybeAutoEscalateTicket(ticket);

    expect(ticketService.escalateTicket).toHaveBeenCalledTimes(3);
    expect(ticketService.escalateTicket.mock.calls.map(([, payload]) => payload.reason)).toEqual([
      'SLA de ack excedido',
      'SLA de primeira resposta excedido',
      'Ticket entrou em backlog crítico (>12h)'
    ]);
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
