process.env.AUTH_TEST_OTP_BYPASS_ENABLED = 'true';
delete process.env.AUTH_TEST_OTP_BYPASS_PHONES;
delete process.env.AUTH_TEST_OTP_BYPASS_CODE;
process.env.APP_REVIEW = 'false';

jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockRedisSet = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisDel = jest.fn();

const mockGetUserByPhoneNumber = jest.fn();
const mockCreateUser = jest.fn();
const mockCreateCustomToken = jest.fn();

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
    del: mockRedisDel
  }))
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

const otpRoutes = require('../../../routes/auth-otp');
const whatsappOtpService = require('../../../services/whatsapp-otp-service');
const originalNodeEnv = process.env.NODE_ENV;
const originalOtpProviderEnv = process.env.AUTH_OTP_PROVIDER;
const originalOtpSimulationEnv = process.env.AUTH_OTP_SIMULATION_ENABLED;
const originalOtpHmacEnv = process.env.AUTH_OTP_HMAC_KEY;
const originalMetaTokenEnv = process.env.WHATSAPP_META_ACCESS_TOKEN;
const originalMetaPhoneIdEnv = process.env.WHATSAPP_META_PHONE_NUMBER_ID;
const originalTemplateNameEnv = process.env.WHATSAPP_OTP_TEMPLATE_NAME;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/custom-otp', otpRoutes);
  return app;
}

describe('auth-otp routes', () => {
  beforeEach(() => {
    mockRedisSet.mockReset();
    mockRedisGet.mockReset();
    mockRedisDel.mockReset();
    mockGetUserByPhoneNumber.mockReset();
    mockCreateUser.mockReset();
    mockCreateCustomToken.mockReset();
    mockCreateCustomToken.mockResolvedValue('custom-token');
    mockGetUserByPhoneNumber.mockResolvedValue({ uid: 'test_uid' });
    process.env.NODE_ENV = 'test';
    delete process.env.AUTH_OTP_PROVIDER;
    delete process.env.AUTH_OTP_SIMULATION_ENABLED;
    delete process.env.WHATSAPP_META_ACCESS_TOKEN;
    delete process.env.WHATSAPP_META_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_OTP_TEMPLATE_NAME;
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalOtpProviderEnv === undefined) delete process.env.AUTH_OTP_PROVIDER;
    else process.env.AUTH_OTP_PROVIDER = originalOtpProviderEnv;
    if (originalOtpSimulationEnv === undefined) delete process.env.AUTH_OTP_SIMULATION_ENABLED;
    else process.env.AUTH_OTP_SIMULATION_ENABLED = originalOtpSimulationEnv;
    if (originalOtpHmacEnv === undefined) delete process.env.AUTH_OTP_HMAC_KEY;
    else process.env.AUTH_OTP_HMAC_KEY = originalOtpHmacEnv;
    if (originalMetaTokenEnv === undefined) delete process.env.WHATSAPP_META_ACCESS_TOKEN;
    else process.env.WHATSAPP_META_ACCESS_TOKEN = originalMetaTokenEnv;
    if (originalMetaPhoneIdEnv === undefined) delete process.env.WHATSAPP_META_PHONE_NUMBER_ID;
    else process.env.WHATSAPP_META_PHONE_NUMBER_ID = originalMetaPhoneIdEnv;
    if (originalTemplateNameEnv === undefined) delete process.env.WHATSAPP_OTP_TEMPLATE_NAME;
    else process.env.WHATSAPP_OTP_TEMPLATE_NAME = originalTemplateNameEnv;
  });

  it('returns bypass indicator and skips Redis storage for test phone on request-otp', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/custom-otp/request-otp')
      .send({ phone: '+5521102938475' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.otpBypassEnabled).toBe(true);
    expect(response.body.channel).toBe('test_bypass');
    expect(response.body.verificationId).toMatch(/^vid_/);
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('stores OTP in Redis for non-test phones on request-otp', async () => {
    const app = createApp();
    mockRedisSet.mockResolvedValue('OK');

    const response = await request(app)
      .post('/api/custom-otp/request-otp')
      .send({ phone: '+5521999999999' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.otpBypassEnabled).toBe(false);
    expect(response.body.verificationId).toMatch(/^vid_/);
    expect(mockRedisSet.mock.calls.length).toBeGreaterThanOrEqual(1);
    const storedOtpValues = mockRedisSet.mock.calls.map((call) => call[1]);
    expect(storedOtpValues.every((value) => /^[a-f0-9]{64}$/.test(String(value)))).toBe(true);
    expect(storedOtpValues.some((value) => /^\d{6}$/.test(String(value)))).toBe(false);
  });

  it('delivers a non-test OTP through WhatsApp and never returns the code', async () => {
    process.env.AUTH_OTP_PROVIDER = 'whatsapp';
    process.env.AUTH_OTP_HMAC_KEY = 'unit-test-auth-otp-hmac-key-with-32-bytes';
    process.env.WHATSAPP_META_ACCESS_TOKEN = 'unit-test-meta-access-token';
    process.env.WHATSAPP_META_PHONE_NUMBER_ID = '123456789012345';
    process.env.WHATSAPP_OTP_TEMPLATE_NAME = 'leaf_authentication';
    mockRedisSet.mockResolvedValue('OK');
    const sendOtp = jest.spyOn(whatsappOtpService, 'sendOtp').mockResolvedValue({
      provider: 'whatsapp',
      messageId: 'wamid.unit'
    });
    const app = createApp();

    const response = await request(app)
      .post('/api/custom-otp/request-otp')
      .send({ phone: '+5521999999999' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      channel: 'whatsapp',
      expiresIn: 300
    });
    expect(response.body.otp).toBeUndefined();
    expect(sendOtp).toHaveBeenCalledWith(expect.objectContaining({
      phoneNumber: '+5521999999999',
      verificationId: response.body.verificationId,
      otp: expect.stringMatching(/^\d{6}$/)
    }));
    expect(mockRedisSet.mock.calls.every((call) => /^[a-f0-9]{64}$/.test(String(call[1])))).toBe(true);
  });

  it('removes a stored challenge when WhatsApp delivery fails', async () => {
    process.env.AUTH_OTP_PROVIDER = 'whatsapp';
    process.env.AUTH_OTP_HMAC_KEY = 'unit-test-auth-otp-hmac-key-with-32-bytes';
    process.env.WHATSAPP_META_ACCESS_TOKEN = 'unit-test-meta-access-token';
    process.env.WHATSAPP_META_PHONE_NUMBER_ID = '123456789012345';
    process.env.WHATSAPP_OTP_TEMPLATE_NAME = 'leaf_authentication';
    mockRedisSet.mockResolvedValue('OK');
    mockRedisDel.mockResolvedValue(1);
    jest.spyOn(whatsappOtpService, 'sendOtp').mockRejectedValue(
      Object.assign(new Error('provider unavailable'), { code: 'WHATSAPP_OTP_DELIVERY_FAILED' })
    );
    const app = createApp();

    const response = await request(app)
      .post('/api/custom-otp/request-otp')
      .send({ phone: '+5521999999999' });

    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({ success: false, code: 'OTP_DELIVERY_FAILED' });
    expect(mockRedisDel).toHaveBeenCalled();
  });

  it('blocks simulated OTP request for non-test phones in production', async () => {
    process.env.NODE_ENV = 'production';
    const app = createApp();

    const response = await request(app)
      .post('/api/custom-otp/request-otp')
      .send({ phone: '+5521999999999' });

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      code: 'OTP_PROVIDER_NOT_CONFIGURED'
    });
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('fails closed when production WhatsApp is configured without the dedicated HMAC key', async () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_OTP_PROVIDER = 'whatsapp';
    delete process.env.AUTH_OTP_HMAC_KEY;
    process.env.WHATSAPP_META_ACCESS_TOKEN = 'unit-test-meta-access-token';
    process.env.WHATSAPP_META_PHONE_NUMBER_ID = '123456789012345';
    process.env.WHATSAPP_OTP_TEMPLATE_NAME = 'leaf_authentication';
    const app = createApp();

    const response = await request(app)
      .post('/api/custom-otp/request-otp')
      .send({ phone: '+5521999999999' });

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      code: 'OTP_SECURITY_NOT_CONFIGURED'
    });
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('accepts static bypass OTP for configured test phones in verify-otp', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/custom-otp/verify-otp')
      .send({
        phone: '+5521123456789',
        verificationId: 'vid_test',
        otp: '992000'
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      customToken: 'custom-token'
    });
    expect(mockCreateCustomToken).toHaveBeenCalledWith('test_uid');
    expect(mockRedisGet).not.toHaveBeenCalled();
  });

  it('accepts static bypass OTP for test phones even without verificationId', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/custom-otp/verify-otp')
      .send({
        phone: '+5521102938475',
        otp: '992111'
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      customToken: 'custom-token'
    });
    expect(mockCreateCustomToken).toHaveBeenCalledWith('test_uid');
    expect(mockRedisGet).not.toHaveBeenCalled();
  });

  it('rejects static bypass OTP for non-test phones when APP_REVIEW is disabled', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/custom-otp/verify-otp')
      .send({
        phone: '+5521999999999',
        verificationId: 'vid_non_test',
        otp: '992111'
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid or expired OTP');
  });

  it('blocks simulated OTP verification for non-test phones in production', async () => {
    process.env.NODE_ENV = 'production';
    const app = createApp();
    mockRedisGet.mockResolvedValue('123456');

    const response = await request(app)
      .post('/api/custom-otp/verify-otp')
      .send({
        phone: '+5521999999999',
        verificationId: 'vid_prod',
        otp: '123456'
      });

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      code: 'OTP_PROVIDER_NOT_CONFIGURED'
    });
    expect(mockRedisGet).not.toHaveBeenCalled();
  });
});
