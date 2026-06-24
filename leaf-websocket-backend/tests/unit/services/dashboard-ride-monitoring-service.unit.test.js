const {
  buildRecentRideActivities,
  countActiveRidesFromActiveHash,
  isRideRevenuePendingFinalSnapshot,
  isRideLikeRecord,
  normalizeRideStatus,
  resolveRideDriverNetAmount,
  resolveRideOperationalFee,
  resolveRideRevenue,
  resolveRideStatusLabel
} = require('../../../services/dashboard-ride-monitoring-service');

describe('dashboard-ride-monitoring-service', () => {
  test('buildRecentRideActivities usa fallback de state e nao gera Corrida undefined', () => {
    const activities = buildRecentRideActivities([
      {
        id: 'booking-1',
        state: 'accepted',
        customerId: 'passenger-1',
        customer_paid: '18.5',
        updatedAt: '2026-04-06T10:00:00.000Z'
      },
      {
        id: 'booking-2',
        status: 'COMPLETED',
        driverId: 'driver-1',
        finalPrice: 21.75,
        authoritativeSnapshot: true,
        financialSnapshotSource: 'backend_final',
        updatedAt: '2026-04-06T10:10:00.000Z'
      }
    ], 10);

    expect(activities).toHaveLength(2);
    expect(activities[0]).toEqual(expect.objectContaining({
      id: 'booking-2',
      description: 'Corrida concluída',
      user: 'driver-1',
      metadata: expect.objectContaining({
        status: 'COMPLETED',
        fare: 21.75,
        farePendingReconciliation: false
      })
    }));
    expect(activities[1]).toEqual(expect.objectContaining({
      id: 'booking-1',
      description: 'Corrida aceita',
      user: 'passenger-1',
      metadata: expect.objectContaining({
        status: 'ACCEPTED',
        fare: 18.5,
        farePendingReconciliation: false
      })
    }));
  });

  test('resolveRideRevenue nao usa estimativa para corrida concluida sem snapshot backend_final', () => {
    expect(resolveRideRevenue({
      status: 'COMPLETED',
      finalPrice: 81.17,
      fare: 27.5,
      estimatedFare: 27.5,
      estimate: 27.5
    })).toBe(0);

    expect(resolveRideRevenue({
      status: 'COMPLETED',
      finalPrice: 81.17,
      fare: 27.5,
      estimatedFare: 27.5,
      estimate: 27.5,
      authoritativeSnapshot: true,
      financialSnapshotSource: 'backend_final'
    })).toBe(81.17);
  });

  test('resolvers financeiros preferem snapshot backend_final em centavos para corrida concluida', () => {
    const ride = {
      status: 'COMPLETED',
      finalPrice: 27.5,
      operationalFee: 9.99,
      driverNetAmount: 10,
      financialSnapshot: JSON.stringify({
        authoritativeSnapshot: true,
        financialSnapshotSource: 'backend_final',
        passengerPaidCents: 8117,
        tollFeeCents: 0,
        operationalFeeCents: 149,
        paymentIntermediationFeeCents: 65,
        totalFeesCents: 214,
        driverNetAmountCents: 7903
      })
    };

    expect(isRideRevenuePendingFinalSnapshot(ride)).toBe(false);
    expect(resolveRideRevenue(ride)).toBe(81.17);
    expect(resolveRideOperationalFee(ride)).toBe(1.49);
    expect(resolveRideDriverNetAmount(ride)).toBe(79.03);
  });

  test('resolvers financeiros nao usam taxa ou repasse sem snapshot backend_final', () => {
    expect(resolveRideOperationalFee({
      status: 'COMPLETED',
      operationalFee: 9.99,
      authoritativeSnapshot: false
    })).toBe(0);

    expect(resolveRideDriverNetAmount({
      status: 'COMPLETED',
      driverNetAmount: 72.11,
      driver_share: 72.11
    })).toBe(0);

    const finalRide = {
      status: 'COMPLETED',
      operationalFee: 1.49,
      driverNetAmount: 78.42,
      authoritativeSnapshot: true,
      financialSnapshotSource: 'backend_final'
    };

    expect(resolveRideOperationalFee(finalRide)).toBe(1.49);
    expect(resolveRideDriverNetAmount(finalRide)).toBe(78.42);
  });

  test('buildRecentRideActivities marca corrida concluida sem snapshot final como pendente', () => {
    const activities = buildRecentRideActivities([{
      id: 'booking-pending',
      status: 'COMPLETED',
      customerId: 'passenger-1',
      fare: 27.5,
      estimatedFare: 27.5,
      updatedAt: '2026-04-06T10:10:00.000Z'
    }], 10);

    expect(activities[0]).toEqual(expect.objectContaining({
      id: 'booking-pending',
      metadata: expect.objectContaining({
        fare: 0,
        farePendingReconciliation: true
      })
    }));
    expect(isRideRevenuePendingFinalSnapshot({
      status: 'COMPLETED',
      fare: 27.5
    })).toBe(true);
  });

  test('countActiveRidesFromActiveHash ignora entradas stale, terminais e malformadas', () => {
    const now = Date.parse('2026-04-06T12:00:00.000Z');
    const count = countActiveRidesFromActiveHash({
      recentAccepted: JSON.stringify({
        status: 'ACCEPTED',
        updatedAt: '2026-04-06T11:55:00.000Z'
      }),
      recentStarted: JSON.stringify({
        state: 'STARTED',
        startedAt: '2026-04-06T11:40:00.000Z'
      }),
      oldAccepted: JSON.stringify({
        status: 'ACCEPTED',
        updatedAt: '2026-04-05T00:00:00.000Z'
      }),
      completed: JSON.stringify({
        status: 'COMPLETED',
        updatedAt: '2026-04-06T11:50:00.000Z'
      }),
      invalid: '{not-json'
    }, { now, maxAgeMs: 12 * 60 * 60 * 1000 });

    expect(count).toBe(2);
  });

  test('helpers normalizam status e labels operacionais', () => {
    expect(normalizeRideStatus('', null, 'started')).toBe('STARTED');
    expect(resolveRideStatusLabel('NO_DRIVERS_FOUND')).toBe('sem motorista');
    expect(resolveRideStatusLabel('')).toBe('atualizada');
  });

  test('isRideLikeRecord filtra nos degradados de recibo isolado', () => {
    expect(isRideLikeRecord({
      receipt: {
        receiptId: 'LEAF-1',
        savedAt: '2026-04-06T10:00:00.000Z'
      }
    })).toBe(false);

    expect(isRideLikeRecord({
      customerId: 'passenger-1',
      createdAt: '2026-04-06T10:00:00.000Z'
    })).toBe(true);
  });
});
