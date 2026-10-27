const store = new Map();
const collectionCalls = [];

function createFirestore() {
  function write(path, value, options = {}) {
    const current = store.get(path) || {};
    store.set(path, options.merge ? { ...current, ...value } : value);
  }

  function docRef(path) {
    return {
      _path: path,
      id: path.split('/').pop(),
      async get() {
        const value = store.get(path);
        return {
          id: path.split('/').pop(),
          exists: value !== undefined,
          data: () => value
        };
      },
      async set(value, options) {
        write(path, value, options);
      },
      collection(name) {
        return collectionRef(`${path}/${name}`);
      }
    };
  }

  function querySnapshot(path, filters = []) {
    const prefix = `${path}/`;
    const docs = Array.from(store.entries())
      .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
      .filter(([, value]) => filters.every(({ field, operator, expected }) => {
        if (operator === '==') return value?.[field] === expected;
        if (operator === 'in') return expected.includes(value?.[field]);
        return false;
      }))
      .map(([key, value]) => ({
        id: key.slice(prefix.length),
        data: () => value,
        ref: docRef(key)
      }));
    return { docs, empty: docs.length === 0, size: docs.length };
  }

  function collectionRef(path, filters = []) {
    collectionCalls.push(path);
    return {
      doc(id) {
        return docRef(`${path}/${id}`);
      },
      where(field, operator, expected) {
        return collectionRef(path, [...filters, { field, operator, expected }]);
      },
      async get() {
        return querySnapshot(path, filters);
      }
    };
  }

  return {
    collection: (name) => collectionRef(name),
    batch() {
      const operations = [];
      return {
        set(ref, value, options) {
          operations.push(() => write(ref._path, value, options));
        },
        async commit() {
          operations.forEach((operation) => operation());
        }
      };
    }
  };
}

const firestore = createFirestore();
const mockEmit = jest.fn().mockResolvedValue({ queued: 1 });

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => firestore),
  getRealtimeDB: jest.fn(() => null)
}));

jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: jest.fn(() => 'server-timestamp')
    }
  }
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

jest.mock('../../../services/bot-event-service', () => ({
  emit: (...args) => mockEmit(...args)
}));

const { sealFinancialContext } = require('../../../services/financial-runtime-context');
const supportTicketService = require('../../../services/support-ticket-service');

describe('support tickets wake the support bot', () => {
  beforeEach(() => {
    store.clear();
    mockEmit.mockClear();
    supportTicketService.firestore = null;
  });

  it('emits ticket_created with the classification and the money flag, never the text or the user', async () => {
    const { ticket } = await supportTicketService.createTicket({
      subject: 'Cobrança em dobro',
      description: 'Fui cobrado duas vezes, meu telefone é 21 99999-0000',
      category: 'payment',
      priority: 'N2',
      requesterId: 'passenger-1',
      metadata: {
        source: 'app',
        supportClassification: { priority: 'N2', resolutionClass: 'D', reasons: ['payment_category_minimum'], resolutionReasons: ['payment_category_is_money'] }
      }
    });

    expect(mockEmit).toHaveBeenCalledTimes(1);
    const [type, data, options] = mockEmit.mock.calls[0];
    expect(type).toBe('support.ticket_created');
    expect(data).toEqual({
      ticketId: ticket.id,
      category: 'payment',
      priority: 'N2',
      resolutionClass: 'D',
      userType: 'passenger',
      source: 'app',
      senderType: null
    });
    expect(options).toEqual({ dedupeKey: ticket.id, severity: 'N2', money: true });
    expect(JSON.stringify(mockEmit.mock.calls)).not.toMatch(/passenger-1|99999|duas vezes/);
  });

  it('emits message_created only for the user, coalesced per ticket', async () => {
    const { ticket } = await supportTicketService.createTicket({
      subject: 'Dúvida', description: 'Como vejo meu recibo?', requesterId: 'passenger-1'
    });
    mockEmit.mockClear();

    await supportTicketService.addMessage(ticket.id, { senderId: 'agent-1', senderType: 'agent', message: 'Oi!' });
    await supportTicketService.addMessage(ticket.id, { senderId: 'agent-1', senderType: 'agent', message: 'nota', isInternal: true });
    expect(mockEmit).not.toHaveBeenCalled();

    await supportTicketService.addMessage(ticket.id, { senderId: 'passenger-1', senderType: 'user', message: 'Obrigado' });
    expect(mockEmit).toHaveBeenCalledTimes(1);
    const [type, data, options] = mockEmit.mock.calls[0];
    expect(type).toBe('support.message_created');
    expect(data).toMatchObject({ ticketId: ticket.id, senderType: 'user' });
    expect(options.dedupeKey).toMatch(new RegExp(`^${ticket.id}:\\d+$`));
    expect(options.money).toBe(false);
  });

  it('stays silent for sandbox tickets', async () => {
    const sandboxContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable',
      paymentProfileSource: 'firestore',
      testUserSandbox: true
    });
    const { ticket } = await supportTicketService.createTicket({
      subject: 'QA', description: 'teste', requesterId: 'qa-passenger', persistenceContext: sandboxContext
    });
    await supportTicketService.addMessage(ticket.id, { senderId: 'qa-passenger', senderType: 'user', message: 'oi' }, sandboxContext);

    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('never breaks ticket creation when the bot service fails', async () => {
    mockEmit.mockRejectedValueOnce(new Error('relay down'));
    await expect(supportTicketService.createTicket({
      subject: 'Erro', description: 'app travou', requesterId: 'passenger-2'
    })).resolves.toMatchObject({ ticket: expect.objectContaining({ status: 'open' }) });
  });
});
