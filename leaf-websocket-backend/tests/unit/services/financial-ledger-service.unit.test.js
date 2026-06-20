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

  it('records a balanced settlement without zero-value ledger lines', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new FinancialLedgerService();

    const result = await service.recordRideSettlement({
      rideId: 'ride_tiny_1',
      driverId: 'driver_1',
      totalAmountCents: 80,
      netAmountCents: 0,
      operationalFeeCents: 79,
      wooviFeeCents: 1
    });

    const event = firestore.docs.get(`financial_ledger_events/${result.eventId}`);

    expect(result).toMatchObject({
      success: true,
      totalDebitCents: 80,
      totalCreditCents: 80
    });
    expect(event.lines).toHaveLength(3);
    expect(event.lines).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ amountCents: 0 })
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

  it('reconciles a canonical booking against the temporary payment ledger event', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new FinancialLedgerService();

    firestore.docs.set('ride_payments/booking_alias_1', {
      rideId: 'booking_alias_1',
      canonicalRideId: 'booking_alias_1',
      paymentReferenceRideId: 'temp_ride_alias_1',
      temporaryRideId: 'temp_ride_alias_1',
      chargeId: 'charge_alias_1',
      amount: 9792,
      status: 'CONFIRMED'
    });
    firestore.docs.set('payment_holdings/booking_alias_1', {
      rideId: 'booking_alias_1',
      materializedFrom: 'temp_ride_alias_1',
      chargeId: 'charge_alias_1',
      amount: 9792,
      status: 'distributed'
    });
    firestore.docs.set('payment_distributions/booking_alias_1', {
      rideId: 'booking_alias_1',
      calculation: {
        totalAmount: 9792
      }
    });

    await service.recordPaymentReceived({
      rideId: 'temp_ride_alias_1',
      chargeId: 'charge_alias_1',
      amountCents: 9792,
      passengerId: 'passenger_1'
    });
    await service.recordRideSettlement({
      rideId: 'booking_alias_1',
      driverId: 'driver_1',
      totalAmountCents: 9792,
      netAmountCents: 9420,
      operationalFeeCents: 294,
      wooviFeeCents: 78
    });

    const result = await service.reconcileRideFinancials({
      rideId: 'booking_alias_1'
    });

    expect(result).toMatchObject({
      success: true,
      report: {
        rideId: 'booking_alias_1',
        ok: true,
        issues: [],
        totals: {
          paymentAmountCents: 9792,
          distributionTotalCents: 9792,
          ledgerEventCount: 2
        },
        references: {
          ledgerRideIds: ['booking_alias_1', 'temp_ride_alias_1'],
          paymentLedgerRideId: 'temp_ride_alias_1'
        }
      }
    });
  });

  it('flags a temporary payment ledger event with a divergent amount', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new FinancialLedgerService();

    firestore.docs.set('ride_payments/booking_alias_mismatch', {
      rideId: 'booking_alias_mismatch',
      paymentReferenceRideId: 'temp_ride_alias_mismatch',
      chargeId: 'charge_alias_mismatch',
      amount: 9792,
      status: 'CONFIRMED'
    });
    await service.recordPaymentReceived({
      rideId: 'temp_ride_alias_mismatch',
      chargeId: 'charge_alias_mismatch',
      amountCents: 9500,
      passengerId: 'passenger_1'
    });

    const result = await service.reconcileRideFinancials({
      rideId: 'booking_alias_mismatch'
    });

    expect(result.report).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: 'PAYMENT_LEDGER_AMOUNT_MISMATCH',
          ledgerAmountCents: 9500,
          paymentAmountCents: 9792
        })
      ])
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
    firestore.docs.set('ride_payments/ride_normal_1777175584964', {
      rideId: 'ride_normal_1777175584964',
      chargeId: 'charge_smoke_normal_1',
      amount: 2750,
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
      skippedTestRideCount: 2,
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
    expect(firestore.docs.has('financial_reconciliation_reports/ride_normal_1777175584964')).toBe(false);
  });

  it('reconciles a posted withdrawal without issues', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new FinancialLedgerService();

    firestore.docs.set('driver_withdrawals/withdrawal_ok', {
      driverId: 'driver_1',
      amountCents: 2500,
      feeCents: 100,
      totalDebitCents: 2600,
      status: 'pending',
      ledgerStatus: 'posted'
    });
    await service.recordWithdrawalRequested({
      withdrawalId: 'withdrawal_ok',
      driverId: 'driver_1',
      amountCents: 2500,
      withdrawFeeCents: 100,
      requestId: 'request_ok'
    });

    const result = await service.reconcileWithdrawalFinancials({
      withdrawalId: 'withdrawal_ok'
    });

    expect(result.success).toBe(true);
    expect(result.report).toMatchObject({
      withdrawalId: 'withdrawal_ok',
      ok: true,
      issues: [],
      totals: {
        amountCents: 2500,
        totalDebitCents: 2600,
        ledgerEventCount: 1,
        hasRequestedLedger: true,
        hasProcessedLedger: false
      }
    });
    expect(firestore.docs.get('financial_withdrawal_reconciliation_reports/withdrawal_ok')).toMatchObject({
      ok: true
    });
  });

  it('records a withdrawal requested with fee when amount is below R$ 500', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new FinancialLedgerService();

    const result = await service.recordWithdrawalRequested({
      withdrawalId: 'withdrawal_fee_1',
      driverId: 'driver_1',
      amountCents: 2500,
      withdrawFeeCents: 100,
      requestId: 'req_fee_1'
    });

    const event = firestore.docs.get(`financial_ledger_events/${result.eventId}`);

    expect(result).toMatchObject({
      success: true,
      totalDebitCents: 2600,
      totalCreditCents: 2600
    });
    expect(event.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        account: 'liability:driver_balance_payable',
        direction: 'debit',
        amountCents: 2600
      }),
      expect.objectContaining({
        account: 'liability:driver_withdrawal_pending',
        direction: 'credit',
        amountCents: 2500
      }),
      expect.objectContaining({
        account: 'revenue:withdrawal_fee',
        direction: 'credit',
        amountCents: 100
      })
    ]));
  });

  it('records a withdrawal requested without fee when amount is above R$ 500', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new FinancialLedgerService();

    const result = await service.recordWithdrawalRequested({
      withdrawalId: 'withdrawal_no_fee_1',
      driverId: 'driver_1',
      amountCents: 50000,
      withdrawFeeCents: 0,
      requestId: 'req_no_fee_1'
    });

    const event = firestore.docs.get(`financial_ledger_events/${result.eventId}`);

    expect(result).toMatchObject({
      success: true,
      totalDebitCents: 50000,
      totalCreditCents: 50000
    });
    expect(event.lines).toHaveLength(2);
    expect(event.lines).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ account: 'revenue:withdrawal_fee' })
    ]));
  });

  it('protects idempotent replay of ride settlement by rideId/driverId', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new FinancialLedgerService();

    const first = await service.recordRideSettlement({
      rideId: 'ride_idem_1',
      driverId: 'driver_1',
      totalAmountCents: 3000,
      netAmountCents: 2500,
      operationalFeeCents: 300,
      wooviFeeCents: 200
    });

    const second = await service.recordRideSettlement({
      rideId: 'ride_idem_1',
      driverId: 'driver_1',
      totalAmountCents: 3000,
      netAmountCents: 2500,
      operationalFeeCents: 300,
      wooviFeeCents: 200
    });

    expect(first.success).toBe(true);
    expect(second).toMatchObject({
      success: true,
      idempotentReplay: true,
      eventId: first.eventId
    });
  });

  it('records a balanced cancellation settlement', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new FinancialLedgerService();

    const result = await service.recordCancellationSettlement({
      rideId: 'ride_cancel_1',
      driverId: 'driver_1',
      cancellationFeeCents: 2000,
      netAmountCents: 1500,
      wooviFeeCents: 500
    });

    const event = firestore.docs.get(`financial_ledger_events/${result.eventId}`);

    expect(result).toMatchObject({
      success: true,
      totalDebitCents: 2000,
      totalCreditCents: 2000
    });
    expect(event.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        account: 'liability:ride_payment_holding',
        direction: 'debit',
        amountCents: 2000
      }),
      expect.objectContaining({
        account: 'liability:driver_balance_payable',
        direction: 'credit',
        amountCents: 1500
      }),
      expect.objectContaining({
        account: 'contra_revenue:payment_intermediation_fee',
        direction: 'credit',
        amountCents: 500
      })
    ]));
  });

  it('records a balanced refund with asset and liability lines', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new FinancialLedgerService();

    const result = await service.recordRefund({
      rideId: 'ride_refund_1',
      chargeId: 'charge_refund_1',
      refundId: 'refund_1',
      amountCents: 2500,
      passengerId: 'passenger_1',
      reason: 'cancelamento'
    });

    const event = firestore.docs.get(`financial_ledger_events/${result.eventId}`);

    expect(result).toMatchObject({
      success: true,
      totalDebitCents: 2500,
      totalCreditCents: 2500
    });
    expect(event.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        account: 'liability:ride_payment_holding',
        direction: 'debit',
        amountCents: 2500
      }),
      expect.objectContaining({
        account: 'asset:leaf_cash_pix',
        direction: 'credit',
        amountCents: 2500
      })
    ]));
  });

  it('records a withdrawal processed event with driver_pending debit and cash credit', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new FinancialLedgerService();

    const result = await service.recordWithdrawalProcessed({
      withdrawalId: 'withdrawal_proc_1',
      driverId: 'driver_1',
      amountCents: 2500,
      transferId: 'transfer_1'
    });

    const event = firestore.docs.get(`financial_ledger_events/${result.eventId}`);

    expect(result).toMatchObject({
      success: true,
      totalDebitCents: 2500,
      totalCreditCents: 2500
    });
    expect(event.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        account: 'liability:driver_withdrawal_pending',
        direction: 'debit',
        amountCents: 2500
      }),
      expect.objectContaining({
        account: 'asset:leaf_cash_pix',
        direction: 'credit',
        amountCents: 2500
      })
    ]));
  });

  it('flags processed withdrawals whose Pix Out ledger is pending', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new FinancialLedgerService();

    firestore.docs.set('driver_withdrawals/withdrawal_bad', {
      driverId: 'driver_1',
      amountCents: 2500,
      feeCents: 100,
      totalDebitCents: 2600,
      status: 'processed_ledger_pending',
      ledgerStatus: 'posted'
    });
    await service.recordWithdrawalRequested({
      withdrawalId: 'withdrawal_bad',
      driverId: 'driver_1',
      amountCents: 2500,
      withdrawFeeCents: 100,
      requestId: 'request_bad'
    });

    const result = await service.reconcileWithdrawalFinancials({
      withdrawalId: 'withdrawal_bad'
    });

    expect(result.success).toBe(true);
    expect(result.report).toMatchObject({
      withdrawalId: 'withdrawal_bad',
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: 'WITHDRAWAL_PROCESSED_LEDGER_PENDING',
          severity: 'critical'
        })
      ])
    });
  });
});
