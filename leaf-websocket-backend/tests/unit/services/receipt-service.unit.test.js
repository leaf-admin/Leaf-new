const ReceiptService = require('../../../services/receipt-service');

describe('ReceiptService financial snapshot', () => {
  const finalRideData = {
    customer: 'passenger_1',
    driver: 'driver_1',
    customer_name: 'Passageiro Teste',
    driver_name: 'Motorista Teste',
    pickup: { add: 'Origem', lat: -22.9, lng: -43.2 },
    drop: { add: 'Destino', lat: -22.88, lng: -43.35 },
    status: 'COMPLETED',
    completedAt: '2026-06-21T18:00:00.000Z',
    tripStartTime: '2026-06-21T17:40:00.000Z',
    finalPrice: 81.17,
    finalFare: 81.17,
    grossAmount: 81.17,
    operationalFee: 2.44,
    paymentIntermediationFee: 0.65,
    totalFees: 3.09,
    driverNetAmount: 78.08,
    authoritativeSnapshot: true,
    financialSnapshotSource: 'backend_final',
    fareBreakdown: {
      finalFare: 81.17,
      grossAmount: 81.17,
      operationalFee: 2.44,
      paymentIntermediationFee: 0.65,
      totalFees: 3.09,
      driverNetAmount: 78.08,
      authoritativeSnapshot: true,
      financialSnapshotSource: 'backend_final',
    },
  };

  const createReceiptService = () => {
    const service = new ReceiptService();
    service.generateStaticMapImage = jest.fn(() => null);
    return service;
  };

  it('preserves the final backend fee breakdown instead of recalculating it', () => {
    const service = createReceiptService();
    service.paymentService.calculateFareBreakdownFromReais = jest.fn(() => ({
      operationalFee: 2.44,
      paymentIntermediationFee: 0.89,
      totalFees: 3.33,
      driverNetAmount: 77.84,
    }));

    const financial = service.calculateFinancialBreakdown({
      finalPrice: 81.17,
      operationalFee: 2.44,
      paymentIntermediationFee: 0.65,
      totalFees: 3.09,
      driverNetAmount: 78.08,
      authoritativeSnapshot: true,
      financialSnapshotSource: 'backend_final',
      fareBreakdown: {
        finalFare: 81.17,
        grossAmount: 81.17,
        operationalFee: 2.44,
        paymentIntermediationFee: 0.65,
        totalFees: 3.09,
        driverNetAmount: 78.08,
        authoritativeSnapshot: true,
        financialSnapshotSource: 'backend_final',
      },
    });

    expect(financial.totalPaid.amount).toBeCloseTo(81.17, 2);
    expect(financial.breakdown.operationalCost.amount).toBeCloseTo(2.44, 2);
    expect(financial.breakdown.wooviFee.amount).toBeCloseTo(0.65, 2);
    expect(financial.breakdown.driverAmount.amount).toBeCloseTo(78.08, 2);
    expect(financial.totals.retainedFees).toBeCloseTo(3.09, 2);
  });

  it('generates receipts only from an authoritative backend final snapshot', async () => {
    const service = createReceiptService();

    const receipt = await service.generateReceipt('ride_backend_final', finalRideData);

    expect(receipt.metadata).toMatchObject({
      authoritativeSnapshot: true,
      financialSnapshotSource: 'backend_final',
    });
    expect(receipt.financial.totalPaid.amount).toBeCloseTo(81.17, 2);
    expect(receipt.financial.breakdown.operationalCost.amount).toBeCloseTo(2.44, 2);
    expect(receipt.financial.breakdown.wooviFee.amount).toBeCloseTo(0.65, 2);
    expect(receipt.financial.breakdown.driverAmount.amount).toBeCloseTo(78.08, 2);
    expect(receipt.financial.totals.retainedFees).toBeCloseTo(3.09, 2);
  });

  it('keeps toll pass-through explicit in the final receipt without changing passenger gross', async () => {
    const service = createReceiptService();

    const receipt = await service.generateReceipt('ride_backend_final_toll', {
      ...finalRideData,
      finalPrice: 85,
      finalFare: 85,
      grossAmount: 85,
      tollFee: 15,
      operationalFee: 2.1,
      paymentIntermediationFee: 0.56,
      totalFees: 2.66,
      driverNetAmount: 82.34,
      fareBreakdown: {
        ...finalRideData.fareBreakdown,
        finalFare: 85,
        grossAmount: 85,
        tollFee: 15,
        driverTollPassThrough: 15,
        operationalFee: 2.1,
        paymentIntermediationFee: 0.56,
        totalFees: 2.66,
        driverNetAmount: 82.34,
      },
    });

    expect(receipt.financial.totalPaid.amount).toBeCloseTo(85, 2);
    expect(receipt.financial.breakdown.tollPassThrough).toMatchObject({
      amount: 15,
      passThrough: true,
    });
    expect(receipt.financial.breakdown.driverTollPassThrough).toMatchObject({
      amount: 15,
      passThrough: true,
    });
    expect(receipt.financial.breakdown.driverAmount.amount).toBeCloseTo(82.34, 2);
    expect(receipt.financial.totals.retainedFees).toBeCloseTo(2.66, 2);
    expect(receipt.financial.totals.tollPassThrough).toBeCloseTo(15, 2);
  });

  it('rejects receipt generation without a backend final source', async () => {
    const service = createReceiptService();

    await expect(service.generateReceipt('ride_estimate_only', {
      ...finalRideData,
      financialSnapshotSource: 'quote_estimate',
      fareBreakdown: {
        ...finalRideData.fareBreakdown,
        financialSnapshotSource: 'quote_estimate',
      },
    })).rejects.toMatchObject({
      code: 'RECEIPT_FINANCIAL_SNAPSHOT_INCOMPLETE',
      details: expect.objectContaining({
        missing: expect.arrayContaining(['financialSnapshotSource=backend_final']),
      }),
    });
  });

  it('rejects receipt generation when final gross amount is missing', async () => {
    const service = createReceiptService();

    await expect(service.generateReceipt('ride_missing_gross', {
      ...finalRideData,
      finalPrice: 0,
      finalFare: 0,
      grossAmount: 0,
      fareBreakdown: {
        ...finalRideData.fareBreakdown,
        finalFare: 0,
        grossAmount: 0,
      },
    })).rejects.toMatchObject({
      code: 'RECEIPT_FINANCIAL_SNAPSHOT_INCOMPLETE',
      details: expect.objectContaining({
        missing: expect.arrayContaining(['finalGrossAmount']),
      }),
    });
  });

  it('rejects receipt generation when driver net exceeds passenger gross amount', async () => {
    const service = createReceiptService();

    await expect(service.generateReceipt('ride_invalid_net', {
      ...finalRideData,
      driverNetAmount: 82,
      fareBreakdown: {
        ...finalRideData.fareBreakdown,
        driverNetAmount: 82,
      },
    })).rejects.toMatchObject({
      code: 'RECEIPT_FINANCIAL_SNAPSHOT_INCOMPLETE',
      details: expect.objectContaining({
        missing: expect.arrayContaining(['driverNetAmount+totalFees=grossAmount']),
      }),
    });
  });

  it('rejects receipt generation when the final snapshot leaves part of the passenger gross unallocated', async () => {
    const service = createReceiptService();

    await expect(service.generateReceipt('ride_unallocated_gross', {
      ...finalRideData,
      totalFees: 3,
      driverNetAmount: 78,
      fareBreakdown: {
        ...finalRideData.fareBreakdown,
        totalFees: 3,
        driverNetAmount: 78
      },
    })).rejects.toMatchObject({
      code: 'RECEIPT_FINANCIAL_SNAPSHOT_INCOMPLETE',
      details: expect.objectContaining({
        missing: expect.arrayContaining(['driverNetAmount+totalFees=grossAmount'])
      }),
    });
  });

  it('does not use quote estimates as a receipt gross amount fallback', () => {
    const service = createReceiptService();

    const financial = service.calculateFinancialBreakdown({
      estimate: 91.5,
    });

    expect(financial.totalPaid.amount).toBe(0);
    expect(financial.totals.customerPaid).toBe(0);
  });
});
