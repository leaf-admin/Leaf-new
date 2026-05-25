const {
  buildRecentRideActivities,
  countActiveRidesFromActiveHash,
  isRideLikeRecord,
  normalizeRideStatus,
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
        fare: 21.75
      })
    }));
    expect(activities[1]).toEqual(expect.objectContaining({
      id: 'booking-1',
      description: 'Corrida aceita',
      user: 'passenger-1',
      metadata: expect.objectContaining({
        status: 'ACCEPTED',
        fare: 18.5
      })
    }));
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
