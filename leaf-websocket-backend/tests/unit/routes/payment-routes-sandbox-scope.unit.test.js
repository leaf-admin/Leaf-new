process.env.JWT_SECRET = 'test-secret';

jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockVerifyIdToken = jest.fn();
const mockResolveUserPersistenceScope = jest.fn();
const mockGetPaymentStatus = jest.fn();
const mockProcessAdvancePayment = jest.fn();
const mockBuildAdvancePaymentIntentId = jest.fn();
const mockGetFirestore = jest.fn();
const mockValidateQuoteLock = jest.fn();
const mockValidateQuoteLockPayload = jest.fn();
const mockHasPaymentEligibleDriver = jest.fn();
const mockCollectionReads = [];

jest.mock('firebase-admin', () => ({
  auth: jest.fn(() => ({
    verifyIdToken: mockVerifyIdToken
  })),
  firestore: {
    FieldValue: {
      serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
      increment: jest.fn((value) => ({ __increment: value }))
    },
    Timestamp: {
      fromDate: jest.fn((value) => value)
    }
  }
}));

jest.mock('../../../firebase-config', () => ({
  getFirestore: (...args) => mockGetFirestore(...args)
}));

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn(() => ({}))
}));

jest.mock('../../../services/payment-service', () => jest.fn().mockImplementation(() => ({
  buildAdvancePaymentIntentId: (...args) => mockBuildAdvancePaymentIntentId(...args),
  getPaymentStatus: (...args) => mockGetPaymentStatus(...args),
  processAdvancePayment: (...args) => mockProcessAdvancePayment(...args)
})));

jest.mock('../../../services/payment-runtime-profile-service', () => ({
  listProfiles: jest.fn(),
  upsertProfile: jest.fn(),
  updateProfileStatus: jest.fn(),
  resolveProfile: jest.fn()
}));

jest.mock('../../../services/sandbox-persistence-context', () => {
  const actual = jest.requireActual('../../../services/sandbox-persistence-context');
  return {
    ...actual,
    resolveUserPersistenceScope: (...args) => mockResolveUserPersistenceScope(...args)
  };
});

jest.mock('../../../services/kyc-policy-service', () => ({
  evaluateWithdrawalStepUp: jest.fn(),
  getConfig: jest.fn(() => ({ verificationMaxAgeHours: 24 }))
}));

jest.mock('../../../services/passenger-discount-benefit-service', () => ({
  previewDiscount: jest.fn()
}));

jest.mock('../../../services/payment-driver-availability-guard', () => ({
  buildPaymentAvailabilityInput: jest.fn((payload) => ({
    pickupLocation: payload.pickupLocation || payload.rideDetails?.pickupLocation || null,
    destinationLocation: payload.destinationLocation || payload.rideDetails?.destinationLocation || null,
    preferences: payload.preferences || payload.rideDetails?.preferences || {},
    carType: payload.carType || payload.rideDetails?.carType || null
  })),
  hasPaymentEligibleDriver: (...args) => mockHasPaymentEligibleDriver(...args)
}));

jest.mock('../../../services/quote-lock-service', () => ({
  validateQuoteLock: (...args) => mockValidateQuoteLock(...args),
  validateQuoteLockPayload: (...args) => mockValidateQuoteLockPayload(...args)
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

jest.mock('../../../utils/prometheus-metrics', () => ({
  metrics: {
    recordOperationalEvent: jest.fn()
  }
}));

const { sealFinancialContext } = require('../../../services/financial-runtime-context');
const paymentRoutes = require('../../../routes/payment');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', paymentRoutes);
  return app;
}

function createSandboxScope() {
  const financialContext = sealFinancialContext({
    providerEnvironment: 'sandbox',
    paymentProfileId: 'qa-passenger-sandbox',
    paymentProfileSource: 'test_user_allowlist',
    testUserSandbox: true
  });
  return {
    namespace: 'sandbox',
    classification: 'sandbox_test_user',
    financialContext,
    financialContextId: financialContext.contextId,
    source: 'payment_runtime_profile'
  };
}

function buildPersistenceEnvelope(scope) {
  return {
    financialContext: scope.financialContext,
    financialNamespace: 'sandbox',
    financialContextId: scope.financialContext.contextId,
    providerEnvironment: 'sandbox',
    paymentProfileId: 'qa-passenger-sandbox',
    paymentProfileSource: 'test_user_allowlist',
    testUserSandbox: true
  };
}

describe('payment routes sandbox persistence scope', () => {
  const originalEnv = { ...process.env };
  let sandboxScope;

  beforeEach(() => {
    process.env.LEAF_LAUNCH_PROFILE = 'full';
    delete process.env.LEAF_PILOT_CONTROLLED;
    delete process.env.PILOT_ALLOWED_PASSENGER_IDS;
    delete process.env.LEAF_ACCEPT_NEW_PIX;
    mockCollectionReads.length = 0;
    sandboxScope = createSandboxScope();

    mockVerifyIdToken.mockReset().mockResolvedValue({
      uid: 'qa-passenger',
      phone_number: '+5521999999999'
    });
    mockResolveUserPersistenceScope.mockReset().mockResolvedValue(sandboxScope);
    mockGetPaymentStatus.mockReset().mockResolvedValue({
      success: true,
      status: 'in_holding',
      source: 'payment_holding_doc'
    });
    mockProcessAdvancePayment.mockReset().mockResolvedValue({
      success: true,
      chargeId: 'sandbox-charge',
      qrCode: 'sandbox-qr',
      paymentLink: 'https://sandbox.example/charge'
    });
    mockBuildAdvancePaymentIntentId.mockReset().mockReturnValue('advance_sandbox_ride');
    mockValidateQuoteLock.mockReset().mockResolvedValue({
      success: true,
      quoteLock: {
        quoteLockId: 'quote-lock-1',
        payableAmountInCents: 2750,
        grossAmountInCents: 2750
      },
      payableAmountInCents: 2750,
      grossAmountInCents: 2750
    });
    mockValidateQuoteLockPayload.mockReset();
    mockHasPaymentEligibleDriver.mockReset().mockResolvedValue({
      success: true,
      hasDrivers: true,
      driverId: 'qa-driver',
      reservationId: 'sandbox-reservation',
      reservationExpiresAt: '2026-07-13T15:00:00.000Z',
      reservationTtlSeconds: 180
    });
    mockGetFirestore.mockReset().mockReturnValue(null);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('passes the authenticated sandbox actor sealed scope to payment status', async () => {
    const response = await request(createApp())
      .get('/api/payment/status/sandbox-charge')
      .set('Authorization', 'Bearer sandbox-passenger-token');

    expect(response.status).toBe(200);
    expect(mockResolveUserPersistenceScope).toHaveBeenCalledTimes(1);
    expect(mockResolveUserPersistenceScope).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'qa-passenger',
      phone: '+5521999999999',
      actor: expect.objectContaining({ uid: 'qa-passenger' })
    }));
    expect(mockGetPaymentStatus).toHaveBeenCalledWith(
      'sandbox-charge',
      buildPersistenceEnvelope(sandboxScope)
    );
  });

  it('fails payment status closed before service access when actor classification is unavailable', async () => {
    const classificationError = new Error('profile store unavailable');
    classificationError.code = 'PERSISTENCE_USER_CLASSIFICATION_UNAVAILABLE';
    mockResolveUserPersistenceScope.mockRejectedValue(classificationError);

    const response = await request(createApp())
      .get('/api/payment/status/sandbox-charge')
      .set('Authorization', 'Bearer sandbox-passenger-token');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      code: 'PERSISTENCE_USER_CLASSIFICATION_UNAVAILABLE'
    });
    expect(mockGetPaymentStatus).not.toHaveBeenCalled();
  });

  it('recovers an expired quote only from sandbox payment intents and ignores operational poison', async () => {
    const persistenceEnvelope = buildPersistenceEnvelope(sandboxScope);
    const sandboxIntent = {
      paymentIntentId: 'advance_sandbox_ride',
      rideId: 'sandbox-ride',
      passengerId: 'qa-passenger',
      quoteLockId: 'quote-lock-1',
      quoteLockSnapshot: {
        quoteLockId: 'quote-lock-1',
        payableAmountInCents: 2750,
        grossAmountInCents: 2750
      },
      status: 'charge_created',
      ...persistenceEnvelope
    };
    const operationalPoison = {
      paymentIntentId: 'advance_sandbox_ride',
      rideId: 'sandbox-ride',
      passengerId: 'qa-passenger',
      quoteLockId: 'quote-lock-1',
      quoteLockSnapshot: { quoteLockId: 'quote-lock-1' },
      status: 'charge_created'
    };
    const recordsByCollection = {
      sandbox_payment_intents: sandboxIntent,
      payment_intents: operationalPoison
    };
    mockGetFirestore.mockReturnValue({
      collection: jest.fn((collectionName) => {
        mockCollectionReads.push(collectionName);
        if (collectionName === 'payment_intents') {
          throw new Error('operational payment_intents must not be read for sandbox actor');
        }
        const record = recordsByCollection[collectionName] || null;
        return {
          doc: jest.fn(() => ({
            get: jest.fn(async () => ({
              exists: Boolean(record),
              data: () => record
            }))
          }))
        };
      })
    });
    mockValidateQuoteLock.mockResolvedValue({
      success: false,
      code: 'QUOTE_LOCK_EXPIRED'
    });
    mockValidateQuoteLockPayload.mockReturnValue({
      success: true,
      quoteLock: sandboxIntent.quoteLockSnapshot,
      payableAmountInCents: 2750,
      grossAmountInCents: 2750,
      quoteLockExpirationBypassed: true
    });

    const response = await request(createApp())
      .post('/api/payment/advance')
      .set('Authorization', 'Bearer sandbox-passenger-token')
      .send({
        passengerId: 'qa-passenger',
        amount: 2750,
        grossAmountInCents: 2750,
        rideId: 'sandbox-ride',
        quoteSessionId: 'quote-session-1',
        quoteLockId: 'quote-lock-1',
        enforceQuoteLock: true,
        pickupLocation: { lat: -22.9, lng: -43.2 },
        destinationLocation: { lat: -22.91, lng: -43.21 },
        carType: 'Leaf Plus',
        rideDetails: {
          origin: 'Origem',
          destination: 'Destino'
        }
      });

    expect(response.status).toBe(200);
    expect(mockCollectionReads).toEqual(['sandbox_payment_intents']);
    expect(mockResolveUserPersistenceScope).toHaveBeenCalledTimes(1);
    expect(mockProcessAdvancePayment).toHaveBeenCalledWith(expect.objectContaining({
      passengerId: 'qa-passenger',
      rideId: 'sandbox-ride',
      quoteLockId: 'quote-lock-1',
      ...persistenceEnvelope
    }));
  });
});
