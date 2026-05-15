process.env.AUTH_PASSWORD_BCRYPT_ROUNDS = '4';
process.env.JWT_SECRET = 'test-secret';
process.env.AUTH_TEST_OTP_BYPASS_ENABLED = 'true';
delete process.env.AUTH_TEST_OTP_BYPASS_PHONES;
delete process.env.AUTH_TEST_OTP_BYPASS_CODE;
process.env.APP_REVIEW = 'false';

jest.unmock('express');

const express = require('express');
const request = require('supertest');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const mockVerifyIdToken = jest.fn();
const mockCreateCustomToken = jest.fn();
const mockGetUserByPhoneNumber = jest.fn();
const mockDocs = new Map();
const mockRealtimeUsers = new Map();
const mockRedisSet = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisDel = jest.fn();

jest.mock('firebase-admin', () => ({
  auth: jest.fn(() => ({
    verifyIdToken: mockVerifyIdToken,
    createCustomToken: mockCreateCustomToken,
    getUserByPhoneNumber: mockGetUserByPhoneNumber
  })),
  firestore: {
    FieldValue: {
      serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP')
    },
    Timestamp: {
      fromDate: jest.fn((date) => ({
        toDate: () => date,
        toISOString: () => date.toISOString()
      }))
    }
  }
}));

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => ({
    collection: jest.fn(() => ({
      doc: jest.fn((id) => ({
        get: jest.fn(async () => ({
          exists: mockDocs.has(id),
          data: () => mockDocs.get(id)
        })),
        set: jest.fn(async (payload, options = {}) => {
          const previous = options.merge ? (mockDocs.get(id) || {}) : {};
          mockDocs.set(id, { ...previous, ...payload });
        })
      }))
    }))
  })),
  getRealtimeDB: jest.fn(() => ({
    ref: jest.fn((path) => ({
      once: jest.fn(async () => {
        const uid = String(path || '').replace(/^users\//, '');
        const value = mockRealtimeUsers.get(uid);
        return {
          exists: () => value !== undefined,
          val: () => value
        };
      }),
      set: jest.fn(async (payload) => {
        const uid = String(path || '').replace(/^users\//, '');
        mockRealtimeUsers.set(uid, payload);
      }),
      update: jest.fn(async (payload) => {
        const uid = String(path || '').replace(/^users\//, '');
        const previous = mockRealtimeUsers.get(uid) || {};
        mockRealtimeUsers.set(uid, { ...previous, ...payload });
      })
    }))
  }))
}));

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(true),
  getConnection: jest.fn(() => ({
    set: mockRedisSet,
    get: mockRedisGet,
    del: mockRedisDel
  }))
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const admin = require('firebase-admin');
const firebaseConfig = require('../../../firebase-config');
const redisPool = require('../../../utils/redis-pool');
const passwordRoutes = require('../../../routes/auth-password');

function createFirestoreMock() {
  return {
    collection: jest.fn(() => ({
      doc: jest.fn((id) => ({
        get: jest.fn(async () => ({
          exists: mockDocs.has(id),
          data: () => mockDocs.get(id)
        })),
        set: jest.fn(async (payload, options = {}) => {
          const previous = options.merge ? (mockDocs.get(id) || {}) : {};
          mockDocs.set(id, { ...previous, ...payload });
        })
      }))
    }))
  };
}

function createRealtimeDBMock() {
  return {
    ref: jest.fn((path) => ({
      once: jest.fn(async () => {
        const uid = String(path || '').replace(/^users\//, '');
        const value = mockRealtimeUsers.get(uid);
        return {
          exists: () => value !== undefined,
          val: () => value
        };
      }),
      set: jest.fn(async (payload) => {
        const uid = String(path || '').replace(/^users\//, '');
        mockRealtimeUsers.set(uid, payload);
      }),
      update: jest.fn(async (payload) => {
        const uid = String(path || '').replace(/^users\//, '');
        const previous = mockRealtimeUsers.get(uid) || {};
        mockRealtimeUsers.set(uid, { ...previous, ...payload });
      })
    }))
  };
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth/password', passwordRoutes);
  return app;
}

function hashPhoneForTest(phoneDigits) {
  const pepper = process.env.AUTH_PASSWORD_PHONE_HASH_PEPPER || process.env.JWT_SECRET || 'leaf-phone-hash';
  return crypto.createHmac('sha256', pepper).update(String(phoneDigits || '')).digest('hex');
}

describe('auth-password routes', () => {
  beforeEach(() => {
    mockDocs.clear();
    mockRealtimeUsers.clear();
    mockVerifyIdToken.mockReset();
    mockCreateCustomToken.mockReset();
    mockGetUserByPhoneNumber.mockReset();
    mockRedisSet.mockReset();
    mockRedisGet.mockReset();
    mockRedisDel.mockReset();
    redisPool.ensureConnection.mockReset();
    redisPool.ensureConnection.mockResolvedValue(true);
    mockRedisSet.mockResolvedValue('OK');
    mockRedisGet.mockResolvedValue(null);
    mockRedisDel.mockResolvedValue(1);
    mockCreateCustomToken.mockResolvedValue('custom-token');
    mockGetUserByPhoneNumber.mockRejectedValue(Object.assign(new Error('User not found'), { code: 'auth/user-not-found' }));
    admin.auth = jest.fn(() => ({
      verifyIdToken: mockVerifyIdToken,
      createCustomToken: mockCreateCustomToken,
      getUserByPhoneNumber: mockGetUserByPhoneNumber
    }));
    admin.firestore = {
      FieldValue: {
        serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP')
      },
      Timestamp: {
        fromDate: jest.fn((date) => ({
          toDate: () => date,
          toISOString: () => date.toISOString()
        }))
      }
    };
    firebaseConfig.getFirestore.mockImplementation(() => createFirestoreMock());
    firebaseConfig.getRealtimeDB.mockImplementation(() => createRealtimeDBMock());
  });

  it('rejects password setup without Firebase auth', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/auth/password/setup')
      .send({ phone: '+5521998991886', password: 'Leaf1234' });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it('sets password after OTP-authenticated Firebase user and logs in with custom token', async () => {
    const app = createApp();
    mockVerifyIdToken.mockResolvedValue({
      uid: 'customer_1',
      phone_number: '+5521998991886'
    });

    const setupResponse = await request(app)
      .post('/api/auth/password/setup')
      .set('Authorization', 'Bearer firebase-id-token')
      .send({ phone: '+5521998991886', password: 'Leaf1234' });

    expect(setupResponse.status).toBe(200);
    expect(setupResponse.body.success).toBe(true);

    const badLoginResponse = await request(app)
      .post('/api/auth/password/login')
      .send({ phone: '+5521998991886', password: 'Wrong1234' });

    expect(badLoginResponse.status).toBe(401);
    expect(badLoginResponse.body.success).toBe(false);

    const loginResponse = await request(app)
      .post('/api/auth/password/login')
      .send({ phone: '+5521998991886', password: 'Leaf1234' });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body).toEqual({
      success: true,
      customToken: 'custom-token',
      uid: 'customer_1',
      userType: 'customer'
    });
    expect(mockCreateCustomToken).toHaveBeenCalledWith('customer_1', {
      userType: 'customer',
      authMethod: 'phone_password'
    });
  });

  it('preserves driver role on password login when credential is driver', async () => {
    const app = createApp();
    mockVerifyIdToken.mockResolvedValue({
      uid: 'driver_1',
      phone_number: '+5521998776655',
      userType: 'driver'
    });

    const setupResponse = await request(app)
      .post('/api/auth/password/setup')
      .set('Authorization', 'Bearer firebase-id-token')
      .send({ phone: '+5521998776655', password: 'Leaf1234', userType: 'driver' });

    expect(setupResponse.status).toBe(200);
    expect(setupResponse.body.success).toBe(true);

    const loginResponse = await request(app)
      .post('/api/auth/password/login')
      .send({ phone: '+5521998776655', password: 'Leaf1234' });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body).toEqual({
      success: true,
      customToken: 'custom-token',
      uid: 'driver_1',
      userType: 'driver'
    });
    expect(mockCreateCustomToken).toHaveBeenCalledWith('driver_1', {
      userType: 'driver',
      authMethod: 'phone_password'
    });
  });

  it('resolves existing phone with password credential to OTP-first flow with password fallback', async () => {
    const app = createApp();
    const phoneDigits = '21998991886';
    const phoneHash = hashPhoneForTest(phoneDigits);

    mockDocs.set(phoneHash, {
      uid: 'customer_with_password',
      userType: 'customer',
      passwordHash: 'hash_value'
    });
    mockRealtimeUsers.set('customer_with_password', {
      userType: 'customer'
    });

    const response = await request(app)
      .post('/api/auth/password/resolve-phone')
      .send({ phone: '+5521998991886' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      exists: true,
      hasPassword: true,
      nextAction: 'OTP_REQUIRED',
      passwordFallbackAvailable: true,
      requiresPassword: false,
      requiresOtp: true,
      uid: 'customer_with_password',
      userType: 'customer',
      source: 'password_credentials'
    });
  });

  it('resolves existing Firebase Auth phone without password credential to OTP flow', async () => {
    const app = createApp();
    mockGetUserByPhoneNumber.mockResolvedValue({
      uid: 'legacy_customer_no_password'
    });
    mockRealtimeUsers.set('legacy_customer_no_password', {
      userType: 'customer'
    });

    const response = await request(app)
      .post('/api/auth/password/resolve-phone')
      .send({ phone: '21997776655' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      exists: true,
      hasPassword: false,
      nextAction: 'OTP_REQUIRED',
      passwordFallbackAvailable: false,
      requiresPassword: false,
      requiresOtp: true,
      uid: 'legacy_customer_no_password',
      userType: 'customer',
      source: 'firebase_auth'
    });
  });

  it('forces OTP flow when password credential document exists but has no passwordHash', async () => {
    const app = createApp();
    const phoneDigits = '21123456789';
    const phoneHash = hashPhoneForTest(phoneDigits);

    mockDocs.set(phoneHash, {
      uid: 'legacy_customer_without_password_hash',
      userType: 'customer'
    });
    mockRealtimeUsers.set('legacy_customer_without_password_hash', {
      userType: 'customer'
    });

    const response = await request(app)
      .post('/api/auth/password/resolve-phone')
      .send({ phone: phoneDigits });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      exists: true,
      hasPassword: false,
      nextAction: 'OTP_REQUIRED',
      passwordFallbackAvailable: false,
      requiresPassword: false,
      requiresOtp: true,
      uid: 'legacy_customer_without_password_hash',
      userType: 'customer',
      source: 'password_credentials'
    });
  });

  it('resolves unknown phone to OTP flow', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/auth/password/resolve-phone')
      .send({ phone: '21990001111' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      exists: false,
      hasPassword: false,
      nextAction: 'OTP_REQUIRED',
      passwordFallbackAvailable: false,
      requiresPassword: false,
      requiresOtp: true,
      uid: null,
      userType: null,
      source: 'none'
    });
  });

  it('allows password reset request for legacy Firebase Auth users without password credential', async () => {
    const app = createApp();
    const phoneDigits = '21996665555';
    const phoneHash = hashPhoneForTest(phoneDigits);

    mockGetUserByPhoneNumber.mockResolvedValue({
      uid: 'legacy_uid_without_password',
      customClaims: { userType: 'customer' }
    });
    mockRealtimeUsers.set('legacy_uid_without_password', {
      userType: 'customer'
    });

    const response = await request(app)
      .post('/api/auth/password/reset/request')
      .send({ phone: phoneDigits });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.verificationId).toBeTruthy();
    expect(mockDocs.get(phoneHash)?.uid).toBe('legacy_uid_without_password');
    expect(mockDocs.get(phoneHash)?.userType).toBe('customer');
  });

  it('does not require Redis connection for reset request on test phones', async () => {
    const app = createApp();
    const phoneDigits = '21102938475';
    const phoneHash = hashPhoneForTest(phoneDigits);

    mockDocs.set(phoneHash, {
      uid: 'customer_test',
      userType: 'customer',
      passwordHash: 'old_hash'
    });

    redisPool.ensureConnection.mockRejectedValue(new Error('redis_down'));

    const response = await request(app)
      .post('/api/auth/password/reset/request')
      .send({ phone: phoneDigits });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.otpBypassEnabled).toBe(true);
    expect(redisPool.ensureConnection).not.toHaveBeenCalled();
  });

  it('requires Redis connection for reset request on non-test phones', async () => {
    const app = createApp();
    const phoneDigits = '21999999999';
    const phoneHash = hashPhoneForTest(phoneDigits);

    mockDocs.set(phoneHash, {
      uid: 'customer_non_test',
      userType: 'customer',
      passwordHash: 'old_hash'
    });

    const response = await request(app)
      .post('/api/auth/password/reset/request')
      .send({ phone: phoneDigits });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.otpBypassEnabled).toBe(false);
    expect(redisPool.ensureConnection).toHaveBeenCalledTimes(1);
  });

  it('accepts static reset OTP for configured test phones even when APP_REVIEW is false', async () => {
    const app = createApp();
    const phoneDigits = '21102938475';
    const phoneHash = hashPhoneForTest(phoneDigits);

    mockDocs.set(phoneHash, {
      uid: 'customer_test',
      userType: 'customer',
      passwordHash: 'old_hash'
    });

    const response = await request(app)
      .post('/api/auth/password/reset/confirm')
      .send({
        phone: phoneDigits,
        verificationId: 'pwd_test',
        otp: '992111',
        password: 'Leaf5678',
        confirmPassword: 'Leaf5678'
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(redisPool.ensureConnection).not.toHaveBeenCalled();
  });

  it('accepts static reset OTP for test phones without verificationId', async () => {
    const app = createApp();
    const phoneDigits = '21123456789';
    const phoneHash = hashPhoneForTest(phoneDigits);

    mockDocs.set(phoneHash, {
      uid: 'driver_test',
      userType: 'driver',
      passwordHash: 'old_hash'
    });

    const response = await request(app)
      .post('/api/auth/password/reset/confirm')
      .send({
        phone: phoneDigits,
        otp: '992000',
        password: 'Leaf5678',
        confirmPassword: 'Leaf5678'
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('rejects static reset OTP for non-test phones when APP_REVIEW is false', async () => {
    const app = createApp();
    const phoneDigits = '21999999999';
    const phoneHash = hashPhoneForTest(phoneDigits);

    mockDocs.set(phoneHash, {
      uid: 'customer_non_test',
      userType: 'customer',
      passwordHash: 'old_hash'
    });

    const response = await request(app)
      .post('/api/auth/password/reset/confirm')
      .send({
        phone: phoneDigits,
        verificationId: 'pwd_non_test',
        otp: '992111',
        password: 'Leaf5678',
        confirmPassword: 'Leaf5678'
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('OTP inválido ou expirado');
  });

  it('does not enforce password lockout for configured review/test phones', async () => {
    const app = createApp();
    const phoneDigits = '21102938475';
    const phoneHash = hashPhoneForTest(phoneDigits);
    const passwordHash = await bcrypt.hash('Leaf1234', 4);
    const oneHourAhead = new Date(Date.now() + 60 * 60 * 1000);

    mockDocs.set(phoneHash, {
      uid: 'review_passenger_uid',
      userType: 'customer',
      passwordHash,
      failedAttempts: 9,
      lockedUntil: {
        toDate: () => oneHourAhead
      }
    });

    const response = await request(app)
      .post('/api/auth/password/login')
      .send({ phone: '+5521102938475', password: 'Leaf1234' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.uid).toBe('review_passenger_uid');
  });

  it('bypasses lockout for review credentials even when OTP bypass env flag is disabled', async () => {
    const app = createApp();
    const previousBypassFlag = process.env.AUTH_TEST_OTP_BYPASS_ENABLED;
    process.env.AUTH_TEST_OTP_BYPASS_ENABLED = 'false';

    try {
      const phoneDigits = '21123456789';
      const phoneHash = hashPhoneForTest(phoneDigits);
      const passwordHash = await bcrypt.hash('Leaf1234', 4);
      const oneHourAhead = new Date(Date.now() + 60 * 60 * 1000);

      mockDocs.set(phoneHash, {
        uid: 'review_driver_uid',
        userType: 'driver',
        passwordHash,
        failedAttempts: 12,
        lockedUntil: {
          toDate: () => oneHourAhead
        }
      });

      const response = await request(app)
        .post('/api/auth/password/login')
        .send({ phone: '+5521123456789', password: 'Leaf1234' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.uid).toBe('review_driver_uid');
    } finally {
      process.env.AUTH_TEST_OTP_BYPASS_ENABLED = previousBypassFlag;
    }
  });
});
