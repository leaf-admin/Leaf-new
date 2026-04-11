process.env.AUTH_PASSWORD_BCRYPT_ROUNDS = '4';
process.env.JWT_SECRET = 'test-secret';

jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockVerifyIdToken = jest.fn();
const mockCreateCustomToken = jest.fn();
const mockDocs = new Map();

jest.mock('firebase-admin', () => ({
  auth: jest.fn(() => ({
    verifyIdToken: mockVerifyIdToken,
    createCustomToken: mockCreateCustomToken
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
  }))
}));

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(true),
  getConnection: jest.fn(() => ({
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1)
  }))
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const admin = require('firebase-admin');
const firebaseConfig = require('../../../firebase-config');
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

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth/password', passwordRoutes);
  return app;
}

describe('auth-password routes', () => {
  beforeEach(() => {
    mockDocs.clear();
    mockVerifyIdToken.mockReset();
    mockCreateCustomToken.mockReset();
    mockCreateCustomToken.mockResolvedValue('custom-token');
    admin.auth = jest.fn(() => ({
      verifyIdToken: mockVerifyIdToken,
      createCustomToken: mockCreateCustomToken
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
});
