const { applyBookingSafetyTtl } = require('../../../utils/booking-redis-ttl');

describe('booking-redis-ttl', () => {
  afterEach(() => {
    delete process.env.RIDE_BOOKING_SAFETY_TTL_SECONDS;
  });

  it('caps booking hashes with EXPIRE NX so shorter terminal TTLs are kept', () => {
    const pipeline = { expire: jest.fn() };

    applyBookingSafetyTtl(pipeline, 'booking:abc');

    expect(pipeline.expire).toHaveBeenCalledWith('booking:abc', 7 * 24 * 60 * 60, 'NX');
  });

  it('ignores configured values below one day', () => {
    process.env.RIDE_BOOKING_SAFETY_TTL_SECONDS = '60';
    const pipeline = { expire: jest.fn() };

    applyBookingSafetyTtl(pipeline, 'booking:abc');

    expect(pipeline.expire).toHaveBeenCalledWith('booking:abc', 7 * 24 * 60 * 60, 'NX');
  });

  it('is a no-op for clients without expire', () => {
    expect(() => applyBookingSafetyTtl({}, 'booking:abc')).not.toThrow();
  });
});
