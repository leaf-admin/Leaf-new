'use strict';

jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockVerifyIdToken = jest.fn();
const mockUpdateRealtimeDB = jest.fn();
const mockProcessOnboardingResult = jest.fn();

jest.mock('firebase-admin', () => ({
  auth: jest.fn(() => ({
    verifyIdToken: mockVerifyIdToken
  }))
}));

jest.mock('../../../firebase-config', () => ({
  initializeFirebase: jest.fn(),
  updateRealtimeDB: (...args) => mockUpdateRealtimeDB(...args)
}));

jest.mock('../../../services/kyc-driver-status-service', () => ({
  processOnboardingResult: (...args) => mockProcessOnboardingResult(...args)
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const onboardingRoutes = require('../../../routes/kyc-onboarding');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/', onboardingRoutes);
  return app;
}

describe('kyc onboarding legacy device signature boundary', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      KYC_PRODUCTION_BIOMETRICS_ENABLED: 'false',
      KYC_ALLOW_LEGACY_DEVICE_SIGNATURE: 'true'
    };
    jest.clearAllMocks();
    mockVerifyIdToken.mockResolvedValue({ uid: 'driver-1' });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('rejects a self-declared device signature before it can mutate KYC state in production', async () => {
    const response = await request(createApp())
      .post('/api/drivers/kyc/onboarding')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        driverId: 'driver-1',
        onboardingMode: 'device_signature_v1',
        similarityScore: 1,
        approveThreshold: 0.5,
        selfieSignature: 'client-controlled-signature'
      });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      code: 'KYC_LEGACY_DEVICE_SIGNATURE_DISABLED'
    });
    expect(mockUpdateRealtimeDB).not.toHaveBeenCalled();
    expect(mockProcessOnboardingResult).not.toHaveBeenCalled();
  });
});
