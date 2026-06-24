process.env.JWT_SECRET = 'test-secret';

jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockVerifyIdToken = jest.fn();
const mockProcessAdvancePayment = jest.fn();
const mockHasPaymentEligibleDriver = jest.fn();
const mockValidateQuoteLock = jest.fn();
const mockRedis = {};
const mockBuildPaymentAvailabilityInput = jest.fn((payload) => ({
  pickupLocation: payload.pickupLocation || payload.rideDetails?.pickupLocation || null,
  destinationLocation: payload.destinationLocation || payload.rideDetails?.destinationLocation || null,
  preferences: payload.preferences || payload.rideDetails?.preferences || {},
  carType: payload.carType || payload.rideDetails?.carType || null
}));

jest.mock('firebase-admin', () => ({
  auth: jest.fn(() => ({
    verifyIdToken: mockVerifyIdToken
  })),
  firestore: {
    FieldValue: {
      serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
      increment: jest.fn((value) => ({ __increment: value }))
    }
  }
}));

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => null)
}));

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn(() => mockRedis)
}));

jest.mock('../../../services/payment-service', () => jest.fn().mockImplementation(() => ({
  processAdvancePayment: mockProcessAdvancePayment
})));

jest.mock('../../../services/payment-runtime-profile-service', () => ({
  listProfiles: jest.fn(),
  upsertProfile: jest.fn(),
  updateProfileStatus: jest.fn(),
  resolveProfile: jest.fn()
}));

jest.mock('../../../services/kyc-policy-service', () => ({
  evaluateWithdrawalStepUp: jest.fn(),
  getConfig: jest.fn(() => ({ verificationMaxAgeHours: 24 }))
}));

jest.mock('../../../services/passenger-discount-benefit-service', () => ({
  previewDiscount: jest.fn()
}));

jest.mock('../../../services/payment-driver-availability-guard', () => ({
  buildPaymentAvailabilityInput: (...args) => mockBuildPaymentAvailabilityInput(...args),
  hasPaymentEligibleDriver: (...args) => mockHasPaymentEligibleDriver(...args)
}));

jest.mock('../../../services/quote-lock-service', () => ({
  validateQuoteLock: (...args) => mockValidateQuoteLock(...args)
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

const paymentRoutes = require('../../../routes/payment');
const { logStructured } = require('../../../utils/logger');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', paymentRoutes);
  return app;
}

const validPaymentPayload = {
  passengerId: 'passenger-1',
  amount: 2750,
  rideId: 'temp-ride-1',
  pickupLocation: { lat: -22.853586, lng: -43.318168 },
  destinationLocation: { lat: -22.870711, lng: -43.342938 },
  carType: 'Leaf Plus',
  preferences: { comfort: { temperature: { id: 'balanced' } } },
  rideDetails: {
    origin: 'Carioca Shopping',
    destination: 'Mercadao de Madureira'
  }
};

function buildAvailableDriver(overrides = {}) {
  return {
    success: true,
    hasDrivers: true,
    code: 'DRIVER_RESERVED_FOR_PAYMENT',
    driverId: 'driver-1',
    reservationId: 'pdr_reservation_1',
    reservationExpiresAt: '2026-06-24T20:00:00.000Z',
    reservationTtlSeconds: 180,
    ...overrides
  };
}

describe('payment advance availability guard', () => {
  beforeEach(() => {
    mockVerifyIdToken.mockReset();
    mockProcessAdvancePayment.mockReset();
    mockHasPaymentEligibleDriver.mockReset();
    mockValidateQuoteLock.mockReset();
    logStructured.mockClear();
    mockBuildPaymentAvailabilityInput.mockClear();
    mockValidateQuoteLock.mockResolvedValue({
      success: true,
      quoteLock: {
        quoteLockId: 'ql_valid_1',
        estimatedFare: 27.5,
        payableAmountInCents: 2750,
        grossAmountInCents: 2750
      },
      payableAmountInCents: 2750,
      grossAmountInCents: 2750
    });

    mockVerifyIdToken.mockResolvedValue({
      uid: 'passenger-1',
      phone_number: '+5521102938475'
    });
  });

  it('blocks Pix creation when no eligible driver is available', async () => {
    const app = createApp();
    mockHasPaymentEligibleDriver.mockResolvedValue({
      success: true,
      hasDrivers: false,
      code: 'NO_DRIVERS_AVAILABLE',
      radiusKm: 5
    });

    const response = await request(app)
      .post('/api/payment/advance')
      .set('Authorization', 'Bearer passenger-token')
      .send(validPaymentPayload);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      code: 'NO_DRIVERS_AVAILABLE'
    });
    expect(mockProcessAdvancePayment).not.toHaveBeenCalled();
  });

  it('rejects Pix creation without an authenticated payment actor', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/payment/advance')
      .send(validPaymentPayload);

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      code: 'PAYMENT_AUTH_TOKEN_MISSING'
    });
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
    expect(mockProcessAdvancePayment).not.toHaveBeenCalled();
    expect(logStructured).toHaveBeenCalledWith(
      'warn',
      'payment auth bloqueado por token ausente',
      expect.objectContaining({
        code: 'PAYMENT_AUTH_TOKEN_MISSING',
        passengerId: 'passenger-1',
        rideId: 'temp-ride-1'
      })
    );
  });

  it('blocks Pix creation when pickup coordinates are missing from the payment payload', async () => {
    const app = createApp();
    mockHasPaymentEligibleDriver.mockResolvedValue({
      success: false,
      hasDrivers: false,
      code: 'PICKUP_LOCATION_REQUIRED'
    });

    const response = await request(app)
      .post('/api/payment/advance')
      .set('Authorization', 'Bearer passenger-token')
      .send({
        ...validPaymentPayload,
        pickupLocation: undefined
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      code: 'PICKUP_LOCATION_REQUIRED'
    });
    expect(mockProcessAdvancePayment).not.toHaveBeenCalled();
  });

  it('continues Pix creation only after availability is confirmed', async () => {
    const app = createApp();
    mockHasPaymentEligibleDriver.mockResolvedValue(buildAvailableDriver());
    mockProcessAdvancePayment.mockResolvedValue({
      success: true,
      chargeId: 'charge-1',
      qrCode: 'qr',
      paymentLink: 'https://pay.local/charge-1'
    });

    const response = await request(app)
      .post('/api/payment/advance')
      .set('Authorization', 'Bearer passenger-token')
      .send(validPaymentPayload);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      chargeId: 'charge-1'
    });
    expect(mockProcessAdvancePayment).toHaveBeenCalledWith(
      expect.objectContaining({
        pickupLocation: validPaymentPayload.pickupLocation,
        destinationLocation: validPaymentPayload.destinationLocation,
        carType: 'Leaf Plus',
        preferences: validPaymentPayload.preferences,
        paymentDriverReservationId: 'pdr_reservation_1',
        paymentDriverReservationDriverId: 'driver-1',
        paymentDriverReservationExpiresAt: '2026-06-24T20:00:00.000Z',
        paymentDriverReservationTtlSeconds: 180
      })
    );
    expect(mockHasPaymentEligibleDriver).toHaveBeenCalledWith(expect.objectContaining({
      reserveDriver: true,
      reservationContext: expect.objectContaining({
        passengerId: 'passenger-1'
      })
    }));
  });

  it('blocks Pix creation when availability does not produce a driver reservation', async () => {
    const app = createApp();
    mockHasPaymentEligibleDriver.mockResolvedValue({
      success: true,
      hasDrivers: true,
      code: 'DRIVERS_AVAILABLE',
      driverId: 'driver-1'
    });

    const response = await request(app)
      .post('/api/payment/advance')
      .set('Authorization', 'Bearer passenger-token')
      .send(validPaymentPayload);

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      code: 'PAYMENT_DRIVER_RESERVATION_FAILED'
    });
    expect(mockProcessAdvancePayment).not.toHaveBeenCalled();
  });

  it('returns a stable code and logs when the payment service refuses Pix creation', async () => {
    const app = createApp();
    mockHasPaymentEligibleDriver.mockResolvedValue(buildAvailableDriver());
    mockProcessAdvancePayment.mockResolvedValue({
      success: false,
      error: 'Falha ao criar cobrança PIX',
      provider: 'woovi',
      providerEnvironment: 'sandbox',
      paymentProfileId: 'real-smoke-passenger-sandbox',
      paymentIntentId: 'payment_intent_1',
      details: { status: 403 }
    });

    const response = await request(app)
      .post('/api/payment/advance')
      .set('Authorization', 'Bearer passenger-token')
      .send(validPaymentPayload);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      code: 'PAYMENT_ADVANCE_FAILED',
      provider: 'woovi',
      providerEnvironment: 'sandbox'
    });
    expect(logStructured).toHaveBeenCalledWith(
      'warn',
      'payment/advance recusado pelo serviço de pagamento',
      expect.objectContaining({
        passengerId: 'passenger-1',
        rideId: 'temp-ride-1',
        code: 'PAYMENT_ADVANCE_FAILED',
        provider: 'woovi',
        providerEnvironment: 'sandbox',
        paymentProfileId: 'real-smoke-passenger-sandbox',
        paymentIntentId: 'payment_intent_1',
        providerStatus: 403
      })
    );
  });

  it('blocks Pix creation when an enforced quote lock diverges from the payment amount', async () => {
    const app = createApp();
    mockValidateQuoteLock.mockResolvedValue({
      success: false,
      code: 'QUOTE_LOCK_AMOUNT_MISMATCH',
      expectedAmountInCents: 2750,
      incomingAmountInCents: 8050
    });

    const response = await request(app)
      .post('/api/payment/advance')
      .set('Authorization', 'Bearer passenger-token')
      .send({
        ...validPaymentPayload,
        amount: 8050,
        quoteLockId: 'ql_valid_1',
        enforceQuoteLock: true
      });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      code: 'QUOTE_LOCK_AMOUNT_MISMATCH',
      expectedAmountInCents: 2750,
      incomingAmountInCents: 8050
    });
    expect(mockProcessAdvancePayment).not.toHaveBeenCalled();
  });

  it('passes the locked amount and quote lock metadata into Pix creation', async () => {
    const app = createApp();
    mockHasPaymentEligibleDriver.mockResolvedValue(buildAvailableDriver());
    mockProcessAdvancePayment.mockResolvedValue({
      success: true,
      chargeId: 'charge-1',
      qrCode: 'qr',
      paymentLink: 'https://pay.local/charge-1'
    });

    const response = await request(app)
      .post('/api/payment/advance')
      .set('Authorization', 'Bearer passenger-token')
      .send({
        ...validPaymentPayload,
        amount: 2750,
        grossAmountInCents: 2750,
        quoteSessionId: 'quote_session_1',
        quoteLockId: 'ql_valid_1',
        enforceQuoteLock: true
      });

    expect(response.status).toBe(200);
    expect(mockValidateQuoteLock).toHaveBeenCalledWith(expect.objectContaining({
      quoteLockId: 'ql_valid_1',
      quoteSessionId: 'quote_session_1',
      passengerId: 'passenger-1',
      amountInCents: 2750
    }));
    expect(mockProcessAdvancePayment).toHaveBeenCalledWith(expect.objectContaining({
      amount: 2750,
      grossAmountInCents: 2750,
      payableAmountInCents: 2750,
      quoteLockId: 'ql_valid_1',
      quoteLockSnapshot: expect.objectContaining({
        quoteLockId: 'ql_valid_1'
      }),
      paymentDriverReservationId: 'pdr_reservation_1',
      paymentDriverReservationDriverId: 'driver-1'
    }));
  });
});
