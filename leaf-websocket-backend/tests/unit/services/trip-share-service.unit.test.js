const service = require('../../../services/trip-share-service');

function createFakeRedis(seed = {}) {
  const hashes = new Map(Object.entries(seed).map(([key, value]) => [key, { ...value }]));
  const strings = new Map();
  return {
    hashes,
    strings,
    async hgetall(key) { return hashes.has(key) ? { ...hashes.get(key) } : {}; },
    async hset(key, value) { hashes.set(key, { ...(hashes.get(key) || {}), ...value }); return 1; },
    async expire() { return 1; },
    async exists(key) { return hashes.has(key) ? 1 : 0; },
    async get(key) { return strings.get(key) ?? null; },
    async set(key, value) { strings.set(key, value); return 'OK'; }
  };
}

const NOW = 1_800_000_000_000;
const activeBooking = {
  customerId: 'c1',
  driverId: 'd1',
  status: 'STARTED',
  driverName: 'Carlos Alberto Souza',
  driverPhone: '+5521999999999',
  vehicleMake: 'Chevrolet',
  vehicleModel: 'Onix',
  vehicleColor: 'Prata',
  vehiclePlate: 'abc1d23',
  estimatedFare: '42.10',
  pickupLocation: JSON.stringify({ lat: -22.97, lng: -43.18, add: 'Rua da casa do passageiro, 10' }),
  destinationLocation: JSON.stringify({ lat: -22.98, lng: -43.2, add: 'Praia de Ipanema' })
};

describe('trip-share-service', () => {
  it('only the booking passenger can create a link, and never after the ride ended', async () => {
    const redis = createFakeRedis({ 'booking:b1': activeBooking, 'booking:b2': { ...activeBooking, status: 'COMPLETED' } });
    expect(await service.createShareLink(redis, { bookingId: 'b1', customerId: 'c9' })).toEqual({ ok: false, code: 'BOOKING_NOT_FOUND' });
    expect(await service.createShareLink(redis, { bookingId: 'b2', customerId: 'c1' })).toEqual({ ok: false, code: 'BOOKING_ENDED' });

    const created = await service.createShareLink(redis, { bookingId: 'b1', customerId: 'c1', env: {} });
    expect(created.ok).toBe(true);
    expect(created.url).toBe(`https://leaf.app.br/viagem/${created.token}`);
    expect(created.token).not.toContain('b1');
    expect(created.token).toMatch(service.helpers.TOKEN_PATTERN);
  });

  it('reuses the same link for the same ride', async () => {
    const redis = createFakeRedis({ 'booking:b1': activeBooking });
    const first = await service.createShareLink(redis, { bookingId: 'b1', customerId: 'c1' });
    const second = await service.createShareLink(redis, { bookingId: 'b1', customerId: 'c1' });
    expect(second.token).toBe(first.token);
  });

  it('shows what is needed to recognise the car, and nothing else', async () => {
    const redis = createFakeRedis({
      'booking:b1': activeBooking,
      'driver:d1': { lat: '-22.975123456', lng: '-43.190987654', lastUpdate: String(NOW - 10_000), phone: '+5521888' }
    });
    const { token } = await service.createShareLink(redis, { bookingId: 'b1', customerId: 'c1' });

    const view = await service.getPublicView(redis, token, { now: NOW });

    expect(view).toEqual({
      status: 'in_progress',
      driver: { firstName: 'Carlos' },
      vehicle: { model: 'Chevrolet Onix', color: 'Prata', plate: 'ABC1D23' },
      destination: { address: 'Praia de Ipanema' },
      location: { lat: -22.97512, lng: -43.19099, at: new Date(NOW - 10_000).toISOString() },
      updatedAt: new Date(NOW).toISOString()
    });
    const serialized = JSON.stringify(view);
    expect(serialized).not.toMatch(/casa do passageiro|\+55|42\.10|b1|d1|c1/);
  });

  it('drops a stale car position', async () => {
    const redis = createFakeRedis({
      'booking:b1': activeBooking,
      'driver:d1': { lat: '-22.97', lng: '-43.19', lastUpdate: String(NOW - 5 * 60 * 1000) }
    });
    const { token } = await service.createShareLink(redis, { bookingId: 'b1', customerId: 'c1' });
    const view = await service.getPublicView(redis, token, { now: NOW });
    expect(view.location).toBeNull();
  });

  it('shows only the end state once the ride is over', async () => {
    const redis = createFakeRedis({ 'booking:b1': activeBooking });
    const { token } = await service.createShareLink(redis, { bookingId: 'b1', customerId: 'c1' });
    redis.hashes.set('booking:b1', { ...activeBooking, status: 'COMPLETED' });

    const view = await service.getPublicView(redis, token, { now: NOW });
    expect(view).toEqual({ status: 'completed', updatedAt: new Date(NOW).toISOString() });
  });

  it('returns null for unknown or malformed tokens', async () => {
    const redis = createFakeRedis();
    expect(await service.getPublicView(redis, 'b1')).toBeNull();
    expect(await service.getPublicView(redis, '../../etc')).toBeNull();
    expect(await service.getPublicView(redis, 'AAAAAAAAAAAAAAAAAAAAAAAA')).toBeNull();
  });
});
