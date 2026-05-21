jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => null)
}));

jest.mock('../../../utils/logger', () => ({
  logError: jest.fn()
}));

const firebaseConfig = require('../../../firebase-config');
const {
  FinancialReconciliationDashboardService
} = require('../../../services/financial-reconciliation-dashboard-service');

function createInMemoryFirestore() {
  const docs = new Map();

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

  const doc = (path) => ({
    path,
    id: path.split('/').pop(),
    get: async () => ({
      exists: docs.has(path),
      data: () => docs.get(path)
    }),
    set: async (data) => {
      docs.set(path, data);
    }
  });

  const collection = (path) => {
    const queryState = {
      filters: [],
      limitValue: null,
      orderByField: null,
      orderByDirection: 'asc',
      startAfterValue: null
    };

    const queryApi = {
      doc: (id = `auto_${docs.size + 1}`) => doc(`${path}/${id}`),
      where: (field, operator, expected) => {
        queryState.filters.push({ field, operator, expected });
        return queryApi;
      },
      orderBy: (field, direction = 'asc') => {
        queryState.orderByField = field;
        queryState.orderByDirection = direction;
        return queryApi;
      },
      startAfter: (value) => {
        queryState.startAfterValue = value;
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
        if (queryState.orderByField) {
          rows.sort(([, a], [, b]) => {
            const direction = queryState.orderByDirection === 'desc' ? -1 : 1;
            return direction * String(a?.[queryState.orderByField] || '').localeCompare(String(b?.[queryState.orderByField] || ''));
          });
        }
        if (queryState.startAfterValue && queryState.orderByField) {
          rows = rows.filter(([, data]) => String(data?.[queryState.orderByField] || '') < String(queryState.startAfterValue));
        }
        if (Number.isFinite(queryState.limitValue)) {
          rows = rows.slice(0, queryState.limitValue);
        }
        return makeSnapshot(rows);
      }
    };

    return queryApi;
  };

  return {
    docs,
    collection
  };
}

describe('FinancialReconciliationDashboardService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    firebaseConfig.getFirestore.mockReturnValue(createInMemoryFirestore());
  });

  it('lists divergent reconciliation reports with summary filters', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    firestore.docs.set('financial_reconciliation_reports/ride_ok', {
      rideId: 'ride_ok',
      ok: true,
      issues: [],
      checkedAtIso: '2026-05-21T10:00:00.000Z'
    });
    firestore.docs.set('financial_reconciliation_reports/ride_bad', {
      rideId: 'ride_bad',
      ok: false,
      issues: [
        {
          code: 'SETTLEMENT_AMOUNT_MISMATCH',
          severity: 'high',
          message: 'Valor divergente'
        }
      ],
      checkedAtIso: '2026-05-21T11:00:00.000Z'
    });

    const service = new FinancialReconciliationDashboardService();
    const result = await service.listReports({
      status: 'divergent',
      code: 'SETTLEMENT_AMOUNT_MISMATCH'
    });

    expect(result).toMatchObject({
      success: true,
      reports: [
        expect.objectContaining({
          rideId: 'ride_bad',
          status: 'divergent',
          severity: 'high'
        })
      ],
      summary: {
        totalInPage: 1,
        okInPage: 0,
        divergentInPage: 1,
        totalIssueCount: 1,
        byCode: {
          SETTLEMENT_AMOUNT_MISMATCH: 1
        },
        bySeverity: {
          high: 1
        }
      }
    });
  });

  it('returns ride report detail with ledger events and source documents', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    firestore.docs.set('financial_reconciliation_reports/ride_detail', {
      rideId: 'ride_detail',
      ok: false,
      issues: [{ code: 'PAYMENT_WITHOUT_LEDGER_EVENT', severity: 'high' }],
      checkedAtIso: '2026-05-21T12:00:00.000Z'
    });
    firestore.docs.set('financial_ledger_events/event_late', {
      rideId: 'ride_detail',
      eventType: 'ride_settlement',
      createdAtIso: '2026-05-21T12:02:00.000Z'
    });
    firestore.docs.set('financial_ledger_events/event_early', {
      rideId: 'ride_detail',
      eventType: 'payment_received',
      createdAtIso: '2026-05-21T12:01:00.000Z'
    });
    firestore.docs.set('ride_payments/ride_detail', {
      amount: 3000,
      status: 'CONFIRMED'
    });
    firestore.docs.set('payment_holdings/ride_detail', {
      amount: 3000,
      status: 'in_holding'
    });
    firestore.docs.set('payment_distributions/ride_detail', {
      totalAmount: 3000
    });

    const service = new FinancialReconciliationDashboardService();
    const result = await service.getRideDetail('ride_detail');

    expect(result).toMatchObject({
      success: true,
      report: expect.objectContaining({
        rideId: 'ride_detail',
        status: 'divergent'
      }),
      sourceDocuments: {
        ridePayment: expect.objectContaining({ amount: 3000 }),
        paymentHolding: expect.objectContaining({ status: 'in_holding' }),
        paymentDistribution: expect.objectContaining({ totalAmount: 3000 })
      }
    });
    expect(result.ledgerEvents.map((event) => event.eventType)).toEqual([
      'payment_received',
      'ride_settlement'
    ]);
  });

  it('fails cleanly when Firestore is unavailable', async () => {
    firebaseConfig.getFirestore.mockReturnValue(null);
    const service = new FinancialReconciliationDashboardService();

    const result = await service.listReports();

    expect(result).toMatchObject({
      success: false,
      error: 'Firestore nao disponivel para relatorios financeiros'
    });
  });
});
