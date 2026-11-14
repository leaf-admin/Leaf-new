'use strict';

// Saque com Pix Out: processar, falha, incerteza e conferência de travado.

const mockDocs = new Map();
const mockWoovi = { payments: new Map(), created: 0, getFails: null, createFails: null };
const mockPush = { processed: jest.fn(async () => ({ success: true })), delayed: jest.fn(async () => ({ success: true })) };
const mockLedger = {
  recordWithdrawalProcessed: jest.fn(async () => ({ success: true, eventId: 'evt1' })),
  reconcileWithdrawalFinancials: jest.fn(async () => ({ success: true }))
};

function mockHttpError(status, error) {
  return Object.assign(new Error(error), { response: { status, data: { error } } });
}

jest.mock('../../../services/woovi-driver-service', () => jest.fn().mockImplementation(() => ({
  api: {
    get: jest.fn(async (path) => {
      if (mockWoovi.getFails) throw mockWoovi.getFails;
      const id = decodeURIComponent(path.replace('/payment/', ''));
      if (!mockWoovi.payments.has(id)) throw mockHttpError(404, 'not found');
      return { data: { payment: mockWoovi.payments.get(id), transaction: { endToEndId: `E2E-${id}` } } };
    }),
    post: jest.fn(async (path, body) => {
      if (path === '/payment') {
        if (mockWoovi.createFails) throw mockWoovi.createFails;
        mockWoovi.created += 1;
        const payment = { ...body, status: 'APPROVED' };
        mockWoovi.payments.set(body.correlationID, payment);
        return { data: { payment, transaction: { endToEndId: `E2E-${body.correlationID}` } } };
      }
      const payment = mockWoovi.payments.get(body.correlationID);
      payment.status = 'APPROVED';
      return { data: { payment } };
    })
  }
})));

jest.mock('../../../services/financial-ledger-service', () => jest.fn().mockImplementation(() => mockLedger));
jest.mock('../../../services/transactional-push', () => ({
  notifyWithdrawalProcessed: (...args) => mockPush.processed(...args),
  notifyWithdrawalDelayed: (...args) => mockPush.delayed(...args)
}));
jest.mock('../../../services/ops-pending-service', () => ({ notifyPendingChanged: jest.fn() }));
jest.mock('../../../services/bot-event-service', () => ({ emit: jest.fn(async () => ({})) }));
jest.mock('../../../utils/logger', () => ({ logStructured: jest.fn(), logError: jest.fn(), logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('firebase-admin', () => ({
  firestore: { FieldValue: { serverTimestamp: () => '__TS__', increment: (n) => ({ __inc: n }) } }
}));

function applyPatch(current, patch) {
  const next = { ...current };
  Object.entries(patch).forEach(([key, value]) => {
    if (value && typeof value === 'object' && '__inc' in value) next[key] = Number(next[key] || 0) + value.__inc;
    else next[key] = value;
  });
  return next;
}

function docRef(id) {
  return {
    id,
    get: async () => ({ exists: mockDocs.has(id), id, data: () => mockDocs.get(id) }),
    set: async (patch) => { mockDocs.set(id, applyPatch(mockDocs.get(id) || {}, patch)); }
  };
}

const mockFirestore = {
  collection: () => ({
    doc: (id) => docRef(id),
    where: (field, op, value) => ({
      limit: () => ({
        get: async () => ({
          docs: Array.from(mockDocs.entries())
            .filter(([, data]) => data[field] === value)
            .map(([id, data]) => ({ id, data: () => data, ref: docRef(id) }))
        })
      })
    })
  }),
  runTransaction: async (fn) => fn({
    get: async (ref) => ref.get(),
    set: (ref, patch) => { mockDocs.set(ref.id, applyPatch(mockDocs.get(ref.id) || {}, patch)); }
  })
};

jest.mock('../../../firebase-config', () => ({ getFirestore: () => mockFirestore }));

const PaymentService = require('../../../services/payment-service');

function seed(id, extra = {}) {
  mockDocs.set(id, {
    driverId: 'd1', amountCents: 100, feeCents: 100, pixKey: 'motorista@email.com',
    status: 'pending', ledgerStatus: 'posted', ...extra
  });
}

beforeEach(() => {
  mockDocs.clear();
  mockWoovi.payments.clear();
  mockWoovi.created = 0;
  mockWoovi.getFails = null;
  mockWoovi.createFails = null;
  jest.clearAllMocks();
});

describe('processDriverWithdrawal com Pix Out', () => {
  it('envia o Pix com o id do saque, conclui e registra no ledger', async () => {
    seed('w1');
    const result = await new PaymentService().processDriverWithdrawal('w1', 'admin1');
    expect(result).toMatchObject({ success: true, transferId: 'E2E-leaf_withdrawal_w1' });
    expect(mockDocs.get('w1')).toMatchObject({ status: 'processed', processedBy: 'admin1', pixOutStatus: 'APPROVED' });
    expect(mockLedger.recordWithdrawalProcessed).toHaveBeenCalledWith(expect.objectContaining({ withdrawalId: 'w1', amountCents: 100 }));
    expect(mockPush.processed).toHaveBeenCalledTimes(1);
  });

  it('Woovi recusa (4xx): volta para a fila e avisa o motorista uma vez', async () => {
    seed('w1');
    mockWoovi.createFails = mockHttpError(400, 'saldo insuficiente');
    const service = new PaymentService();
    await service.processDriverWithdrawal('w1', 'admin1');
    expect(mockDocs.get('w1')).toMatchObject({ status: 'pending', attempts: 1, lastError: 'saldo insuficiente' });
    await service.processDriverWithdrawal('w1', 'admin1');
    expect(mockDocs.get('w1').attempts).toBe(2);
    expect(mockPush.delayed).toHaveBeenCalledTimes(1);
  });

  it('erro incerto (5xx): fica travado em processing e não aceita novo Processar', async () => {
    seed('w1');
    mockWoovi.createFails = mockHttpError(502, 'bad gateway');
    const service = new PaymentService();
    const first = await service.processDriverWithdrawal('w1', 'admin1');
    expect(first.code).toBe('WITHDRAWAL_PIX_OUT_UNCERTAIN');
    expect(mockDocs.get('w1')).toMatchObject({ status: 'processing', pixOutUncertain: true });
    const second = await service.processDriverWithdrawal('w1', 'admin1');
    expect(second.code).toBe('WITHDRAWAL_ALREADY_PROCESSING');
    expect(mockWoovi.created).toBe(0);
  });
});

describe('reconcileProcessingWithdrawal', () => {
  it('Pix saiu na Woovi: conclui sem enviar outro', async () => {
    seed('w1', { status: 'processing' });
    mockWoovi.payments.set('leaf_withdrawal_w1', { value: 100, status: 'CONFIRMED' });
    const result = await new PaymentService().reconcileProcessingWithdrawal('w1');
    expect(result.resolution).toBe('sent');
    expect(mockDocs.get('w1').status).toBe('processed');
    expect(mockWoovi.created).toBe(0);
  });

  it('nada na Woovi: volta para a fila', async () => {
    seed('w1', { status: 'processing' });
    const result = await new PaymentService().reconcileProcessingWithdrawal('w1');
    expect(result).toMatchObject({ resolution: 'not_found', status: 'pending' });
    expect(mockDocs.get('w1').status).toBe('pending');
  });

  it('Woovi fora do ar: continua travado', async () => {
    seed('w1', { status: 'processing' });
    mockWoovi.getFails = mockHttpError(503, 'indisponível');
    const result = await new PaymentService().reconcileProcessingWithdrawal('w1');
    expect(result.resolution).toBe('unknown');
    expect(mockDocs.get('w1')).toMatchObject({ status: 'processing', pixOutUncertain: true });
  });

  it('varredura só pega saque parado há mais de 10 min', async () => {
    const now = Date.parse('2026-11-13T20:00:00Z');
    seed('velho', { status: 'processing', processingStartedAt: '2026-11-13T19:40:00Z' });
    seed('novo', { status: 'processing', processingStartedAt: '2026-11-13T19:58:00Z' });
    const summary = await new PaymentService().reconcileStuckWithdrawals({ nowMs: now });
    expect(summary).toMatchObject({ checked: 1, resolved: 1 });
    expect(mockDocs.get('velho').status).toBe('pending');
    expect(mockDocs.get('novo').status).toBe('processing');
  });
});
