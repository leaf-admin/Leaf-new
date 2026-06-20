process.env.JWT_SECRET = 'test-secret';

jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockVerifyIdToken = jest.fn();
const mockProcessAdvancePayment = jest.fn();
const mockHasPaymentEligibleDriver = jest.fn();
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

describe('payment advance availability guard', () => {
  beforeEach(() => {
    mockVerifyIdToken.mockReset();
    mockProcessAdvancePayment.mockReset();
    mockHasPaymentEligibleDriver.mockReset();
    mockBuildPaymentAvailabilityInput.mockClear();

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
    mockHasPaymentEligibleDriver.mockResolvedValue({
      success: true,
      hasDrivers: true,
      code: 'DRIVERS_AVAILABLE',
      driverId: 'driver-1'
    });
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
        preferences: validPaymentPayload.preferences
      })
    );
  });
});
