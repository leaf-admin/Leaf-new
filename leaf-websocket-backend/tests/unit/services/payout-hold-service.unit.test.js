const service = require('../../../services/payout-hold-service');

function createFakeRedis(seed = {}) {
  const hashes = new Map(Object.entries(seed.hashes || {}).map(([key, value]) => [key, { ...value }]));
  const zsets = new Map(Object.entries(seed.zsets || {}));
  return {
    hashes,
    async hgetall(key) {
      return hashes.has(key) ? { ...hashes.get(key) } : {};
    },
    async hget(key, field) {
      return hashes.get(key)?.[field] ?? null;
    },
    async hset(key, field, value) {
      const current = hashes.get(key) || {};
      if (typeof field === 'object') Object.assign(current, field);
      else current[field] = value;
      hashes.set(key, current);
      return 1;
    },
    async hdel(key, ...fields) {
      const current = hashes.get(key) || {};
      fields.forEach((field) => delete current[field]);
      return fields.length;
    },
    async zrevrange(key) {
      return zsets.get(key) || [];
    }
  };
}

const EVENT = { eventType: 'ride.completed', data: { bookingId: 'b1', driverId: 'd1', customerId: 'c1' } };

describe('payout-hold-service.evaluateRideHold', () => {
  it('returns no reason for a clean ride', async () => {
    const redis = createFakeRedis({ hashes: { 'booking:b1': { driverId: 'd1' } } });
    const { reasons } = await service.evaluateRideHold(redis, { bookingId: 'b1', driverId: 'd1' });
    expect(reasons).toEqual([]);
  });

  it('holds when the passenger GPS diverged and boarding was never confirmed', async () => {
    const redis = createFakeRedis({
      hashes: {
        'trip_integrity:b1': { holdRecommendedAt: '1' },
        'booking:b1': {
          pickupLocation: JSON.stringify({ lat: 1, lng: 2, add: 'Rua A, 10' }),
          destinationLocation: JSON.stringify({ lat: 3, lng: 4, add: 'Praia B' })
        }
      }
    });
    const result = await service.evaluateRideHold(redis, { bookingId: 'b1', driverId: 'd1' });
    expect(result.reasons).toEqual([service.HOLD_REASONS.LOCATION_DIVERGENCE]);
    expect(result.summary).toEqual({ pickupAddress: 'Rua A, 10', destinationAddress: 'Praia B' });
  });

  it('does not hold when the passenger confirmed boarding after an alert', async () => {
    const redis = createFakeRedis({
      hashes: { 'trip_integrity:b1': { alertOpenAt: '10', boardingConfirmedAt: '20' } }
    });
    const { reasons } = await service.evaluateRideHold(redis, { bookingId: 'b1', driverId: 'd1' });
    expect(reasons).toEqual([]);
  });

  it('holds for an open incident, an end far from destination and a location signal of this ride', async () => {
    const redis = createFakeRedis({
      hashes: {
        'booking:b1': {
          opsReviewRequired: 'true',
          earlyEndSettlementSkipped: JSON.stringify({ reason: 'SETTLEMENT_DISABLED', remainingMeters: 1800 })
        },
        'safety:signal:s-other': { type: 'mock_location', bookingId: 'b0', sandbox: 'false' },
        'safety:signal:s1': { type: 'location_jump', bookingId: 'b1', sandbox: 'false' }
      },
      zsets: { 'safety:driver:d1:signals': ['s-other', 's1'] }
    });
    const { reasons } = await service.evaluateRideHold(redis, { bookingId: 'b1', driverId: 'd1' });
    expect(reasons).toEqual([
      service.HOLD_REASONS.OPEN_INCIDENT,
      service.HOLD_REASONS.ENDED_FAR_FROM_DESTINATION,
      service.HOLD_REASONS.LOCATION_SIGNAL
    ]);
  });

  it('ignores sandbox safety signals', async () => {
    const redis = createFakeRedis({
      hashes: { 'safety:signal:s1': { type: 'mock_location', bookingId: 'b1', sandbox: 'true' } },
      zsets: { 'safety:driver:d1:signals': ['s1'] }
    });
    const { reasons } = await service.evaluateRideHold(redis, { bookingId: 'b1', driverId: 'd1' });
    expect(reasons).toEqual([]);
  });
});

describe('payout-hold-service lifecycle', () => {
  const NOW = 1_800_000_000_000;

  it('records a hold once and keeps the original deadline on reprocessing', async () => {
    const redis = createFakeRedis();
    const first = await service.recordHold(redis, {
      bookingId: 'b1', driverId: 'd1', customerId: 'c1', reasons: ['LOCATION_DIVERGENCE'], event: EVENT, now: NOW
    });
    expect(first.created).toBe(true);
    expect(first.hold.status).toBe(service.HOLD_STATUS.AWAITING_PASSENGER);
    expect(first.hold.autoReleaseAt).toBe(NOW + 24 * 3600 * 1000);

    const second = await service.recordHold(redis, {
      bookingId: 'b1', driverId: 'd1', customerId: 'c1', reasons: ['OPEN_INCIDENT'], event: EVENT, now: NOW + 5000
    });
    expect(second.created).toBe(false);
    expect(second.hold.autoReleaseAt).toBe(NOW + 24 * 3600 * 1000);
  });

  it('releases right away when the passenger confirms and goes to review when they deny', async () => {
    const redis = createFakeRedis();
    await service.recordHold(redis, { bookingId: 'b1', customerId: 'c1', event: EVENT, now: NOW });
    await service.recordHold(redis, { bookingId: 'b2', customerId: 'c1', event: EVENT, now: NOW });

    const wrongPassenger = await service.recordPassengerAnswer(redis, { bookingId: 'b1', customerId: 'c9', tookRide: true });
    expect(wrongPassenger).toEqual({ ok: false, code: 'HOLD_CUSTOMER_MISMATCH' });

    const yes = await service.recordPassengerAnswer(redis, { bookingId: 'b1', customerId: 'c1', tookRide: true, now: NOW + 1 });
    expect(yes.hold.status).toBe(service.HOLD_STATUS.RELEASE_REQUESTED);
    const no = await service.recordPassengerAnswer(redis, { bookingId: 'b2', customerId: 'c1', tookRide: false, now: NOW + 1 });
    expect(no.hold.status).toBe(service.HOLD_STATUS.IN_REVIEW);

    const due = await service.listDueForRelease(redis, { now: NOW + 2 });
    expect(due.map((hold) => hold.bookingId)).toEqual(['b1']);
  });

  it('auto-releases after 24h without an answer but never a ride in review', async () => {
    const redis = createFakeRedis();
    await service.recordHold(redis, { bookingId: 'b1', customerId: 'c1', event: EVENT, now: NOW });
    await service.recordHold(redis, { bookingId: 'b2', customerId: 'c1', event: EVENT, now: NOW });
    await service.recordReviewDecision(redis, { bookingId: 'b2', release: false, note: 'conferir rota', reviewedBy: 'ops' });

    expect(await service.listDueForRelease(redis, { now: NOW + 23 * 3600 * 1000 })).toEqual([]);
    const due = await service.listDueForRelease(redis, { now: NOW + 24 * 3600 * 1000 });
    expect(due.map((hold) => hold.bookingId)).toEqual(['b1']);

    const released = await service.markReleased(redis, 'b1', { now: NOW + 24 * 3600 * 1000 });
    expect(released.status).toBe(service.HOLD_STATUS.RELEASED);
    expect(released.releaseCause).toBe('auto_release_timeout');
  });

  it('keeps the raw event and reasons out of the passenger view', async () => {
    const redis = createFakeRedis();
    const { hold } = await service.recordHold(redis, {
      bookingId: 'b1', customerId: 'c1', reasons: ['LOCATION_SIGNAL'], summary: { pickupAddress: 'A' }, event: EVENT, now: NOW
    });
    const view = service.toPublicView(hold, { audience: 'passenger' });
    expect(view).toEqual({
      bookingId: 'b1',
      completedAt: new Date(NOW).toISOString(),
      pickupAddress: 'A',
      destinationAddress: null
    });
    expect(service.toPublicView(hold).event).toBeUndefined();
  });

  it('prunes released holds after 7 days', async () => {
    const redis = createFakeRedis();
    await service.recordHold(redis, { bookingId: 'b1', customerId: 'c1', event: EVENT, now: NOW });
    await service.markReleased(redis, 'b1', { now: NOW });
    expect(await service.pruneReleased(redis, { now: NOW + 6 * 24 * 3600 * 1000 })).toBe(0);
    expect(await service.pruneReleased(redis, { now: NOW + 8 * 24 * 3600 * 1000 })).toBe(1);
    expect(await service.getHold(redis, 'b1')).toBeNull();
  });
});
