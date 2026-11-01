const ReceiptService = require('../../../services/receipt-service');
const { sealFinancialContext } = require('../../../services/financial-runtime-context');
const receiptFirestoreStore = require('../../../services/receipt-firestore-store');
const rideAnnotationStore = require('../../../services/ride-annotation-store');

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

  it('uses the frozen promotional context in a receipt with a legacy driver field', () => {
    const { buildDriverIntroFeeContext } = require('../../../services/driver-intro-fee-policy');
    const driverIntroFee = buildDriverIntroFeeContext({ driverId: 'driver_1', qualifiedCompletedRides: 24, historyVerified: true, historySnapshotId: 'synthetic-history' });
    const service = createReceiptService();
    const financial = service.calculateFinancialBreakdown({ driver: 'driver_1', finalFare: 85, finalPrice: 85, tollFee: 15, financialSnapshot: { driverIntroFee } });
    expect(financial.totalPaid.amount).toBe(85);
    expect(financial.breakdown.operationalCost.amount).toBe(0.31);
    expect(financial.breakdown.wooviFee.amount).toBe(0.68);
    expect(financial.breakdown.driverAmount.amount).toBe(84.01);
  });

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

  it('keeps receipt distance in kilometers and real trip duration in minutes', async () => {
    const service = createReceiptService();

    const receipt = await service.generateReceipt('ride_backend_route_metrics', {
      ...finalRideData,
      distance: 27.1,
      routeDistanceKm: 27.1,
      durationSeconds: 1980,
      routeDurationSecs: 1980,
      payment_mode: 'pix',
    });

    expect(receipt.trip.distance).toMatchObject({
      actual: 27.1,
      estimated: 27.1,
      formatted: '27.10 km',
      unit: 'km',
    });
    expect(receipt.trip.duration).toBe(20);
    expect(receipt.trip.durationFormatted).toBe('20min');
    expect(receipt.payment.method).toBe('PIX');
  });

  it('uses the route estimate only when the ride has no real start time', async () => {
    const service = createReceiptService();
    const { tripStartTime, ...rideWithoutStart } = finalRideData;

    const receipt = await service.generateReceipt('ride_without_start_time', {
      ...rideWithoutStart,
      routeDurationSecs: 1980,
      payment_mode: 'pix',
    });

    expect(receipt.trip.duration).toBe(33);
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

  const sandboxFinancialContext = () => sealFinancialContext({
    providerEnvironment: 'sandbox',
    paymentProfileId: 'qa-test-users-sandbox-durable',
    paymentProfileSource: 'firestore',
    testUserSandbox: true
  });

  // Receipts live only in the Firestore receipt store (RTDB retired); the ride
  // annotation keeps the pointer. Both are observed through spies.
  const withReceiptStore = (service, { stored = null, writeError = null } = {}) => {
    service.getReceiptFirestore = () => ({});
    return {
      getByRideId: jest.spyOn(receiptFirestoreStore, 'getByRideId').mockImplementation(async (_fs, scope, rideId) => (
        typeof stored === 'function' ? stored(scope, rideId) : stored
      )),
      write: jest.spyOn(receiptFirestoreStore, 'write').mockImplementation(async () => {
        if (writeError) throw writeError;
        return { mirrored: true };
      }),
      listPage: jest.spyOn(receiptFirestoreStore, 'listPage').mockResolvedValue({ receipts: [], pagination: 'keyset' }),
      pointer: jest.spyOn(rideAnnotationStore, 'updateAnnotation').mockResolvedValue(undefined)
    };
  };

  afterEach(() => jest.restoreAllMocks());

  it('loads a stored final receipt before trying to regenerate from an active booking', async () => {
    const service = createReceiptService();
    const storedReceipt = {
      receiptId: 'LEAF-ride_stored',
      rideId: 'ride_stored',
      metadata: {
        status: 'COMPLETED',
        authoritativeSnapshot: true,
        financialSnapshotSource: 'backend_final',
      },
      customer: { id: 'passenger_1' },
      driver: { id: 'driver_1' },
    };
    const store = withReceiptStore(service, { stored: (_scope, rideId) => (rideId === 'ride_stored' ? storedReceipt : null) });
    const redis = {
      hget: jest.fn(),
    };

    await expect(service.getReceiptByRideId('ride_stored', redis)).resolves.toEqual(storedReceipt);
    expect(redis.hget).not.toHaveBeenCalled();
    expect(store.getByRideId.mock.calls[0][1].collections.receipts).toBe('receipts');
  });

  it('stores sandbox receipts only in the sandbox receipt namespace', async () => {
    const service = createReceiptService();
    const store = withReceiptStore(service);
    const financialContext = sandboxFinancialContext();

    const saved = await service.saveReceiptToFirestore({
      receiptId: 'LEAF-ride_sandbox_receipt',
      rideId: 'ride_sandbox_receipt',
      hash: 'HASH_SANDBOX',
      financialContext
    });

    expect(saved).toBe(true);
    expect(store.write.mock.calls[0][2].collections.receipts).toBe('sandbox_receipts');
    expect(store.write.mock.calls[0][1]).toMatchObject({ rideId: 'ride_sandbox_receipt', financialNamespace: 'sandbox' });
    expect(store.pointer).toHaveBeenCalledWith(expect.anything(), 'sandbox_bookings', 'ride_sandbox_receipt',
      { receipt: expect.objectContaining({ receiptId: 'LEAF-ride_sandbox_receipt', financialNamespace: 'sandbox' }) });
  });

  it('fails closed before writing when a sandbox signal has no sealed context', async () => {
    const service = createReceiptService();
    const store = withReceiptStore(service);

    await expect(service.saveReceiptToFirestore({
      receiptId: 'LEAF-ride_sandbox_lost_context',
      rideId: 'ride_sandbox_lost_context',
      hash: 'HASH_SANDBOX',
      financialNamespace: 'sandbox'
    })).rejects.toMatchObject({
      code: 'RECEIPT_PERSIST_FAILED',
      details: expect.objectContaining({
        stage: 'financial_context',
        contextCode: 'FINANCIAL_SANDBOX_CONTEXT_LOST'
      })
    });
    expect(store.write).not.toHaveBeenCalled();
    expect(store.pointer).not.toHaveBeenCalled();
  });

  it('reads a sandbox receipt only from its resolved namespace', async () => {
    const service = createReceiptService();
    const financialContext = sandboxFinancialContext();
    const storedReceipt = {
      receiptId: 'LEAF-ride_sandbox_read',
      rideId: 'ride_sandbox_read',
      financialContext,
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId
    };
    const store = withReceiptStore(service, {
      stored: (scope, rideId) => (scope.collections.receipts === 'sandbox_receipts' && rideId === 'ride_sandbox_read' ? storedReceipt : null)
    });

    await expect(service.getReceiptFromFirestore('ride_sandbox_read', { financialContext })).resolves.toEqual(storedReceipt);
    expect(store.getByRideId).toHaveBeenCalledTimes(1);
    expect(store.getByRideId.mock.calls[0][1].collections.receipts).toBe('sandbox_receipts');
  });

  it('rejects an operational active-booking cache hit during sandbox receipt recovery', async () => {
    const service = createReceiptService();
    const store = withReceiptStore(service);
    const readAnnotation = jest.spyOn(rideAnnotationStore, 'readAnnotation');
    const redis = {
      hget: jest.fn(async () => JSON.stringify({
        id: 'ride_cross_scope_cache',
        customer: 'passenger_1',
        status: 'completed'
      }))
    };

    await expect(service.getReceiptByRideId(
      'ride_cross_scope_cache',
      redis,
      sandboxFinancialContext()
    )).rejects.toMatchObject({
      code: 'SANDBOX_RECORD_CONTEXT_INVALID'
    });
    expect(store.getByRideId.mock.calls[0][1].collections.receipts).toBe('sandbox_receipts');
    expect(readAnnotation).not.toHaveBeenCalled();
  });

  it('lists persisted receipts from the resolved sandbox namespace and owner role', async () => {
    const service = createReceiptService();
    const store = withReceiptStore(service);
    const sandboxContext = sandboxFinancialContext();

    await service.listStoredReceiptsByUser({
      userId: 'passenger_1',
      role: 'customer',
      financialContext: sandboxContext,
      limit: 1,
      offset: 1
    });
    await service.listStoredReceiptsByUser({
      userId: 'driver_1',
      role: 'driver',
      financialContext: sandboxContext
    });

    const [customerCall, driverCall] = store.listPage.mock.calls.map(([, query]) => query);
    expect(customerCall).toMatchObject({ role: 'customer', userId: 'passenger_1', limit: 1, offset: 1 });
    expect(customerCall.scope).toMatchObject({ namespace: 'sandbox', financialContextId: sandboxContext.contextId });
    expect(customerCall.scope.collections.receipts).toBe('sandbox_receipts');
    expect(driverCall).toMatchObject({ role: 'driver', userId: 'driver_1', limit: 10, offset: 0 });
    expect(customerCall.ownerOf({ customer: { id: 'passenger_1' } }, 'customer')).toBe('passenger_1');
  });

  it('fails generation with a typed persistence error when the receipt write fails', async () => {
    const service = createReceiptService();
    withReceiptStore(service, { writeError: new Error('Firestore write unavailable') });

    await expect(
      service.generateAndSaveReceipt('ride_persist_failure', finalRideData)
    ).rejects.toMatchObject({
      name: 'ReceiptPersistenceError',
      code: 'RECEIPT_PERSIST_FAILED',
      statusCode: 503,
      details: {
        rideId: 'ride_persist_failure',
        stage: 'database_write'
      }
    });
  });

  it('returns null instead of throwing when neither stored receipt nor active booking exists', async () => {
    const service = createReceiptService();
    const store = withReceiptStore(service);
    const readAnnotation = jest.spyOn(rideAnnotationStore, 'readAnnotation').mockResolvedValue(null);
    jest.spyOn(rideAnnotationStore, 'resolveFirestore').mockReturnValue({});
    const redis = {
      hget: jest.fn(async () => null),
    };

    await expect(service.getReceiptByRideId('ride_missing', redis)).resolves.toBeNull();
    expect(store.getByRideId).toHaveBeenCalledTimes(1);
    expect(readAnnotation).toHaveBeenCalledWith({}, 'bookings', 'ride_missing');
  });

  it('uses passenger and driver ids as receipt owners when legacy customer/driver fields are absent', async () => {
    const service = createReceiptService();

    const receipt = await service.generateReceipt('ride_owner_ids', {
      ...finalRideData,
      customer: '',
      driver: '',
      customer_name: '',
      driver_name: '',
      customerId: 'passenger_from_booking',
      driverId: 'driver_from_booking',
      passengerName: 'Passageiro Canonico',
      driverName: 'Motorista Canonico',
      carPlate: 'TES6789',
      carModel: 'Toyota Prius',
    });

    expect(receipt.customer).toMatchObject({
      id: 'passenger_from_booking',
      name: 'Passageiro Canonico',
    });
    expect(receipt.driver).toMatchObject({
      id: 'driver_from_booking',
      name: 'Motorista Canonico',
    });
    expect(receipt.driver.vehicle).toMatchObject({
      plate: 'TES6789',
      model: 'Toyota Prius',
      brandModel: 'Toyota Prius',
    });
  });
});
