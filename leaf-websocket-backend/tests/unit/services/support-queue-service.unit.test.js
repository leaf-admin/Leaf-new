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
});
