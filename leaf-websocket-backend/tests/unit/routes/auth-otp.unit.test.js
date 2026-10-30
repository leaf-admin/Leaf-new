process.env.AUTH_TEST_OTP_BYPASS_ENABLED = 'true';
delete process.env.AUTH_TEST_OTP_BYPASS_PHONES;
delete process.env.AUTH_TEST_OTP_BYPASS_CODE;
process.env.APP_REVIEW = 'false';

jest.unmock('express');

const express = require('express');
const request = require('supertest');

// In-memory Redis with the subset of commands the OTP routes use.
const mockStore = new Map();
const mockRedisSet = jest.fn(async (key, value, ...args) => {
  if (args.includes('NX') && mockStore.has(key)) return null;
  mockStore.set(key, String(value));
  return 'OK';
});
const mockRedisGet = jest.fn(async (key) => (mockStore.has(key) ? mockStore.get(key) : null));
const mockRedisDel = jest.fn(async (...keys) => keys.filter((key) => mockStore.delete(key)).length);
const mockRedisIncr = jest.fn(async (key) => {
  const next = Number(mockStore.get(key) || 0) + 1;
  mockStore.set(key, String(next));
  return next;
});
const mockRedisExpire = jest.fn(async () => 1);

const mockGetUserByPhoneNumber = jest.fn();
const mockCreateUser = jest.fn();
const mockCreateCustomToken = jest.fn();
const mockSendOtp = jest.fn();

jest.mock('firebase-admin', () => ({
  auth: jest.fn(() => ({
    getUserByPhoneNumber: mockGetUserByPhoneNumber,
    createUser: mockCreateUser,
    createCustomToken: mockCreateCustomToken
  }))
}));

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn(() => ({
    set: mockRedisSet,
    get: mockRedisGet,
    del: mockRedisDel,
    incr: mockRedisIncr,
    expire: mockRedisExpire
  }))
}));

jest.mock('../../../services/whatsapp-otp-service', () => {
  const actual = jest.requireActual('../../../services/whatsapp-otp-service');
  return { ...actual, sendOtp: (...args) => mockSendOtp(...args) };
});

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

const otpRoutes = require('../../../routes/auth-otp');
const originalEnv = { ...process.env };
const WHATSAPP_ENV = {
  AUTH_OTP_PROVIDER: 'whatsapp',
  WHATSAPP_META_ACCESS_TOKEN: 'test-access-token',
  WHATSAPP_META_PHONE_NUMBER_ID: '123456789',
  WHATSAPP_OTP_TEMPLATE_NAME: 'leaf_codigo',
  AUTH_OTP_HMAC_KEY: 'k'.repeat(32)
};

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/custom-otp', otpRoutes);
  return app;
}

function enableWhatsApp() {
  Object.assign(process.env, WHATSAPP_ENV);
}

function sentCode() {
  return mockSendOtp.mock.calls[mockSendOtp.mock.calls.length - 1][0].otp;
}

describe('auth-otp routes', () => {
  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
    for (const key of Object.keys(WHATSAPP_ENV)) delete process.env[key];
    mockCreateCustomToken.mockResolvedValue('custom-token');
    mockGetUserByPhoneNumber.mockResolvedValue({ uid: 'test_uid' });
    mockSendOtp.mockResolvedValue({ provider: 'whatsapp', messageId: 'wamid.1' });
    process.env.NODE_ENV = 'test';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns bypass indicator and skips Redis storage for test phone on request-otp', async () => {
    const response = await request(createApp())
      .post('/api/custom-otp/request-otp')
      .send({ phone: '+5521102938475' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.otpBypassEnabled).toBe(true);
    expect(response.body.verificationId).toMatch(/^vid_/);
    expect(response.body.customToken).toBe('custom-token');
    expect(mockRedisSet).not.toHaveBeenCalled();
    expect(mockSendOtp).not.toHaveBeenCalled();
  });

  it('stores only an HMAC of the simulated OTP outside production', async () => {
    const response = await request(createApp())
      .post('/api/custom-otp/request-otp')
      .send({ phone: '+5521999999999' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, otpBypassEnabled: false, channel: 'simulation', expiresIn: 300 });
    expect(response.body.verificationId).toMatch(/^vid_[a-f0-9]{32}$/);
    const challengeCall = mockRedisSet.mock.calls.find(([key]) => key.startsWith('otp:challenge:'));
    expect(challengeCall.slice(2)).toEqual(['EX', 300]);
    const stored = JSON.parse(challengeCall[1]);
    expect(stored).toEqual({ phone: '+5521999999999', codeHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(challengeCall[1]).not.toMatch(/"\d{6}"/);
    expect(mockSendOtp).not.toHaveBeenCalled();
  });

  it('blocks OTP request for non-test phones in production without a configured provider', async () => {
    process.env.NODE_ENV = 'production';

    const response = await request(createApp())
      .post('/api/custom-otp/request-otp')
      .send({ phone: '+5521999999999' });

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ success: false, code: 'OTP_PROVIDER_NOT_CONFIGURED' });
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('keeps production blocked when WhatsApp lacks a dedicated HMAC key', async () => {
    enableWhatsApp();
    delete process.env.AUTH_OTP_HMAC_KEY;
    process.env.NODE_ENV = 'production';

    const response = await request(createApp())
      .post('/api/custom-otp/request-otp')
      .send({ phone: '+5521999999999' });

    expect(response.status).toBe(503);
    expect(mockSendOtp).not.toHaveBeenCalled();
  });

  it('sends the code through the WhatsApp template in production and verifies it once', async () => {
    enableWhatsApp();
    process.env.NODE_ENV = 'production';
    const app = createApp();

    const sent = await request(app).post('/api/custom-otp/request-otp').send({ phone: '(21) 99999-9999' });
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ success: true, channel: 'whatsapp', expiresIn: 300 });
    expect(mockSendOtp).toHaveBeenCalledWith({
      phoneNumber: '+5521999999999',
      otp: expect.stringMatching(/^\d{6}$/),
      verificationId: sent.body.verificationId
    });

    const body = { phone: '+5521999999999', verificationId: sent.body.verificationId, otp: sentCode() };
    const verified = await request(app).post('/api/custom-otp/verify-otp').send(body);
    expect(verified.status).toBe(200);
    expect(verified.body).toEqual({ success: true, customToken: 'custom-token' });

    const reused = await request(app).post('/api/custom-otp/verify-otp').send(body);
    expect(reused.status).toBe(400);
    expect(reused.body.code).toBe('OTP_EXPIRED');
  });

  it('frees the cooldown and returns a delivery error when Meta rejects the send', async () => {
    enableWhatsApp();
    mockSendOtp.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'WHATSAPP_OTP_DELIVERY_FAILED' }));
    const app = createApp();

    const failed = await request(app).post('/api/custom-otp/request-otp').send({ phone: '+5521999999999' });
    expect(failed.status).toBe(502);
    expect(failed.body.code).toBe('WHATSAPP_OTP_DELIVERY_FAILED');
    expect([...mockStore.keys()].some((key) => key.startsWith('otp:challenge:'))).toBe(false);

    const retry = await request(app).post('/api/custom-otp/request-otp').send({ phone: '+5521999999999' });
    expect(retry.status).toBe(200);
  });

  it('enforces a resend cooldown and an hourly limit per phone', async () => {
    enableWhatsApp();
    const app = createApp();

    await request(app).post('/api/custom-otp/request-otp').send({ phone: '+5521999999999' });
    const tooSoon = await request(app).post('/api/custom-otp/request-otp').send({ phone: '+5521999999999' });
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body).toMatchObject({ code: 'OTP_RESEND_COOLDOWN', retryAfterSeconds: 30 });

    for (let i = 0; i < 4; i += 1) {
      mockStore.delete('otp:cooldown:5521999999999');
      const ok = await request(app).post('/api/custom-otp/request-otp').send({ phone: '+5521999999999' });
      expect(ok.status).toBe(200);
    }
    mockStore.delete('otp:cooldown:5521999999999');
    const overLimit = await request(app).post('/api/custom-otp/request-otp').send({ phone: '+5521999999999' });
    expect(overLimit.status).toBe(429);
    expect(overLimit.body.code).toBe('OTP_SEND_LIMIT');
    expect(mockSendOtp).toHaveBeenCalledTimes(5);
  });

  it('invalidates the challenge after five wrong codes', async () => {
    enableWhatsApp();
    const app = createApp();
    const sent = await request(app).post('/api/custom-otp/request-otp').send({ phone: '+5521999999999' });
    const code = sentCode();
    const wrong = code === '000000' ? '111111' : '000000';
    const attempt = (otp) => request(app).post('/api/custom-otp/verify-otp')
      .send({ phone: '+5521999999999', verificationId: sent.body.verificationId, otp });

    for (let i = 1; i <= 5; i += 1) {
      const response = await attempt(wrong);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'OTP_INVALID', attemptsRemaining: 5 - i });
    }
    const locked = await attempt(wrong);
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('OTP_TOO_MANY_ATTEMPTS');

    const late = await attempt(code);
    expect(late.status).toBe(400);
    expect(late.body.code).toBe('OTP_EXPIRED');
    expect(mockCreateCustomToken).not.toHaveBeenCalled();
  });

  it('rejects a valid code presented for another phone number', async () => {
    enableWhatsApp();
    const app = createApp();
    const sent = await request(app).post('/api/custom-otp/request-otp').send({ phone: '+5521999999999' });

    const response = await request(app).post('/api/custom-otp/verify-otp')
      .send({ phone: '+5521988887777', verificationId: sent.body.verificationId, otp: sentCode() });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('OTP_INVALID');
  });

  it('treats an expired challenge as expired', async () => {
    enableWhatsApp();
    const app = createApp();
    const sent = await request(app).post('/api/custom-otp/request-otp').send({ phone: '+5521999999999' });
    mockStore.delete(`otp:challenge:${sent.body.verificationId}`);

    const response = await request(app).post('/api/custom-otp/verify-otp')
      .send({ phone: '+5521999999999', verificationId: sent.body.verificationId, otp: sentCode() });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('OTP_EXPIRED');
  });

  it('accepts static bypass OTP for configured test phones in verify-otp', async () => {
    const response = await request(createApp())
      .post('/api/custom-otp/verify-otp')
      .send({ phone: '+5521123456789', verificationId: 'vid_test', otp: '992000' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, customToken: 'custom-token' });
    expect(mockCreateCustomToken).toHaveBeenCalledWith('test_uid');
    expect(mockRedisGet).not.toHaveBeenCalled();
  });

  it('accepts static bypass OTP for test phones even without verificationId', async () => {
    const response = await request(createApp())
      .post('/api/custom-otp/verify-otp')
      .send({ phone: '+5521102938475', otp: '992111' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, customToken: 'custom-token' });
    expect(mockCreateCustomToken).toHaveBeenCalledWith('test_uid');
    expect(mockRedisGet).not.toHaveBeenCalled();
  });

  it('rejects static bypass OTP for non-test phones when APP_REVIEW is disabled', async () => {
    const response = await request(createApp())
      .post('/api/custom-otp/verify-otp')
      .send({ phone: '+5521999999999', verificationId: 'vid_non_test', otp: '992111' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('OTP_EXPIRED');
    expect(mockCreateCustomToken).not.toHaveBeenCalled();
  });

  it('blocks OTP verification for non-test phones in production without a configured provider', async () => {
    process.env.NODE_ENV = 'production';

    const response = await request(createApp())
      .post('/api/custom-otp/verify-otp')
      .send({ phone: '+5521999999999', verificationId: 'vid_prod', otp: '123456' });

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ success: false, code: 'OTP_PROVIDER_NOT_CONFIGURED' });
    expect(mockRedisGet).not.toHaveBeenCalled();
  });
});
