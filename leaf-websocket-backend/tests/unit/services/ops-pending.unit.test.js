'use strict';

jest.mock('../../../utils/logger', () => ({ logStructured: jest.fn(), logError: jest.fn() }));

const {
  classifyDriverApplication,
  buildReviewQueueFields
} = require('../../../services/driver-review-queue');
const opsPending = require('../../../services/ops-pending-service');

describe('classifyDriverApplication', () => {
  it('aprovado e recusado', () => {
    expect(classifyDriverApplication({ driver: { approved: true } }).bucket).toBe('approved');
    expect(classifyDriverApplication({ status: 'rejected' }).bucket).toBe('rejected');
  });

  it('motivos da fila de revisão', () => {
    expect(classifyDriverApplication({ autoApproval: { status: 'needs_review' } }))
      .toEqual({ bucket: 'review', reason: 'manual_review' });
    expect(classifyDriverApplication({ activation: { canGoOnline: true } }))
      .toEqual({ bucket: 'review', reason: 'ready_to_approve' });
    expect(classifyDriverApplication({ activation: { checklist: { awaitingBackgroundCertificate: true } } }))
      .toEqual({ bucket: 'review', reason: 'background_certificate' });
    expect(classifyDriverApplication({ documents: { all_documents: [{ type: 'cnh', status: 'pending' }] } }))
      .toEqual({ bucket: 'review', reason: 'documents' });
  });

  it('documento reprovado volta para o motorista (em cadastro)', () => {
    expect(classifyDriverApplication({ documents: { all_documents: [{ type: 'cnh', status: 'rejected' }] } }).bucket)
      .toBe('onboarding');
  });
});

describe('buildReviewQueueFields', () => {
  const review = { activation: { canGoOnline: true } };

  it('marca a entrada na fila e mantém a data enquanto continua nela', () => {
    const first = buildReviewQueueFields(review, {}, '2026-11-13T10:00:00.000Z');
    expect(first).toMatchObject({ reviewBucket: 'review', reviewWaitingSince: '2026-11-13T10:00:00.000Z', changed: true });
    const again = buildReviewQueueFields(review, first, '2026-11-13T12:00:00.000Z');
    expect(again).toMatchObject({ reviewWaitingSince: '2026-11-13T10:00:00.000Z', changed: false });
  });

  it('zera a espera ao sair da fila', () => {
    const fields = buildReviewQueueFields({ driver: { approved: true } }, { reviewBucket: 'review', reviewWaitingSince: 'x' });
    expect(fields).toMatchObject({ reviewBucket: 'approved', reviewWaitingSince: null, changed: true });
  });
});

function fakeFirestore({ reviewDocs = [], cpf = 2, support = 3, withdrawals = 1 } = {}) {
  const calls = { select: null, limit: null };
  const countResult = (count) => ({ count: () => ({ get: async () => ({ data: () => ({ count }) }) }) });
  return {
    calls,
    collection(name) {
      if (name === 'driver_applications') {
        return {
          where: () => ({
            select: (...fields) => {
              calls.select = fields;
              return {
                limit: (limit) => {
                  calls.limit = limit;
                  return { get: async () => ({ size: reviewDocs.length, docs: reviewDocs.map((data) => ({ data: () => data })) }) };
                }
              };
            }
          })
        };
      }
      if (name === 'cpf_review_restrictions') return countResult(cpf);
      if (name === 'support_tickets') return { where: () => countResult(support) };
      if (name === 'driver_withdrawals') {
        return { where: (field, op, value) => { calls.withdrawalStatuses = value; return countResult(withdrawals); } };
      }
      throw new Error(`unexpected ${name}`);
    }
  };
}

describe('computePendingSummary', () => {
  it('conta só o escopo operacional, por motivo, com o mais antigo', async () => {
    const firestore = fakeFirestore({
      reviewDocs: [
        { reviewReason: 'documents', reviewWaitingSince: '2026-11-13T08:00:00.000Z' },
        { reviewReason: 'background_certificate', reviewWaitingSince: '2026-11-13T06:00:00.000Z' },
        { reviewReason: 'documents', reviewWaitingSince: '2026-11-12T00:00:00.000Z', persistenceScope: { namespace: 'sandbox' } }
      ]
    });
    const summary = await opsPending.computePendingSummary(firestore, new Date('2026-11-13T12:00:00.000Z'));
    expect(summary.drivers).toMatchObject({
      review: 2,
      oldestWaitingSince: '2026-11-13T06:00:00.000Z',
      oldestWaitingMs: 6 * 60 * 60 * 1000
    });
    expect(summary.drivers.byReason).toMatchObject({ documents: 1, background_certificate: 1 });
    expect(summary).toMatchObject({ cpfReviews: 2, supportOpen: 3, withdrawalsPending: 1, total: 8, backgroundCertificates: 1 });
    expect(firestore.calls.withdrawalStatuses).toEqual(['pending', 'ledger_pending', 'processing']);
    // Lê só a fila de revisão, poucos campos e com limite.
    expect(firestore.calls.select).toEqual(['reviewReason', 'reviewWaitingSince', 'persistenceScope', 'driver']);
    expect(firestore.calls.limit).toBe(300);
  });
});

describe('getPendingSummary cache', () => {
  it('usa o cache do Redis e só recalcula quando não há', async () => {
    const store = new Map();
    const redis = {
      get: jest.fn(async (key) => store.get(key) || null),
      set: jest.fn(async (key, value) => { store.set(key, value); }),
      del: jest.fn(async (key) => { store.delete(key); })
    };
    opsPending.configureOpsPending({ redis });
    const firestore = fakeFirestore();
    const spy = jest.spyOn(firestore, 'collection');

    const first = await opsPending.getPendingSummary({ firestore });
    const reads = spy.mock.calls.length;
    const second = await opsPending.getPendingSummary({ firestore });

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(spy.mock.calls.length).toBe(reads);
    expect(redis.set).toHaveBeenCalledWith(opsPending.CACHE_KEY, expect.any(String), 'EX', 60);
  });
});

describe('notifyPendingChanged', () => {
  it('agrupa avisos em rajada, invalida o cache e avisa a sala leve', async () => {
    jest.useFakeTimers();
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    const redis = { del: jest.fn(async () => 1) };
    opsPending.configureOpsPending({ io: { of: () => ({ to }) }, redis });

    opsPending.notifyPendingChanged('support');
    opsPending.notifyPendingChanged('driver_application');
    jest.advanceTimersByTime(1600);
    jest.useRealTimers();
    await new Promise((resolve) => setImmediate(resolve));

    expect(redis.del).toHaveBeenCalledTimes(1);
    expect(to).toHaveBeenCalledWith('dashboard:ops');
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][1].reasons.sort()).toEqual(['driver_application', 'support']);
  });
});

describe('maybeRunOpsDailyDigest', () => {
  const { maybeRunOpsDailyDigest, resetOpsDailyDigestState } = require('../../../services/ops-daily-digest');
  const summary = {
    drivers: { review: 4, byReason: { ready_to_approve: 1, background_certificate: 2, documents: 1 }, waitingOver24h: 1, oldestWaitingMs: 30 * 3600000 },
    cpfReviews: 0,
    supportOpen: 2
  };
  const makeRedis = () => {
    const keys = new Map();
    return {
      set: jest.fn(async (key, value, _ex, _ttl, nx) => {
        if (nx === 'NX' && keys.has(key)) return null;
        keys.set(key, value);
        return 'OK';
      }),
      del: jest.fn(async (key) => keys.delete(key))
    };
  };

  beforeEach(() => resetOpsDailyDigestState());

  it('antes das 9h de Brasília não envia', async () => {
    const emitEvent = jest.fn();
    const result = await maybeRunOpsDailyDigest(makeRedis(), {
      env: {}, now: new Date('2026-11-13T11:00:00Z'), loadSummary: async () => summary, emitEvent
    });
    expect(result).toBeNull();
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it('envia uma vez por dia com só contagens', async () => {
    const redis = makeRedis();
    const emitEvent = jest.fn(async () => true);
    const now = new Date('2026-11-13T12:05:00Z');
    const data = await maybeRunOpsDailyDigest(redis, { env: {}, now, loadSummary: async () => summary, emitEvent });
    expect(emitEvent).toHaveBeenCalledWith('ops.daily_digest', expect.objectContaining({
      reviewCount: 4, readyToApprove: 1, backgroundCertificates: 2, waitingOver24h: 1, oldestWaitingHours: 30, supportOpen: 2
    }), expect.objectContaining({ dedupeKey: '2026-11-13', severity: 'N2' }));
    expect(data.dashboardUrl).toMatch(/\/drivers\?tab=review$/);

    resetOpsDailyDigestState();
    await maybeRunOpsDailyDigest(redis, { env: {}, now, loadSummary: async () => summary, emitEvent });
    expect(emitEvent).toHaveBeenCalledTimes(1);
  });

  it('falha libera a trava para tentar de novo', async () => {
    const redis = makeRedis();
    const now = new Date('2026-11-13T12:05:00Z');
    await maybeRunOpsDailyDigest(redis, { env: {}, now, loadSummary: async () => { throw new Error('x'); }, emitEvent: jest.fn() });
    expect(redis.del).toHaveBeenCalledWith('ops:daily_digest:2026-11-13');
  });
});

describe('toPendingWithdrawalAdminView', () => {
  const { toPendingWithdrawalAdminView } = require('../../../services/driver-withdrawal-view');
  it('mascara a chave Pix, converte datas e corta o erro', () => {
    const view = toPendingWithdrawalAdminView('w1', {
      driverId: 'd1',
      amountCents: 100,
      feeCents: 100,
      totalDebitCents: 200,
      status: 'pending',
      ledgerStatus: 'posted',
      pixKey: 'motorista@email.com',
      attempts: 2,
      lastError: 'x'.repeat(500),
      createdAt: { toDate: () => new Date('2026-11-13T12:00:00Z') }
    });
    expect(view).toMatchObject({
      id: 'w1', driverId: 'd1', amountCents: 100, totalDebitCents: 200, attempts: 2,
      createdAt: '2026-11-13T12:00:00.000Z'
    });
    expect(view.pixKeyMasked).not.toContain('motorista@');
    expect(view.pixKeyMasked).toMatch(/@email\.com$/);
    expect(view.lastError).toHaveLength(200);
    expect(view).not.toHaveProperty('pixKey');
  });
});
