jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => null)
}));

jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: jest.fn(() => '__SERVER_TIMESTAMP__')
    }
  }
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const firebaseConfig = require('../../../firebase-config');
const FinancialLedgerService = require('../../../services/financial-ledger-service');

function createInMemoryFirestore() {
  const docs = new Map();

  const writeDoc = (ref, data, options = {}) => {
    const previous = docs.get(ref.path) || {};
    docs.set(ref.path, options.merge ? { ...previous, ...data } : { ...data });
  };

  const makeSnapshot = (rows) => ({
    empty: rows.length === 0,
    size: rows.length,
    docs: rows.map(([path, data]) => ({
      id: path.split('/').pop(),
      data: () => data
    })),
    forEach(callback) {
      this.docs.forEach(callback);
    }
  });

  const collection = (path) => {
    const queryState = {
      filters: [],
      limitValue: null
    };

    const queryApi = {
      doc: (id = `auto_${docs.size + 1}`) => doc(`${path}/${id}`),
      where: (field, operator, expected) => {
        queryState.filters.push({ field, operator, expected });
        return queryApi;
      },
      limit: (value) => {
        queryState.limitValue = value;
        return queryApi;
      },
      get: async () => {
        let rows = Array.from(docs.entries()).filter(([docPath]) => docPath.startsWith(`${path}/`));
        queryState.filters.forEach(({ field, operator, expected }) => {
          if (operator !== '==') return;
          rows = rows.filter(([, data]) => data?.[field] === expected);
        });
        if (Number.isFinite(queryState.limitValue)) {
          rows = rows.slice(0, queryState.limitValue);
        }
        return makeSnapshot(rows);
      }
    };

    return queryApi;
  };

  const doc = (path) => ({
    path,
    id: path.split('/').pop(),
    get: async () => ({
      exists: docs.has(path),
      data: () => docs.get(path)
    }),
    set: async (data, options) => writeDoc({ path }, data, options)
  });

  return {
    docs,
    collection,
    runTransaction: async (handler) => {
      const pendingWrites = [];
      const transaction = {
        get: async (ref) => ({
          exists: docs.has(ref.path),
          data: () => docs.get(ref.path)
        }),
        set: (ref, data, options) => pendingWrites.push([ref, data, options])
      };

      const result = await handler(transaction);
      pendingWrites.forEach(([ref, data, options]) => writeDoc(ref, data, options));
      return result;
    }
  };
}

describe('FinancialLedgerService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    firebaseConfig.getFirestore.mockReturnValue(createInMemoryFirestore());
  });

  it('records a balanced payment received event idempotently', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new FinancialLedgerService();

    const first = await service.recordPaymentReceived({
      rideId: 'ride_1',
      chargeId: 'charge_1',
      amountCents: 2500,
      passengerId: 'passenger_1'
    });
    const second = await service.recordPaymentReceived({
      rideId: 'ride_1',
      chargeId: 'charge_1',
      amountCents: 2500,
      passengerId: 'passenger_1'
    });

    expect(first).toMatchObject({
      success: true,
      totalDebitCents: 2500,
      totalCreditCents: 2500
    });
    expect(second).toMatchObject({
      success: true,
      idempotentReplay: true,
      eventId: first.eventId
    });
    expect(firestore.docs.get(`financial_ledger_events/${first.eventId}`)).toMatchObject({
      eventType: 'payment_received',
      balanced: true,
      rideId: 'ride_1'
    });
    expect(firestore.docs.get(`financial_ledger_lines/${first.eventId}_0`)).toMatchObject({
      account: 'asset:leaf_cash_pix',
      direction: 'debit',
      amountCents: 2500
    });
  });

  it('rejects an existing ledger event with different balanced content', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new FinancialLedgerService();
    const eventId = 'manual_event_1';

    const first = await service.recordBalancedEvent({
      eventId,
      eventType: 'manual_test',
      lines: [
        { account: 'asset:cash', direction: 'debit', amountCents: 100 },
        { account: 'liability:test', direction: 'credit', amountCents: 100 }
      ]
    });
    const conflict = await service.recordBalancedEvent({
      eventId,
      eventType: 'manual_test',
      lines: [
        { account: 'asset:cash', direction: 'debit', amountCents: 200 },
        { account: 'liability:test', direction: 'credit', amountCents: 200 }
      ]
    });

    expect(first.success).toBe(true);
    expect(conflict).toMatchObject({
      success: false,
      code: 'LEDGER_EVENT_CONFLICT'
    });
  });

  it('records a completed ride settlement with driver payable and retained fees', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new FinancialLedgerService();

    const result = await service.recordRideSettlement({
      rideId: 'ride_settle_1',
      driverId: 'driver_1',
      totalAmountCents: 3000,
      netAmountCents: 2500,
      operationalFeeCents: 300,
      wooviFeeCents: 200
    });

    const event = firestore.docs.get(`financial_ledger_events/${result.eventId}`);

    expect(result).toMatchObject({
      success: true,
      totalDebitCents: 3000,
      totalCreditCents: 3000
    });
    expect(event.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        account: 'liability:driver_balance_payable',
        direction: 'credit',
        amountCents: 2500
      }),
      expect.objectContaining({
        account: 'revenue:leaf_operational_fee',
        direction: 'credit',
        amountCents: 300
      })
    ]));
  });

  it('reconciles ride payment and distribution against ledger events', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new FinancialLedgerService();

    firestore.docs.set('ride_payments/ride_reconcile_1', {
      rideId: 'ride_reconcile_1',
      chargeId: 'charge_1',
      amount: 3000,
      status: 'CONFIRMED'
    });
    firestore.docs.set('payment_holdings/ride_reconcile_1', {
      rideId: 'ride_reconcile_1',
      amount: 3000,
      status: 'in_holding'
    });
    firestore.docs.set('payment_distributions/ride_reconcile_1', {
      rideId: 'ride_reconcile_1',
      calculation: {
        totalAmount: 3000
      }
    });

    await service.recordPaymentReceived({
      rideId: 'ride_reconcile_1',
      chargeId: 'charge_1',
      amountCents: 3000,
      passengerId: 'passenger_1'
    });
    await service.recordRideSettlement({
      rideId: 'ride_reconcile_1',
      driverId: 'driver_1',
      totalAmountCents: 3000,
      netAmountCents: 2500,
      operationalFeeCents: 300,
      wooviFeeCents: 200
    });

    const result = await service.reconcileRideFinancials({
      rideId: 'ride_reconcile_1'
    });

    expect(result.success).toBe(true);
    expect(result.report).toMatchObject({
      rideId: 'ride_reconcile_1',
      ok: true,
      issues: [],
      totals: {
        paymentAmountCents: 3000,
        distributionTotalCents: 3000,
        ledgerEventCount: 2
      }
    });
    expect(firestore.docs.get('financial_reconciliation_reports/ride_reconcile_1')).toMatchObject({
      ok: true
    });
  });

  it('reconciles a recent batch of ride payments into reports', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new FinancialLedgerService();

    firestore.docs.set('ride_payments/ride_batch_1', {
      rideId: 'ride_batch_1',
      chargeId: 'charge_batch_1',
      amount: 1800,
      status: 'CONFIRMED'
    });
    firestore.docs.set('ride_payments/ride_e2e_123_smoke', {
      rideId: 'ride_e2e_123_smoke',
      chargeId: 'charge_test_1',
      amount: 1800,
      status: 'CONFIRMED'
    });
    firestore.docs.set('payment_holdings/ride_batch_1', {
      rideId: 'ride_batch_1',
      amount: 1800,
      status: 'in_holding'
    });

    const result = await service.reconcileRecentRideFinancials({ limit: 20 });

    expect(result).toMatchObject({
      success: true,
      scannedRideCount: 1,
      reconciledRideCount: 1,
      divergentRideCount: 1,
      failedRideCount: 0,
      skippedTestRideCount: 1,
      includeTestData: false
    });
    expect(firestore.docs.get('financial_reconciliation_reports/ride_batch_1')).toMatchObject({
      rideId: 'ride_batch_1',
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: 'PAYMENT_WITHOUT_LEDGER_EVENT'
        })
      ])
    });
    expect(firestore.docs.has('financial_reconciliation_reports/ride_e2e_123_smoke')).toBe(false);
  });
});
