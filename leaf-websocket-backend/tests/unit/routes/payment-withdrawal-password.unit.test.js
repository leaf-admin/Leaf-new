process.env.JWT_SECRET = 'test-secret';
process.env.AUTH_PASSWORD_BCRYPT_ROUNDS = '4';

jest.unmock('express');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const mockVerifyIdToken = jest.fn();
const mockGetUser = jest.fn();
const mockDocs = new Map();
const mockRequestDriverWithdrawal = jest.fn();
const mockRecordDriverWithdrawalDenial = jest.fn();
const mockEvaluateWithdrawalStepUp = jest.fn();

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function hashPhone(phoneDigits) {
  const pepper = process.env.AUTH_PASSWORD_PHONE_HASH_PEPPER || process.env.JWT_SECRET || 'leaf-phone-hash';
  return crypto.createHmac('sha256', pepper).update(String(phoneDigits || '')).digest('hex');
}

function mockCreateDocumentRef(id) {
  return {
    get: jest.fn(async () => ({
      exists: mockDocs.has(id),
      data: () => mockDocs.get(id)
    })),
    set: jest.fn(async (payload, options = {}) => {
      const previous = options.merge ? (mockDocs.get(id) || {}) : {};
      mockDocs.set(id, { ...previous, ...payload });
    })
  };
}

jest.mock('firebase-admin', () => ({
  auth: jest.fn(() => ({
    verifyIdToken: mockVerifyIdToken,
    getUser: mockGetUser
  })),
  firestore: {
    FieldValue: {
      serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
      increment: jest.fn((value) => ({ __increment: value }))
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
      doc: jest.fn((id) => mockCreateDocumentRef(id))
    }))
  }))
}));

jest.mock('../../../services/payment-service', () => jest.fn().mockImplementation(() => ({
  requestDriverWithdrawal: mockRequestDriverWithdrawal,
  recordDriverWithdrawalDenial: mockRecordDriverWithdrawalDenial
})));

jest.mock('../../../services/kyc-policy-service', () => ({
  evaluateWithdrawalStepUp: mockEvaluateWithdrawalStepUp,
  getConfig: jest.fn(() => ({ verificationMaxAgeHours: 24 }))
}));

jest.mock('../../../utils/pilot-launch-flags', () => ({
  isLaunchFeatureEnabled: jest.fn(() => true),
  buildLaunchFeatureDisabledPayload: jest.fn((feature, message) => ({
    success: false,
    error: message,
    code: 'FEATURE_DISABLED_IN_LAUNCH_PROFILE'
  }))
}));

jest.mock('../../../utils/jwt-secret-resolver', () => ({
  resolveJwtSecret: jest.fn(() => 'test-secret')
}));

jest.mock('../../../utils/admin-user-cache', () => ({
  getAdminUser: jest.fn()
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const admin = require('firebase-admin');
const paymentRoutes = require('../../../routes/payment');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', paymentRoutes);
  return app;
}

async function seedAppPassword({ phone = '+5521998991886', uid = 'driver-1', password = 'Leaf1234' } = {}) {
  const phoneDigits = normalizePhone(phone);
  const passwordHash = await bcrypt.hash(password, 4);
  mockDocs.set(hashPhone(phoneDigits), {
    uid,
    phoneHash: hashPhone(phoneDigits),
    phoneLast4: phoneDigits.slice(-4),
    passwordHash,
    failedAttempts: 0,
    lockedUntil: null
  });
  return phoneDigits;
}

describe('payment withdrawal password guard', () => {
  beforeEach(() => {
    mockDocs.clear();
    mockVerifyIdToken.mockReset();
    mockGetUser.mockReset();
    mockRequestDriverWithdrawal.mockReset();
    mockRecordDriverWithdrawalDenial.mockReset();
    mockEvaluateWithdrawalStepUp.mockReset();

    admin.auth = jest.fn(() => ({
      verifyIdToken: mockVerifyIdToken,
      getUser: mockGetUser
    }));

    mockVerifyIdToken.mockResolvedValue({
      uid: 'driver-1',
      phone_number: '+5521998991886'
    });
    mockEvaluateWithdrawalStepUp.mockResolvedValue({ requirement: 'NONE' });
    mockRequestDriverWithdrawal.mockResolvedValue({
      success: true,
      withdrawalId: 'withdrawal-1',
      amountCents: 2500,
      newBalance: 75
    });
  });

  it('bloqueia saque sem senha do app antes de avaliar KYC ou processar', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/payment/driver-balance/driver-1/withdraw')
      .set('Authorization', 'Bearer firebase-id-token')
      .send({
        amount: 25,
        pixKey: 'driver@pix.test',
        requestId: 'withdraw-request-1'
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      code: 'WITHDRAWAL_PASSWORD_REQUIRED'
    });
    expect(mockEvaluateWithdrawalStepUp).not.toHaveBeenCalled();
    expect(mockRequestDriverWithdrawal).not.toHaveBeenCalled();
  });

  it('bloqueia saque quando a senha do app esta incorreta', async () => {
    const app = createApp();
    const phoneDigits = await seedAppPassword();

    const response = await request(app)
      .post('/api/payment/driver-balance/driver-1/withdraw')
      .set('Authorization', 'Bearer firebase-id-token')
      .send({
        amount: 25,
        pixKey: 'driver@pix.test',
        appPassword: 'Wrong1234',
        requestId: 'withdraw-request-2'
      });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      code: 'WITHDRAWAL_PASSWORD_INVALID'
    });
    expect(mockDocs.get(hashPhone(phoneDigits)).failedAttempts).toBe(1);
    expect(mockEvaluateWithdrawalStepUp).not.toHaveBeenCalled();
    expect(mockRequestDriverWithdrawal).not.toHaveBeenCalled();
  });

  it('continua o fluxo de saque quando a senha do app confere', async () => {
    const app = createApp();
    await seedAppPassword();

    const response = await request(app)
      .post('/api/payment/driver-balance/driver-1/withdraw')
      .set('Authorization', 'Bearer firebase-id-token')
      .send({
        amount: 25,
        pixKey: 'driver@pix.test',
        appPassword: 'Leaf1234',
        requestId: 'withdraw-request-3'
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      withdrawalId: 'withdrawal-1'
    });
    expect(mockEvaluateWithdrawalStepUp).toHaveBeenCalledWith({
      driverId: 'driver-1',
      amountCents: 2500
    });
    expect(mockRequestDriverWithdrawal).toHaveBeenCalledWith({
      driverId: 'driver-1',
      amountCents: 2500,
      pixKey: 'driver@pix.test',
      requestId: 'withdraw-request-3'
    });
  });
});
