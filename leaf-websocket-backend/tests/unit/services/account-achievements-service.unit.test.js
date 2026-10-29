jest.mock('../../../services/sandbox-persistence-context', () => ({
  resolveUserPersistenceScope: jest.fn().mockResolvedValue({ namespace: 'operational', collections: { rides: 'rides' } }),
}));
jest.mock('../../../services/rating-service', () => ({
  getUserRatings: jest.fn(),
}));

const ratingService = require('../../../services/rating-service');
const {
  computeAchievements,
  getAccountAchievements,
  summarizeRides,
} = require('../../../services/account-achievements-service');

const NOW = Date.parse('2026-10-29T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function badge(result, id) {
  return result.badges.find((item) => item.id === id);
}

describe('account achievements', () => {
  it('earns passenger milestones by completed trips and time on Leaf', () => {
    const result = computeAchievements(
      { completedTrips: 12, completedInWindow: 3, selfCancellationsInWindow: 0, ratingAverage: 4.9, ratingCount: 11 },
      { role: 'customer', memberSinceMs: NOW - 200 * DAY, now: NOW },
    );
    expect(badge(result, 'trips_10')).toMatchObject({ earned: true });
    expect(badge(result, 'trips_50')).toMatchObject({ earned: false, progress: { current: 12, target: 50 } });
    expect(badge(result, 'months_6')).toMatchObject({ earned: true });
    expect(badge(result, 'months_12')).toMatchObject({ earned: false });
    expect(badge(result, 'rating_high')).toMatchObject({ earned: true, title: 'Passageiro 5 estrelas' });
    expect(badge(result, 'no_cancel_30d')).toMatchObject({ earned: true });
  });

  it('uses the stricter driver quality rules', () => {
    const result = computeAchievements(
      { completedTrips: 60, completedInWindow: 8, selfCancellationsInWindow: 0, ratingAverage: 4.85, ratingCount: 40 },
      { role: 'driver', memberSinceMs: NOW - 30 * DAY, now: NOW },
    );
    expect(badge(result, 'trips_50')).toMatchObject({ earned: true, title: '50 corridas' });
    expect(badge(result, 'rating_high')).toMatchObject({ earned: false, title: 'Nota de ouro' });
    // 8 corridas no mês: o mínimo do motorista para "sem cancelamentos" é 10.
    expect(badge(result, 'no_cancel_30d')).toMatchObject({ earned: false, progress: { current: 8, target: 10 } });
  });

  it('counts only the person own cancellations after accept inside 30 days', () => {
    const stats = summarizeRides([
      { status: 'COMPLETED', completedAt: new Date(NOW - 2 * DAY).toISOString() },
      { status: 'CANCELED', canceledBy: 'pax_1', acceptedAt: 'x', canceledAt: new Date(NOW - 3 * DAY).toISOString() },
      { status: 'CANCELED', canceledBy: 'driver_9', acceptedAt: 'x', canceledAt: new Date(NOW - 3 * DAY).toISOString() },
      { status: 'CANCELED', canceledBy: 'pax_1', canceledAt: new Date(NOW - 3 * DAY).toISOString() },
      { status: 'CANCELED', canceledBy: 'pax_1', acceptedAt: 'x', canceledAt: new Date(NOW - 40 * DAY).toISOString() },
    ], { userId: 'pax_1', role: 'customer', now: NOW });
    expect(stats).toMatchObject({ completedTrips: 1, completedInWindow: 1, selfCancellationsInWindow: 1 });
  });

  it('reads who canceled from the stored reason when the ride has no actor id', () => {
    const stats = summarizeRides([
      { status: 'cancelled', driverId: 'd1', cancellationReason: 'Cancelado pelo passageiro.', cancelledAt: new Date(NOW - DAY).toISOString() },
      { status: 'cancelled', driverId: 'd1', cancellationReason: 'Cancelado pelo motorista.', cancelledAt: new Date(NOW - DAY).toISOString() },
    ], { userId: 'pax_1', role: 'customer', now: NOW });
    expect(stats.selfCancellationsInWindow).toBe(1);
  });

  it('reads rides once and caches the result', async () => {
    ratingService.getUserRatings.mockResolvedValue({ success: true, averageRating: 5, totalRatings: 2 });
    const get = jest.fn().mockResolvedValue({ docs: [{ data: () => ({ status: 'COMPLETED', completedAt: NOW - DAY }) }] });
    const firestore = { collection: jest.fn(() => ({ where: jest.fn(() => ({ limit: jest.fn(() => ({ get })) })) })) };
    const store = new Map();
    const redis = {
      get: jest.fn(async (key) => store.get(key) || null),
      setex: jest.fn(async (key, _ttl, value) => { store.set(key, value); }),
    };

    const first = await getAccountAchievements({ userId: 'pax_1', role: 'customer', memberSince: null, firestore, redis, now: NOW });
    const second = await getAccountAchievements({ userId: 'pax_1', role: 'customer', memberSince: null, firestore, redis, now: NOW });

    expect(badge(first, 'trips_1')).toMatchObject({ earned: true });
    expect(second).toEqual(first);
    expect(get).toHaveBeenCalledTimes(1);
    expect(firestore.collection).toHaveBeenCalledWith('rides');
    // Passageiro: busca por passengerId primeiro.
    expect(firestore.collection.mock.results[0].value.where).toHaveBeenCalledWith('passengerId', '==', 'pax_1');
  });
});
