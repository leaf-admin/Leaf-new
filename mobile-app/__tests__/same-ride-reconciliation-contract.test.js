const {
  validateSameRideReconciliation,
} = require('../scripts/qa/validate-same-ride-reconciliation.cjs');

function buildGoodEvidence() {
  const snapshot = {
    version: 'ride_financial_snapshot_v1',
    authoritativeSnapshot: true,
    financialSnapshotSource: 'backend_final',
    passengerPaidCents: 3000,
    grossFareCents: 3000,
    tollFeeCents: 0,
    operationalFeeCents: 300,
    paymentIntermediationFeeCents: 200,
    subscriptionRetainedFeeCents: 0,
    retainedTotalCents: 500,
    driverNetAmountCents: 2500,
    allocatedTotalCents: 3000,
    balanced: true,
  };

  return {
    rideId: 'ride_e3_1',
    quote: {
      rideId: 'ride_e3_1',
      quote: { amountCents: 3000 },
    },
    payment: {
      charge: {
        rideId: 'ride_e3_1',
        value: 3000,
        environment: 'sandbox',
        status: 'COMPLETED',
      },
      response: { success: true },
    },
    receipt: {
      rideId: 'ride_e3_1',
      metadata: {
        authoritativeSnapshot: true,
        financialSnapshotSource: 'backend_final',
        financialNamespace: 'sandbox',
      },
      financial: {
        totalPaid: { amount: 30 },
        totals: {
          customerPaid: 30,
          driverReceived: 25,
          leafOperational: 3,
          wooviFee: 2,
          tollPassThrough: 0,
          retainedFees: 5,
        },
      },
    },
    dashboard: {
      rideId: 'ride_e3_1',
      reconciliation: {
        ok: true,
        json: {
          success: true,
          report: {
            rideId: 'ride_e3_1',
            ok: true,
            financialNamespace: 'sandbox',
            totals: { passengerGrossCents: 3000 },
          },
          ledgerRideIds: ['ride_e3_1'],
          ledgerEvents: [
            {
              eventId: 'payment-event',
              eventType: 'payment_received',
              rideId: 'ride_e3_1',
              status: 'posted',
              totalDebitCents: 3000,
              financialNamespace: 'sandbox',
              lines: [],
            },
            {
              eventId: 'settlement-event',
              eventType: 'ride_settlement',
              rideId: 'ride_e3_1',
              status: 'posted',
              totalDebitCents: 3000,
              financialNamespace: 'sandbox',
              lines: [
                { account: 'liability:driver_balance_payable', direction: 'credit', amountCents: 2500 },
                { account: 'revenue:leaf_operational_fee', direction: 'credit', amountCents: 300 },
                { account: 'contra_revenue:payment_intermediation_fee', direction: 'credit', amountCents: 200 },
              ],
            },
          ],
          sourceDocuments: {
            ridePayment: { rideId: 'ride_e3_1', amount: 3000, financialNamespace: 'sandbox' },
            paymentHolding: { rideId: 'ride_e3_1', amount: 3000, financialNamespace: 'sandbox' },
            paymentDistribution: {
              rideId: 'ride_e3_1',
              totalAmount: 3000,
              financialNamespace: 'sandbox',
              calculation: { totalAmount: 3000, financialContract: snapshot },
            },
          },
        },
      },
    },
  };
}

describe('same-ride reconciliation contract', () => {
  it('passes only when all sources point to one sandbox ride and amounts close', () => {
    const result = validateSameRideReconciliation(buildGoodEvidence());

    expect(result.ok).toBe(true);
    expect(result.status).toBe('PASS');
    expect(result.failureCodes).toEqual([]);
    expect(result.checks.every((check) => check.status === 'PASS')).toBe(true);
  });

  it('blocks incomplete evidence instead of treating the isolated app-flow marker as payment proof', () => {
    const evidence = buildGoodEvidence();
    evidence.payment = {
      requested: true,
      ok: true,
      source: 'app_payment_flow',
    };
    evidence.quote = null;
    evidence.receipt = null;

    const result = validateSameRideReconciliation(evidence);

    expect(result.ok).toBe(false);
    expect(result.status).toBe('BLOCKED');
    expect(result.failureCodes).toEqual(expect.arrayContaining([
      'required_evidence_missing',
      'source_quote_ride_id_missing',
      'source_receipt_ride_id_missing',
      'pix_not_confirmed',
    ]));
    expect(result.checks.filter((check) => check.status === 'FAIL')).toEqual([]);
    expect(result.checks.some((check) => check.status === 'NOT_RUN')).toBe(true);
  });

  it.each(['ACTIVE', 'PENDING', 'EXPIRED', 'FAILED', 'success'])(
    'rejects charge status %s even when the operation succeeded', (status) => {
      const evidence = buildGoodEvidence();
      evidence.payment.charge.status = status;
      evidence.payment.confirmed = true;
      const result = validateSameRideReconciliation(evidence);
      expect(result.ok).toBe(false);
      expect(result.failureCodes).toContain('pix_not_confirmed');
    }
  );

  it('does not accept generic operation success without payment status', () => {
    const evidence = buildGoodEvidence();
    delete evidence.payment.charge.status;
    const result = validateSameRideReconciliation(evidence);
    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.name === 'pix_confirmed').status).toBe('NOT_RUN');
    expect(result.failureCodes).toContain('pix_not_confirmed');
  });

  it('accepts the canonical sandbox provider confirmation artifact', () => {
    const evidence = buildGoodEvidence();
    delete evidence.payment.charge.status;
    evidence.payment.response = {
      success: true,
      mode: 'woovi_sandbox_testing_confirmed',
      providerConfirmation: { status: 'COMPLETED', transactionID: 'fixture-transaction' },
    };
    expect(validateSameRideReconciliation(evidence).ok).toBe(true);
  });

  it.each([
    { chargeStatus: 'PENDING', responseStatus: 'COMPLETED' },
    { chargeStatus: 'COMPLETED', responseStatus: 'FAILED' },
  ])('rejects conflicting payment envelopes: %j', ({ chargeStatus, responseStatus }) => {
    const evidence = buildGoodEvidence();
    evidence.payment.charge.status = chargeStatus;
    evidence.payment.response.providerConfirmation = { status: responseStatus };
    const result = validateSameRideReconciliation(evidence);
    expect(result.ok).toBe(false);
    expect(result.failureCodes).toContain('pix_not_confirmed');
  });

  it('marks a completely absent evidence set as NOT_RUN without reporting functional failures', () => {
    const result = validateSameRideReconciliation({ rideId: 'ride_e3_missing' });

    expect(result).toMatchObject({
      ok: false,
      status: 'BLOCKED',
    });
    expect(result.checks.filter((check) => check.status === 'FAIL')).toEqual([]);
    expect(result.checks.filter((check) => check.status === 'NOT_RUN').length).toBeGreaterThan(0);
  });

  it('fails on a cross-ride amount or identity mismatch', () => {
    const evidence = buildGoodEvidence();
    evidence.quote.rideId = 'another_ride';
    evidence.quote.quote.amountCents = 3100;

    const result = validateSameRideReconciliation(evidence);

    expect(result.ok).toBe(false);
    expect(result.status).toBe('FAIL');
    expect(result.failureCodes).toEqual(expect.arrayContaining([
      'same_ride_identity_mismatch',
      'gross_amount_missing_or_mismatch',
    ]));
  });

  it('rejects production financial context even when the provider marker says sandbox', () => {
    const evidence = buildGoodEvidence();
    evidence.dashboard.reconciliation.json.report.financialNamespace = 'operational';

    const result = validateSameRideReconciliation(evidence);

    expect(result.ok).toBe(false);
    expect(result.failureCodes).toContain('financial_context_production');
  });

  it('allows an explicitly linked temporary payment ledger ride id', () => {
    const evidence = buildGoodEvidence();
    evidence.payment.charge.rideId = 'temporary_ride_e3_1';
    evidence.payment.paymentReferenceRideId = 'temporary_ride_e3_1';
    evidence.dashboard.reconciliation.json.ledgerRideIds = ['ride_e3_1', 'temporary_ride_e3_1'];
    evidence.dashboard.reconciliation.json.ledgerEvents[0].rideId = 'temporary_ride_e3_1';

    const result = validateSameRideReconciliation(evidence);

    expect(result.ok).toBe(true);
    expect(result.allowedRideIds).toEqual(expect.arrayContaining(['ride_e3_1', 'temporary_ride_e3_1']));
  });
});
