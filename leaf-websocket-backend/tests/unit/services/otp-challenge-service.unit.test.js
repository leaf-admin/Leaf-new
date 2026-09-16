const mockRedisSet = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisDel = jest.fn();
const mockRedisEval = jest.fn();

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn(() => ({
    set: mockRedisSet,
    get: mockRedisGet,
    del: mockRedisDel
  }))
}));

const {
  consumeChallenge,
  generateOtp,
  hashOtp,
  hashesMatch,
  storeChallenge
} = require('../../../services/otp-challenge-service');
const redisPool = require('../../../utils/redis-pool');

const env = {
  NODE_ENV: 'production',
  AUTH_OTP_HMAC_KEY: 'unit-test-auth-otp-hmac-key-with-32-bytes'
};

describe('otp-challenge-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRedisDel.mockResolvedValue(1);
  });

  it('generates a cryptographic six digit code', () => {
    const otp = generateOtp();
    expect(otp).toMatch(/^\d{6}$/);
  });

  it('hashes the code with the verification context and compares in constant time', () => {
    const args = {
      namespace: 'login',
      verificationId: 'vid_unit',
      phone: '+5521999999999',
      otp: '123456',
      env
    };
    const digest = hashOtp(args);

    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(hashesMatch(digest, digest)).toBe(true);
    expect(hashesMatch(digest, hashOtp({ ...args, otp: '654321' }))).toBe(false);
    expect(hashesMatch('123456', digest)).toBe(false);
  });

  it('stores only a digest with an expiry and consumes it once', async () => {
    const args = {
      namespace: 'login',
      verificationId: 'vid_unit',
      phone: '+5521999999999',
      otp: '123456',
      keys: ['otp:vid_unit:+5521999999999'],
      ttlSeconds: 300,
      env
    };

    await storeChallenge(args);
    const storedHash = mockRedisSet.mock.calls[0][1];
    expect(storedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(mockRedisSet).toHaveBeenCalledWith(args.keys[0], storedHash, 'EX', 300);

    mockRedisGet.mockResolvedValue(storedHash);
    await expect(consumeChallenge(args)).resolves.toBe(true);
    expect(mockRedisDel).toHaveBeenCalledWith(args.keys[0]);

    mockRedisGet.mockResolvedValue(storedHash);
    await expect(consumeChallenge({ ...args, otp: '654321' })).resolves.toBe(false);
  });

  it('uses Redis atomic compare-and-delete when the adapter supports EVAL', async () => {
    const args = {
      namespace: 'login',
      verificationId: 'vid_atomic',
      phone: '+5521999999999',
      otp: '123456',
      keys: ['otp:vid_atomic:+5521999999999'],
      env
    };
    const expectedHash = hashOtp(args);
    mockRedisEval.mockResolvedValue(1);
    redisPool.getConnection.mockReturnValueOnce({ eval: mockRedisEval });

    await expect(consumeChallenge(args)).resolves.toBe(true);
    expect(mockRedisEval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('GET', key)"),
      1,
      args.keys[0],
      expectedHash
    );
  });

  it('cleans all aliases when a Redis challenge write is partial', async () => {
    const args = {
      namespace: 'login',
      verificationId: 'vid_partial',
      phone: '+5521999999999',
      otp: '123456',
      keys: ['otp:vid_partial:+5521999999999', 'otp:vid_partial:5521999999999'],
      env
    };
    mockRedisSet.mockResolvedValueOnce('OK').mockRejectedValueOnce(new Error('redis write failed'));

    await expect(storeChallenge(args)).rejects.toThrow('redis write failed');
    expect(mockRedisDel).toHaveBeenCalledWith(...args.keys);
  });
});
