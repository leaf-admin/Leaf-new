jest.unmock('express');

const mockRedisSet = jest.fn();
const mockRedisDel = jest.fn();

jest.mock('axios', () => ({}));

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

const wooviRoutes = require('../../../routes/woovi');
const {
  verifyWooviWebhookSignature,
  beginWooviWebhookIdempotency,
  completeWooviWebhookIdempotency,
  extractExpectedBookingAmountInCents,
  validateWebhookAmountAgainstBooking,
  isRetryableWebhookEvent
} = wooviRoutes.__private;
const firebaseConfig = require('../../../firebase-config');

function createInMemoryFirestore() {
  const docs = new Map();

  const writeDoc = (ref, data, options = {}) => {
    const previous = docs.get(ref.path) || {};
    docs.set(ref.path, options.merge ? { ...previous, ...data } : { ...data });
  };

  const collection = (path) => ({
    doc: (id) => doc(`${path}/${id}`)
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
    collection,
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
    process.env.NODE_ENV = 'test';
    firebaseConfig.getFirestore.mockReturnValue(null);
    mockRedisDel.mockResolvedValue(1);
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

  it('rejects unsigned webhook in production when provider verification has no webhook authorization', () => {
    process.env.NODE_ENV = 'production';
    process.env.WOOVI_WEBHOOK_ALLOW_UNSIGNED = 'true';
    process.env.WOOVI_WEBHOOK_PROVIDER_VERIFICATION_REQUIRED = 'true';

    const result = verifyWooviWebhookSignature(createReq({
      rawBody: Buffer.from(JSON.stringify({ event: 'CHARGE_COMPLETED' })),
      body: { event: 'CHARGE_COMPLETED' }
    }));

    expect(result.valid).toBe(false);
    expect(result.method).toBeNull();
    expect(result.reason).toBe('WEBHOOK_AUTHORIZATION_NOT_CONFIGURED');
    expect(result.providerVerificationRequired).toBe(true);
  });

  it('allows unsigned production webhook with configured authorization and provider verification', () => {
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

    expect(result.valid).toBe(true);
    expect(result.method).toBe('unsigned_provider_verification');
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
    expect(result.reason).toBe('WEBHOOK_AUTHORIZATION_NOT_CONFIGURED');
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
});
