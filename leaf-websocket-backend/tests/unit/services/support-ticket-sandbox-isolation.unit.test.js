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

const { sealFinancialContext } = require('../../../services/financial-runtime-context');
const {
  createExplicitSandboxAccessScope
} = require('../../../services/sandbox-persistence-context');
const supportTicketService = require('../../../services/support-ticket-service');

describe('support ticket sandbox persistence isolation', () => {
  let sandboxContext;

  beforeEach(() => {
    store.clear();
    collectionCalls.length = 0;
    supportTicketService.firestore = null;
    supportTicketService.legacyRepository = null;
    sandboxContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable',
      paymentProfileSource: 'firestore',
      testUserSandbox: true
    });
  });

  it('keeps all QA ticket reads and writes inside sandbox_support_tickets', async () => {
    const { ticket } = await supportTicketService.createTicket({
      subject: 'Teste de suporte',
      description: 'Validar isolamento sandbox.',
      requesterId: 'qa-passenger',
      userType: 'passenger',
      persistenceContext: sandboxContext
    });
    await supportTicketService.addMessage(ticket.id, {
      senderId: 'qa-passenger',
      senderType: 'user',
      message: 'Complemento do teste.'
    }, sandboxContext);
    const listed = await supportTicketService.listTickets({
      userId: 'qa-passenger',
      isAgent: false,
      persistenceContext: sandboxContext
    });

    expect(listed.tickets).toHaveLength(1);
    expect(listed.tickets[0]).toMatchObject({
      id: ticket.id,
      financialNamespace: 'sandbox',
      financialContextId: sandboxContext.contextId
    });
    expect(collectionCalls).toContain('sandbox_support_tickets');
    expect(collectionCalls).not.toContain('support_tickets');
    expect(Array.from(store.keys()).every((key) => key.startsWith('sandbox_support_tickets/'))).toBe(true);
  });

  it('lets an authorized dashboard read sandbox explicitly without operational fallback', async () => {
    const { ticket } = await supportTicketService.createTicket({
      subject: 'Ticket sandbox',
      description: 'Somente dashboard autorizado.',
      requesterId: 'qa-passenger',
      persistenceContext: sandboxContext
    });
    collectionCalls.length = 0;
    const dashboardScope = createExplicitSandboxAccessScope({ authorized: true });

    const loaded = await supportTicketService.getTicket(ticket.id, dashboardScope);

    expect(loaded.id).toBe(ticket.id);
    expect(collectionCalls).toContain('sandbox_support_tickets');
    expect(collectionCalls).not.toContain('support_tickets');
  });

  it('atualiza metadados do vinculo KYC sem trocar o namespace persistente', async () => {
    const { ticket } = await supportTicketService.createTicket({
      subject: 'Revisao KYC',
      description: 'Vinculo pendente.',
      requesterId: 'qa-driver',
      userType: 'driver',
      metadata: { identityReviewLinkStatus: 'pending' },
      persistenceContext: sandboxContext
    });
    collectionCalls.length = 0;

    const updated = await supportTicketService.updateTicketMetadata(ticket.id, {
      identityReviewLinkStatus: 'registered',
      identityReviewCaseId: 'case_1'
    }, sandboxContext);

    expect(updated.metadata).toMatchObject({
      identityReviewLinkStatus: 'registered',
      identityReviewCaseId: 'case_1'
    });
    expect(collectionCalls).toContain('sandbox_support_tickets');
    expect(collectionCalls).not.toContain('support_tickets');
  });

  it('honra o filtro userId tambem para agente ao buscar reconciliacao pendente', async () => {
    await supportTicketService.createTicket({
      subject: 'Revisao KYC A',
      description: 'Pendente do motorista A.',
      requesterId: 'qa-driver-a',
      userType: 'driver',
      persistenceContext: sandboxContext
    });
    await supportTicketService.createTicket({
      subject: 'Revisao KYC B',
      description: 'Pendente do motorista B.',
      requesterId: 'qa-driver-b',
      userType: 'driver',
      persistenceContext: sandboxContext
    });

    const result = await supportTicketService.listTickets({
      userId: 'qa-driver-a',
      isAgent: true,
      limit: 100,
      persistenceContext: sandboxContext
    });

    expect(result.tickets).toHaveLength(1);
    expect(result.tickets[0].userId).toBe('qa-driver-a');
  });

  it('does not discover a sandbox ticket through the operational namespace', async () => {
    const { ticket } = await supportTicketService.createTicket({
      subject: 'Ticket sandbox',
      description: 'Sem fallback operacional.',
      requesterId: 'qa-passenger',
      persistenceContext: sandboxContext
    });
    collectionCalls.length = 0;

    const loaded = await supportTicketService.getTicket(ticket.id);

    expect(loaded).toBeNull();
    expect(collectionCalls).toContain('support_tickets');
    expect(collectionCalls).not.toContain('sandbox_support_tickets');
  });

  it('fails before Firestore when a sandbox signal has no sealed context', async () => {
    await expect(supportTicketService.createTicket({
      subject: 'Contexto inválido',
      description: 'Não deve persistir.',
      requesterId: 'qa-passenger',
      persistenceContext: {
        financialNamespace: 'sandbox',
        providerEnvironment: 'sandbox'
      }
    })).rejects.toMatchObject({ code: 'FINANCIAL_SANDBOX_CONTEXT_LOST' });

    expect(collectionCalls).toEqual([]);
    expect(store.size).toBe(0);
  });
});
