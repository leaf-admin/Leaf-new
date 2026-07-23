jest.unmock('express');

const mockRedisSet = jest.fn();
const mockRedisDel = jest.fn();

jest.mock('axios', () => ({
  get: jest.fn(),
  create: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn()
  }))
}));

jest.mock('../../../config/woovi-config', () => ({
  getWooviConfig: jest.fn(() => ({
    environment: 'test',
    baseUrl: 'https://api.woovi.test',
    apiToken: 'test-token',
    appId: null,
    masterApiToken: null
  })),
  getWooviAuthHeaders: jest.fn(() => ({
    Authorization: 'Bearer test-token'
  }))
}));

jest.mock('../../../middleware/jwt-auth', () => ({
  authenticateJWT: (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next()
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(true),
  getConnection: jest.fn(() => ({
    set: mockRedisSet,
    del: mockRedisDel
  }))
}));

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => null)
}));

jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: jest.fn(() => '__SERVER_TIMESTAMP__')
    }
  }
}));

delete process.env.WOOVI_SANDBOX_TEST_PAYMENT_URL;

const wooviRoutes = require('../../../routes/woovi');
const {
  verifyWooviWebhookSignature,
  beginWooviWebhookIdempotency,
  completeWooviWebhookIdempotency,
  extractExpectedBookingAmountInCents,
  validateWebhookAmountAgainstBooking,
  validateSandboxTestWebhookPayload,
  evaluateSandboxPaymentIntentFreshness,
  canSandboxTestPaymentActorConfirm,
  resolveSandboxTestWebhookPayload,
  requestWooviSandboxTestPayment,
  resolveSandboxPaymentIntentAsBooking,
  processPaymentConfirmation,
  isRetryableWebhookEvent
} = wooviRoutes.__private;
const firebaseConfig = require('../../../firebase-config');
const axios = require('axios');
const PaymentService = require('../../../services/payment-service');
const paymentDispatchService = require('../../../services/payment-dispatch-service');
const rideLifecycleService = require('../../../services/ride-lifecycle-service');
const { sealFinancialContext } = require('../../../services/financial-runtime-context');
const sandboxFinancialContext = sealFinancialContext({
  providerEnvironment: 'sandbox',
  paymentProfileId: 'qa-test-users-sandbox-durable',
  paymentProfileSource: 'firestore',
  testUserSandbox: true
});

function createInMemoryFirestore() {
  const docs = new Map();

  const writeDoc = (ref, data, options = {}) => {
    const previous = docs.get(ref.path) || {};
    docs.set(ref.path, options.merge ? { ...previous, ...data } : { ...data });
  };

  const buildQuery = (path, filters = [], queryLimit = Infinity) => ({
    where: (field, operator, value) => buildQuery(path, [...filters, { field, operator, value }], queryLimit),
    limit: (limitValue) => buildQuery(path, filters, limitValue),
    get: async () => {
      const prefix = `${path}/`;
      const matchingDocs = [...docs.entries()]
        .filter(([docPath]) => docPath.startsWith(prefix))
        .map(([docPath, data]) => ({
          id: docPath.slice(prefix.length),
          data: () => data
        }))
        .filter((entry) => filters.every((filter) => {
          if (filter.operator !== '==') return false;
          return entry.data()?.[filter.field] === filter.value;
        }))
        .slice(0, queryLimit);

      return {
        empty: matchingDocs.length === 0,
        size: matchingDocs.length,
        docs: matchingDocs
      };
    }
  });

  const collection = (path) => ({
    doc: (id) => doc(`${path}/${id}`),
    where: (field, operator, value) => buildQuery(path, [{ field, operator, value }]),
    limit: (limitValue) => buildQuery(path, [], limitValue).limit(limitValue)
  });

  const doc = (path) => ({
    path,
    get: async () => ({
      exists: docs.has(path),
      data: () => docs.get(path)
    }),
    set: async (data, options) => writeDoc({ path }, data, options)
  });

  return {
    docs,
    collection: jest.fn(collection),
    runTransaction: async (handler) => {
      const pendingWrites = [];
      const transaction = {
        get: async (ref) => ({
          exists: docs.has(ref.path),
          data: () => docs.get(ref.path)
        }),
        set: (ref, data, options) => pendingWrites.push([ref, data, options])
      };

      const result = await handler(transaction);
      pendingWrites.forEach(([ref, data, options]) => writeDoc(ref, data, options));
      return result;
    }
  };
}

function createReq({ body = {}, rawBody, headers = {} } = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value])
  );

  return {
    body,
    rawBody,
    get(name) {
      return normalizedHeaders[String(name).toLowerCase()] || null;
    }
  };
}

describe('woovi webhook guards', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.WOOVI_WEBHOOK_PUBLIC_KEY;
    delete process.env.OPENPIX_WEBHOOK_PUBLIC_KEY;
    delete process.env.WOOVI_WEBHOOK_SIGNATURE_SECRET;
    delete process.env.OPENPIX_WEBHOOK_SIGNATURE_SECRET;
    delete process.env.WOOVI_WEBHOOK_HMAC_SECRET;
    delete process.env.OPENPIX_WEBHOOK_HMAC_SECRET;
    delete process.env.WOOVI_WEBHOOK_AUTHORIZATION;
    delete process.env.OPENPIX_WEBHOOK_AUTHORIZATION;
    delete process.env.WOOVI_WEBHOOK_AUTH_TOKEN;
    delete process.env.OPENPIX_WEBHOOK_AUTH_TOKEN;
    delete process.env.WOOVI_WEBHOOK_REQUIRE_SIGNATURE;
    delete process.env.WOOVI_WEBHOOK_ALLOW_UNSIGNED;
    delete process.env.WOOVI_WEBHOOK_PROVIDER_VERIFICATION_REQUIRED;
    delete process.env.WOOVI_ENVIRONMENT;
    delete process.env.WOOVI_BASE_URL;
    delete process.env.WOOVI_SANDBOX_TEST_PAYMENT_URL;
    delete process.env.WOOVI_SANDBOX_TEST_APP_ID;
    delete process.env.WOOVI_SANDBOX_TEST_AUTHORIZATION_APP_ID;
    delete process.env.OPENPIX_SANDBOX_TEST_APP_ID;
    delete process.env.OPENPIX_SANDBOX_TEST_AUTHORIZATION_APP_ID;
    process.env.NODE_ENV = 'test';
    firebaseConfig.getFirestore.mockReturnValue(null);
    mockRedisDel.mockResolvedValue(1);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('accepts valid recommended HMAC signature', () => {
    process.env.WOOVI_WEBHOOK_SIGNATURE_SECRET = 'woovi-secret';
    const rawBody = Buffer.from(JSON.stringify({ event: 'CHARGE_COMPLETED' }));
    const signature = require('crypto')
      .createHmac('sha256', 'woovi-secret')
      .update(rawBody)
      .digest('hex');

    const result = verifyWooviWebhookSignature(createReq({
      rawBody,
      body: { event: 'CHARGE_COMPLETED' },
      headers: {
        'x-webhook-signature': signature
      }
    }));

    expect(result.valid).toBe(true);
    expect(result.method).toBe('x-webhook-signature/hmac-sha256');
  });

  it('rejects invalid signature in production mode', () => {
    process.env.NODE_ENV = 'production';
    process.env.WOOVI_WEBHOOK_SIGNATURE_SECRET = 'woovi-secret';
    process.env.WOOVI_WEBHOOK_REQUIRE_SIGNATURE = 'true';

    const result = verifyWooviWebhookSignature(createReq({
      rawBody: Buffer.from(JSON.stringify({ event: 'CHARGE_COMPLETED' })),
      body: { event: 'CHARGE_COMPLETED' },
      headers: {
        'x-webhook-signature': 'invalid-signature'
      }
    }));

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('WEBHOOK_SIGNATURE_INVALID');
  });

  it('allows unsigned webhook only in non-production when no verifier is configured', () => {
    process.env.NODE_ENV = 'test';
    process.env.WOOVI_WEBHOOK_ALLOW_UNSIGNED = 'true';

    const result = verifyWooviWebhookSignature(createReq({
      rawBody: Buffer.from(JSON.stringify({ event: 'CHARGE_CREATED' })),
      body: { event: 'CHARGE_CREATED' }
    }));

    expect(result.valid).toBe(true);
    expect(result.method).toBe('unsigned_non_production');
  });

  it('allows unsigned sandbox webhook in production only through provider verification', () => {
    process.env.NODE_ENV = 'production';
    process.env.WOOVI_ENVIRONMENT = 'sandbox';
    process.env.WOOVI_BASE_URL = 'https://api.woovi-sandbox.com/api/v1';
    process.env.WOOVI_WEBHOOK_REQUIRE_SIGNATURE = 'false';
    process.env.WOOVI_WEBHOOK_ALLOW_UNSIGNED = 'true';
    process.env.WOOVI_WEBHOOK_PROVIDER_VERIFICATION_REQUIRED = 'true';

    const result = verifyWooviWebhookSignature(createReq({
      rawBody: Buffer.from(JSON.stringify({ event: 'CHARGE_COMPLETED' })),
      body: { event: 'CHARGE_COMPLETED' }
    }));

    expect(result.valid).toBe(true);
    expect(result.method).toBe('unsigned_provider_verification');
    expect(result.providerVerificationRequired).toBe(true);
  });

  it('rejects unsigned webhook in production because Woovi uses x-webhook-signature', () => {
    process.env.NODE_ENV = 'production';
    process.env.WOOVI_WEBHOOK_ALLOW_UNSIGNED = 'true';
    process.env.WOOVI_WEBHOOK_PROVIDER_VERIFICATION_REQUIRED = 'true';

    const result = verifyWooviWebhookSignature(createReq({
      rawBody: Buffer.from(JSON.stringify({ event: 'CHARGE_COMPLETED' })),
      body: { event: 'CHARGE_COMPLETED' }
    }));

    expect(result.valid).toBe(false);
    expect(result.method).toBeNull();
    expect(result.reason).toBe('WEBHOOK_SIGNATURE_MISSING');
    expect(result.providerVerificationRequired).toBe(true);
  });

  it('rejects unsigned production webhook even when custom authorization is configured', () => {
    process.env.NODE_ENV = 'production';
    process.env.WOOVI_WEBHOOK_REQUIRE_SIGNATURE = 'false';
    process.env.WOOVI_WEBHOOK_ALLOW_UNSIGNED = 'true';
    process.env.WOOVI_WEBHOOK_PROVIDER_VERIFICATION_REQUIRED = 'true';
    process.env.WOOVI_WEBHOOK_AUTHORIZATION = 'Bearer hook-token';

    const result = verifyWooviWebhookSignature(createReq({
      rawBody: Buffer.from(JSON.stringify({ event: 'CHARGE_COMPLETED' })),
      body: { event: 'CHARGE_COMPLETED' },
      headers: {
        authorization: 'Bearer hook-token'
      }
    }));

    expect(result.valid).toBe(false);
    expect(result.method).toBeNull();
    expect(result.reason).toBe('WEBHOOK_SIGNATURE_MISSING');
    expect(result.authorizationConfigured).toBe(true);
    expect(result.providerVerificationRequired).toBe(true);
  });

  it('rejects unsigned webhook in production even when signature requirement flag is false', () => {
    process.env.NODE_ENV = 'production';
    process.env.WOOVI_WEBHOOK_SIGNATURE_SECRET = 'woovi-secret';
    process.env.WOOVI_WEBHOOK_REQUIRE_SIGNATURE = 'false';
    process.env.WOOVI_WEBHOOK_ALLOW_UNSIGNED = 'true';

    const result = verifyWooviWebhookSignature(createReq({
      rawBody: Buffer.from(JSON.stringify({ event: 'CHARGE_COMPLETED' })),
      body: { event: 'CHARGE_COMPLETED' }
    }));

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('WEBHOOK_SIGNATURE_MISSING');
  });

  it('rejects unsigned webhook in production when provider verification is disabled', () => {
    process.env.NODE_ENV = 'production';
    process.env.WOOVI_WEBHOOK_ALLOW_UNSIGNED = 'true';
    process.env.WOOVI_WEBHOOK_PROVIDER_VERIFICATION_REQUIRED = 'false';

    const result = verifyWooviWebhookSignature(createReq({
      rawBody: Buffer.from(JSON.stringify({ event: 'CHARGE_COMPLETED' })),
      body: { event: 'CHARGE_COMPLETED' }
    }));

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('WEBHOOK_SIGNATURE_MISSING');
  });

  it('rejects webhook when authorization token is configured but missing', () => {
    process.env.NODE_ENV = 'production';
    process.env.WOOVI_WEBHOOK_ALLOW_UNSIGNED = 'true';
    process.env.WOOVI_WEBHOOK_PROVIDER_VERIFICATION_REQUIRED = 'true';
    process.env.WOOVI_WEBHOOK_AUTHORIZATION = 'Bearer hook-token';

    const result = verifyWooviWebhookSignature(createReq({
      rawBody: Buffer.from(JSON.stringify({ event: 'CHARGE_COMPLETED' })),
      body: { event: 'CHARGE_COMPLETED' }
    }));

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('WEBHOOK_AUTHORIZATION_MISSING');
  });

  it('marks duplicate webhook events through redis idempotency key', async () => {
    mockRedisSet
      .mockResolvedValueOnce('OK')
      .mockResolvedValueOnce(null);

    const first = await beginWooviWebhookIdempotency({
      event: 'charge.completed',
      chargeId: 'charge_123',
      amount: 1590
    });
    const second = await beginWooviWebhookIdempotency({
      event: 'charge.completed',
      chargeId: 'charge_123',
      amount: 1590
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(first.key).toContain('charge_123');
  });

  it('marks duplicate webhook events through durable Firestore idempotency when available', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    mockRedisSet.mockResolvedValue('OK');

    const first = await beginWooviWebhookIdempotency({
      event: 'charge.completed',
      chargeId: 'charge_durable_123',
      amount: 1590
    });
    const second = await beginWooviWebhookIdempotency({
      event: 'charge.completed',
      chargeId: 'charge_durable_123',
      amount: 1590
    });

    expect(first).toMatchObject({
      duplicate: false,
      source: 'firestore'
    });
    expect(second).toMatchObject({
      duplicate: true,
      source: 'firestore'
    });
    expect(firestore.docs.size).toBe(1);
  });

  it('allows retry for durable webhook events previously marked as failed', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    mockRedisSet.mockResolvedValue('OK');

    const first = await beginWooviWebhookIdempotency({
      event: 'charge.completed',
      chargeId: 'charge_retry_123',
      amount: 1590
    });
    await completeWooviWebhookIdempotency(first, 'failed', {
      error: 'store failed',
      responseStatus: 500
    });
    const second = await beginWooviWebhookIdempotency({
      event: 'charge.completed',
      chargeId: 'charge_retry_123',
      amount: 1590
    });

    expect(first.duplicate).toBe(false);
    expect(second).toMatchObject({
      duplicate: false,
      retry: true,
      source: 'firestore'
    });
    const stored = Array.from(firestore.docs.values())[0];
    expect(stored.status).toBe('processing');
    expect(stored.retryOfStatus).toBe('failed');
    expect(stored.attempts).toBe(2);
  });

  it('does not retry fresh processing webhook events', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    mockRedisSet.mockResolvedValue('OK');

    await beginWooviWebhookIdempotency({
      event: 'charge.completed',
      chargeId: 'charge_processing_123',
      amount: 1590
    });
    const second = await beginWooviWebhookIdempotency({
      event: 'charge.completed',
      chargeId: 'charge_processing_123',
      amount: 1590
    });

    expect(second.duplicate).toBe(true);
    expect(second.source).toBe('firestore');
  });

  it('treats stale received webhook events as retryable', () => {
    expect(isRetryableWebhookEvent({
      status: 'received',
      updatedAtIso: new Date(Date.now() - 10 * 60 * 1000).toISOString()
    })).toBe(true);
  });

  it('releases redis idempotency key when webhook processing fails without Firestore', async () => {
    firebaseConfig.getFirestore.mockReturnValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRedisDel.mockResolvedValue(1);

    const decision = await beginWooviWebhookIdempotency({
      event: 'charge.completed',
      chargeId: 'charge_redis_retry_123',
      amount: 1590
    });
    await completeWooviWebhookIdempotency(decision, 'failed', {
      error: 'temporary failure',
      responseStatus: 500
    });

    expect(mockRedisDel).toHaveBeenCalledWith(decision.key);
  });

  it('extracts expected booking amount from canonical cent fields first', () => {
    expect(extractExpectedBookingAmountInCents({
      paymentAmountInCents: 1234,
      estimatedFare: 99.99
    })).toBe(1234);
  });

  it('rejects mismatched payment amount against booking data', () => {
    const result = validateWebhookAmountAgainstBooking({
      bookingData: {
        estimatedFareCents: 2500
      },
      amountInCents: 1999,
      rideId: 'ride_1',
      chargeId: 'charge_1'
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('PAYMENT_AMOUNT_MISMATCH');
    expect(result.expectedAmountInCents).toBe(2500);
    expect(result.receivedAmountInCents).toBe(1999);
  });

  it('accepts matching payment amount against booking data', () => {
    const result = validateWebhookAmountAgainstBooking({
      bookingData: {
        pricingPayload: {
          final_price: 25
        }
      },
      amountInCents: 2500,
      rideId: 'ride_1',
      chargeId: 'charge_1'
    });

    expect(result.ok).toBe(true);
    expect(result.code).toBe('PAYMENT_AMOUNT_MATCH');
  });

  it('allows production test webhook only for a matching sandbox payment intent', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);

    await firestore.collection('sandbox_payment_intents').doc('intent-123').set({
      status: 'charge_created',
      providerEnvironment: 'sandbox',
      financialContext: sandboxFinancialContext,
      chargeId: 'charge-123',
      rideId: 'ride-123',
      passengerId: 'passenger-123',
      payableAmountInCents: 5511,
      chargeCreatedAtIso: new Date().toISOString(),
      paymentDriverReservationExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
    });

    const result = await validateSandboxTestWebhookPayload({
      charge: {
        identifier: 'charge-123',
        transactionID: 'charge-123',
        status: 'COMPLETED',
        value: 5511,
        additionalInfo: [
          { key: 'passenger_id', value: 'passenger-123' },
          { key: 'ride_id', value: 'ride-123' },
          { key: 'payment_intent_id', value: 'intent-123' },
          { key: 'service', value: 'ride_sharing' }
        ]
      }
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('SANDBOX_TEST_WEBHOOK_INTENT_VALIDATED');
  });

  it('builds a sandbox confirmation payload only from the exact authoritative payment intent', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);

    await firestore.collection('sandbox_payment_intents').doc('intent-production').set({
      status: 'charge_created',
      providerEnvironment: 'production',
      chargeId: 'charge-production',
      rideId: 'ride-production',
      passengerId: 'passenger-latest',
      payableAmountInCents: 9999,
      chargeCreatedAtIso: new Date().toISOString(),
      paymentDriverReservationExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
    });
    await firestore.collection('sandbox_payment_intents').doc('intent-older').set({
      status: 'charge_created',
      providerEnvironment: 'sandbox',
      financialContext: sandboxFinancialContext,
      chargeId: 'charge-older',
      rideId: 'ride-older',
      passengerId: 'passenger-latest',
      payableAmountInCents: 4400,
      chargeCreatedAtIso: new Date(Date.now() - 60_000).toISOString(),
      paymentDriverReservationExpiresAt: new Date(Date.now() + 4 * 60_000).toISOString()
    });
    await firestore.collection('sandbox_payment_intents').doc('intent-latest').set({
      paymentIntentId: 'intent-latest',
      status: 'charge_created',
      providerEnvironment: 'sandbox',
      financialContext: sandboxFinancialContext,
      chargeId: 'charge-latest',
      rideId: 'ride-latest',
      passengerId: 'passenger-latest',
      payableAmountInCents: 7690,
      correlationID: 'correlation-latest',
      chargeCreatedAtIso: new Date().toISOString(),
      paymentDriverReservationExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
    });

    const result = await resolveSandboxTestWebhookPayload({
      passengerId: 'passenger-latest',
      paymentIntentId: 'intent-latest'
    });

    expect(result.found).toBe(true);
    expect(result.paymentIntentId).toBe('intent-latest');
    expect(result.chargeId).toBe('charge-latest');
    expect(result.rideId).toBe('ride-latest');
    expect(result.amountInCents).toBe(7690);
    expect(result.payload.charge.value).toBe(7690);
    expect(result.payload.account.environment).toBe('TESTING');
  });

  it('refuses ambiguous sandbox confirmation without paymentIntentId', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);

    const result = await resolveSandboxTestWebhookPayload({
      passengerId: 'passenger-latest'
    });

    expect(result).toEqual({
      found: false,
      reason: 'SANDBOX_PAYMENT_INTENT_ID_REQUIRED'
    });
  });

  it('rejects an expired exact intent even while its status remains charge_created', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const nowMs = Date.now();

    await firestore.collection('sandbox_payment_intents').doc('intent-expired').set({
      paymentIntentId: 'intent-expired',
      status: 'charge_created',
      providerEnvironment: 'sandbox',
      financialContext: sandboxFinancialContext,
      chargeId: 'charge-expired',
      rideId: 'ride-expired',
      passengerId: 'passenger-expired',
      payableAmountInCents: 1891,
      chargeCreatedAtIso: new Date(nowMs - 10 * 60_000).toISOString(),
      paymentDriverReservationExpiresAt: new Date(nowMs - 5 * 60_000).toISOString()
    });

    const result = await resolveSandboxTestWebhookPayload({
      passengerId: 'passenger-expired',
      paymentIntentId: 'intent-expired'
    });

    expect(result).toEqual({
      found: false,
      reason: 'SANDBOX_PAYMENT_INTENT_EXPIRED'
    });
  });

  it('fails closed when an exact intent has no authoritative expiration', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);

    await firestore.collection('sandbox_payment_intents').doc('intent-no-expiry').set({
      paymentIntentId: 'intent-no-expiry',
      status: 'charge_created',
      providerEnvironment: 'sandbox',
      financialContext: sandboxFinancialContext,
      chargeId: 'charge-no-expiry',
      rideId: 'ride-no-expiry',
      passengerId: 'passenger-no-expiry',
      payableAmountInCents: 2488,
      chargeCreatedAtIso: new Date().toISOString()
    });

    const result = await resolveSandboxTestWebhookPayload({
      passengerId: 'passenger-no-expiry',
      paymentIntentId: 'intent-no-expiry'
    });

    expect(result).toEqual({
      found: false,
      reason: 'SANDBOX_PAYMENT_INTENT_EXPIRY_MISSING'
    });
  });

  it('treats a sandbox intent as expired exactly at its deadline', () => {
    const deadlineMs = Date.parse('2026-07-10T21:00:00.000Z');
    const result = evaluateSandboxPaymentIntentFreshness({
      chargeCreatedAtIso: '2026-07-10T20:55:00.000Z',
      chargeExpiresAtIso: '2026-07-10T21:00:00.000Z'
    }, {
      nowMs: deadlineMs,
      maxAgeMs: 60 * 60 * 1000
    });

    expect(result).toMatchObject({
      fresh: false,
      reason: 'SANDBOX_PAYMENT_INTENT_EXPIRED',
      expiresAtMs: deadlineMs
    });
  });

  it('allows sandbox app confirmation only for the matching passenger or sandbox roles', () => {
    expect(
      canSandboxTestPaymentActorConfirm(
        { type: 'firebase', uid: 'passenger-latest', role: 'user' },
        'passenger-latest'
      )
    ).toBe(true);

    expect(
      canSandboxTestPaymentActorConfirm(
        { type: 'firebase', uid: 'other-passenger', role: 'user' },
        'passenger-latest'
      )
    ).toBe(false);

    expect(
      canSandboxTestPaymentActorConfirm(
        { type: 'admin', id: 'dev-1', role: 'development' },
        'passenger-latest'
      )
    ).toBe(true);
  });

  it('confirms sandbox Pix charge through Woovi official testing endpoint', async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { ok: true }
    });

    const result = await requestWooviSandboxTestPayment({
      transactionID: 'charge-latest',
      chargeId: 'charge-latest',
      paymentIntentId: 'intent-latest'
    });

    expect(result.success).toBe(true);
    expect(result.transactionID).toBe('charge-latest');
    expect(result.endpointHost).toBe('api.woovi.com');
    expect(axios.get).toHaveBeenCalledWith(
      'https://api.woovi.com/openpix/testing',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'test-token'
        }),
        params: {
          transactionID: 'charge-latest'
        }
      })
    );
  });

  it('uses explicit Woovi sandbox testing AppID before generic sandbox token', async () => {
    process.env.WOOVI_SANDBOX_TEST_APP_ID = 'test-app-id-for-openpix-testing';
    axios.get.mockResolvedValue({
      status: 200,
      data: { ok: true }
    });

    const result = await requestWooviSandboxTestPayment({
      transactionID: 'charge-explicit-app-id'
    });

    expect(result.success).toBe(true);
    expect(result.authorizationSource).toBe('WOOVI_SANDBOX_TEST_APP_ID');
    expect(axios.get).toHaveBeenCalledWith(
      'https://api.woovi.com/openpix/testing',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'test-app-id-for-openpix-testing'
        }),
        params: {
          transactionID: 'charge-explicit-app-id'
        }
      })
    );
  });

  it('does not materialize sandbox payment when Woovi testing endpoint rejects it', async () => {
    axios.get.mockResolvedValue({
      status: 404,
      data: { error: 'not found' }
    });

    const result = await requestWooviSandboxTestPayment({
      transactionID: 'missing-charge'
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('WOOVI_SANDBOX_TEST_PAYMENT_REJECTED');
    expect(result.status).toBe(404);
  });

  it('does not resolve an exact sandbox intent for a different passenger', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);

    await firestore.collection('sandbox_payment_intents').doc('intent-owned').set({
      status: 'charge_created',
      providerEnvironment: 'sandbox',
      financialContext: sandboxFinancialContext,
      chargeId: 'charge-owned',
      rideId: 'ride-owned',
      passengerId: 'passenger-owner',
      payableAmountInCents: 5511,
      chargeCreatedAtIso: new Date().toISOString(),
      paymentDriverReservationExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
    });

    const result = await resolveSandboxTestWebhookPayload({
      passengerId: 'passenger-other',
      paymentIntentId: 'intent-owned'
    });

    expect(result.found).toBe(false);
    expect(result.reason).toBe('SANDBOX_PAYMENT_INTENT_NOT_FOUND');
  });

  it('rejects sandbox test webhook when amount differs from payment intent', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);

    await firestore.collection('sandbox_payment_intents').doc('intent-amount').set({
      status: 'charge_created',
      providerEnvironment: 'sandbox',
      financialContext: sandboxFinancialContext,
      chargeId: 'charge-amount',
      rideId: 'ride-amount',
      passengerId: 'passenger-amount',
      payableAmountInCents: 5511,
      chargeCreatedAtIso: new Date().toISOString(),
      paymentDriverReservationExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
    });

    const result = await validateSandboxTestWebhookPayload({
      charge: {
        identifier: 'charge-amount',
        status: 'COMPLETED',
        value: 5512,
        additionalInfo: [
          { key: 'passenger_id', value: 'passenger-amount' },
          { key: 'ride_id', value: 'ride-amount' },
          { key: 'payment_intent_id', value: 'intent-amount' }
        ]
      }
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('SANDBOX_TEST_WEBHOOK_AMOUNT_MISMATCH');
    expect(result.expectedAmountInCents).toBe(5511);
  });

  it('resolves matching sandbox payment intent as booking data for pre-booking payment confirmation', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);

    await firestore.collection('sandbox_payment_intents').doc('intent-prebooking').set({
      status: 'charge_created',
      providerEnvironment: 'sandbox',
      financialContext: sandboxFinancialContext,
      chargeId: 'charge-prebooking',
      rideId: 'ride-prebooking',
      passengerId: 'passenger-prebooking',
      payableAmountInCents: 5511,
      chargeCreatedAtIso: new Date().toISOString()
    });

    const bookingData = await resolveSandboxPaymentIntentAsBooking({
      chargeId: 'charge-prebooking',
      rideId: 'ride-prebooking',
      passengerId: 'passenger-prebooking',
      amountInCents: 5511
    });

    expect(bookingData).toMatchObject({
      rideId: 'ride-prebooking',
      passengerId: 'passenger-prebooking',
      paymentAmountInCents: 5511,
      status: 'payment_intent_only',
      source: 'sandbox_payment_intent'
    });

    expect(validateWebhookAmountAgainstBooking({
      bookingData,
      amountInCents: 5511,
      rideId: 'ride-prebooking',
      chargeId: 'charge-prebooking'
    }).ok).toBe(true);
  });

  it('confirms sandbox payment from the authoritative intent without reading an operational poison booking', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);

    await firestore.collection('sandbox_payment_intents').doc('intent-sandbox-poison').set({
      paymentIntentId: 'intent-sandbox-poison',
      status: 'charge_created',
      providerEnvironment: 'sandbox',
      financialContext: sandboxFinancialContext,
      financialNamespace: sandboxFinancialContext.namespace,
      financialContextId: sandboxFinancialContext.contextId,
      chargeId: 'charge-sandbox-poison',
      rideId: 'ride-sandbox-poison',
      passengerId: 'passenger-sandbox-poison',
      payableAmountInCents: 5511,
      chargeCreatedAtIso: new Date().toISOString(),
      paymentDriverReservationExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
    });
    await firestore.collection('bookings').doc('ride-sandbox-poison').set({
      rideId: 'ride-sandbox-poison',
      passengerId: 'operational-passenger-poison',
      driverId: 'operational-driver-poison',
      paymentAmountInCents: 999999,
      status: 'in_progress'
    });
    firestore.collection.mockClear();

    const storeConfirmedPayment = jest
      .spyOn(PaymentService.prototype, 'storeConfirmedPayment')
      .mockResolvedValue({ success: true, ledgerPosted: true, ledgerStatus: 'posted' });
    const savePaymentHolding = jest
      .spyOn(PaymentService.prototype, 'savePaymentHolding')
      .mockResolvedValue({ success: true });
    const associateDriverToPayment = jest
      .spyOn(PaymentService.prototype, 'associateDriverToPayment')
      .mockResolvedValue({ success: true });
    const resolveBookingIdFromPaymentRefs = jest
      .spyOn(paymentDispatchService, 'resolveBookingIdFromPaymentRefs')
      .mockResolvedValue('operational-poison-booking');
    const markBookingPaymentConfirmed = jest
      .spyOn(paymentDispatchService, 'markBookingPaymentConfirmed')
      .mockResolvedValue(undefined);
    const triggerDispatchAfterPayment = jest
      .spyOn(paymentDispatchService, 'triggerDispatchAfterPayment')
      .mockResolvedValue({ success: false, skipped: true, reason: 'BOOKING_NOT_FOUND' });
    jest
      .spyOn(rideLifecycleService, 'applyConfirmedRideExtension')
      .mockResolvedValue({ success: true, skipped: true });

    const result = await processPaymentConfirmation(
      'charge-sandbox-poison',
      'ride-sandbox-poison',
      5511,
      'passenger-sandbox-poison',
      null,
      {
        providerEnvironment: 'sandbox',
        providerConfirmation: { source: 'woovi_openpix_testing' },
        source: 'sandbox_provider_verification',
        additionalInfo: [
          { key: 'payment_intent_id', value: 'intent-sandbox-poison' },
          { key: 'provider_environment', value: 'sandbox' },
          { key: 'financial_namespace', value: 'sandbox' }
        ]
      }
    );
    await Promise.resolve();

    expect(result).toMatchObject({
      success: true,
      rideId: 'ride-sandbox-poison',
      status: 'confirmed',
      financialContext: sandboxFinancialContext,
      financialNamespace: 'sandbox',
      financialContextId: sandboxFinancialContext.contextId,
      providerEnvironment: 'sandbox',
      testUserSandbox: true
    });
    expect(firestore.collection.mock.calls.map(([collectionName]) => collectionName)).toEqual([
      'sandbox_payment_intents'
    ]);
    expect(resolveBookingIdFromPaymentRefs).not.toHaveBeenCalled();
    expect(associateDriverToPayment).not.toHaveBeenCalled();
    expect(storeConfirmedPayment).toHaveBeenCalledWith(expect.objectContaining({
      rideId: 'ride-sandbox-poison',
      chargeId: 'charge-sandbox-poison',
      financialContext: sandboxFinancialContext,
      financialNamespace: 'sandbox',
      financialContextId: sandboxFinancialContext.contextId,
      providerEnvironment: 'sandbox',
      testUserSandbox: true
    }));
    expect(savePaymentHolding).toHaveBeenCalledWith(
      'ride-sandbox-poison',
      expect.objectContaining({
        financialContext: sandboxFinancialContext,
        financialNamespace: 'sandbox',
        financialContextId: sandboxFinancialContext.contextId,
        providerEnvironment: 'sandbox',
        testUserSandbox: true
      })
    );
    expect(markBookingPaymentConfirmed).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 'ride-sandbox-poison',
      financialContext: sandboxFinancialContext,
      financialNamespace: 'sandbox',
      financialContextId: sandboxFinancialContext.contextId,
      providerEnvironment: 'sandbox',
      testUserSandbox: true
    }));
    expect(triggerDispatchAfterPayment).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 'ride-sandbox-poison',
      financialContext: sandboxFinancialContext,
      financialNamespace: 'sandbox',
      financialContextId: sandboxFinancialContext.contextId,
      providerEnvironment: 'sandbox',
      testUserSandbox: true
    }));
  });

  it('fails closed on a divergent sandbox intent before any booking or dispatch lookup', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);

    await firestore.collection('sandbox_payment_intents').doc('intent-divergent').set({
      paymentIntentId: 'intent-divergent',
      status: 'charge_created',
      providerEnvironment: 'sandbox',
      financialContext: sandboxFinancialContext,
      chargeId: 'charge-divergent',
      rideId: 'ride-divergent',
      passengerId: 'passenger-owner',
      payableAmountInCents: 5511
    });
    await firestore.collection('bookings').doc('ride-divergent').set({
      driverId: 'operational-driver-poison',
      passengerId: 'passenger-attacker',
      paymentAmountInCents: 5511
    });
    firestore.collection.mockClear();

    const associateDriverToPayment = jest.spyOn(PaymentService.prototype, 'associateDriverToPayment');
    const resolveBookingIdFromPaymentRefs = jest.spyOn(
      paymentDispatchService,
      'resolveBookingIdFromPaymentRefs'
    );

    const result = await processPaymentConfirmation(
      'charge-divergent',
      'ride-divergent',
      5511,
      'passenger-attacker',
      null,
      {
        providerEnvironment: 'sandbox',
        source: 'sandbox_provider_verification',
        additionalInfo: [
          { key: 'payment_intent_id', value: 'intent-divergent' }
        ]
      }
    );

    expect(result).toEqual({
      success: false,
      error: 'SANDBOX_PAYMENT_INTENT_MISMATCH',
      status: 'REJECTED'
    });
    expect(firestore.collection.mock.calls.map(([collectionName]) => collectionName)).toEqual([
      'sandbox_payment_intents'
    ]);
    expect(resolveBookingIdFromPaymentRefs).not.toHaveBeenCalled();
    expect(associateDriverToPayment).not.toHaveBeenCalled();
  });
});
