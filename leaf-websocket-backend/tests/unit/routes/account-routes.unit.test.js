jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockVerifyIdToken = jest.fn();
const mockUpdateUser = jest.fn();
const mockDeleteUser = jest.fn();
const mockUserDocGet = jest.fn();
const mockUserDocSet = jest.fn();
const mockDeletionAdd = jest.fn();
const mockDeletionLogUpdate = jest.fn();
const mockDatabaseOnce = jest.fn();
const mockDatabaseRemove = jest.fn();
const mockDatabaseUpdate = jest.fn();
const mockRedisHgetall = jest.fn();
const mockRedisDel = jest.fn();

const firestoreFn = jest.fn(() => ({
  collection: jest.fn((collectionName) => {
    if (collectionName === 'users') {
      return {
        doc: jest.fn(() => ({
          get: mockUserDocGet,
          set: mockUserDocSet,
        })),
      };
    }

    if (collectionName === 'account_deletions') {
      return {
        add: mockDeletionAdd,
      };
    }

    return {};
  }),
}));

firestoreFn.FieldValue = {
  serverTimestamp: jest.fn(() => 'server-ts'),
  delete: jest.fn(() => 'field-delete'),
};

jest.mock('firebase-admin', () => ({
  auth: jest.fn(() => ({
    verifyIdToken: mockVerifyIdToken,
    updateUser: mockUpdateUser,
    deleteUser: mockDeleteUser,
  })),
  firestore: firestoreFn,
  database: jest.fn(() => ({
    ref: jest.fn(() => ({
      once: mockDatabaseOnce,
      remove: mockDatabaseRemove,
      update: mockDatabaseUpdate,
    })),
  })),
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn(() => ({
    hgetall: (...args) => mockRedisHgetall(...args),
    del: (...args) => mockRedisDel(...args),
  })),
}));

const accountRoutes = require('../../../routes/account-routes');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/', accountRoutes);
  return app;
}

describe('account deletion route', () => {
  beforeEach(() => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'review-user',
      phone_number: '+5521102938475',
      email: 'review@leaf.app.br',
    });
    mockUpdateUser.mockResolvedValue(undefined);
    mockDeleteUser.mockResolvedValue(undefined);
    mockUserDocGet.mockResolvedValue({ exists: false, data: () => null });
    mockUserDocSet.mockResolvedValue(undefined);
    mockDeletionLogUpdate.mockResolvedValue(undefined);
    mockDeletionAdd.mockResolvedValue({ update: mockDeletionLogUpdate });
    mockDatabaseOnce.mockResolvedValue({
      exists: () => false,
      val: () => null,
    });
    mockDatabaseRemove.mockResolvedValue(undefined);
    mockDatabaseUpdate.mockResolvedValue(undefined);
    mockRedisHgetall.mockResolvedValue({ status: 'offline', isOnline: 'false' });
    mockRedisDel.mockResolvedValue(1);
  });

  it('rejects client profile updates that try to write derived driver approval, document, KYC or vehicle fields', async () => {
    const response = await request(createApp())
      .put('/api/account/profile')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        name: 'Motorista Teste',
        documents: { cnh: { status: 'approved' } },
        driverActivation: { canGoOnline: true },
        vehicleApproved: true,
        kycStatus: 'approved',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(expect.objectContaining({
      success: false,
      code: 'PROFILE_DERIVED_FIELD_FORBIDDEN',
      forbiddenFields: expect.arrayContaining([
        'documents',
        'driverActivation',
        'kycStatus',
        'vehicleApproved',
      ]),
    }));
    expect(mockUserDocSet).not.toHaveBeenCalled();
    expect(mockDatabaseUpdate).not.toHaveBeenCalled();
  });

  it('allows normal account profile updates without derived driver lifecycle fields', async () => {
    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        uid: 'review-user',
        usertype: 'customer',
        userType: 'customer',
        phone: '+5521102938475',
        phoneNumber: '+5521102938475',
        onboardingCompleted: true,
        profileComplete: true,
      }),
    });

    const response = await request(createApp())
      .put('/api/account/profile')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        name: 'Leaf Passageiro Teste',
        city: 'Rio de Janeiro',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      success: true,
      source: 'firestore',
    }));
    expect(mockUserDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'review-user',
        name: 'Leaf Passageiro Teste',
        city: 'Rio de Janeiro',
      }),
      { merge: true },
    );
  });

  it('rejects role, phone and onboarding identity changes after profile creation', async () => {
    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        uid: 'review-user',
        name: 'Leaf Passageiro',
        usertype: 'customer',
        phone: '+5521102938475',
        phoneValidated: true,
        profileComplete: true,
        onboardingCompleted: true,
      }),
    });

    const response = await request(createApp())
      .put('/api/account/profile')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        role: 'driver',
        usertype: 'driver',
        phone: '+5521999999999',
        phoneValidated: false,
        profileComplete: false,
        onboardingCompleted: false,
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(expect.objectContaining({
      success: false,
      code: 'PROFILE_IDENTITY_FIELD_IMMUTABLE',
      immutableFields: expect.arrayContaining([
        'role',
        'usertype',
        'phone',
        'phoneValidated',
        'profileComplete',
        'onboardingCompleted',
      ]),
    }));
    expect(mockUserDocSet).not.toHaveBeenCalled();
    expect(mockDatabaseUpdate).not.toHaveBeenCalled();
  });

  it('allows idempotent retries that repeat the completed role, phone and onboarding values', async () => {
    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        uid: 'review-user',
        name: 'Motorista OTP',
        createdVia: 'otp_verify',
        usertype: 'driver',
        userType: 'driver',
        mobile: '+55 (21) 10293-8475',
        phone: '+55 (21) 10293-8475',
        phoneNumber: '+55 (21) 10293-8475',
        phoneValidated: true,
        profileComplete: true,
        onboardingCompleted: true,
      }),
    });

    const response = await request(createApp())
      .put('/api/account/profile')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        name: 'Motorista OTP',
        usertype: 'driver',
        userType: 'driver',
        phone: '+5521102938475',
        phoneValidated: true,
        profileComplete: true,
        onboardingCompleted: true,
      });

    expect(response.status).toBe(200);
    expect(mockUserDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        usertype: 'driver',
        userType: 'driver',
        phoneValidated: true,
        profileComplete: true,
        onboardingCompleted: true,
      }),
      { merge: true },
    );
  });

  it('derives phone verification and onboarding completion on first profile creation', async () => {
    const response = await request(createApp())
      .put('/api/account/profile')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        name: 'Motorista Novo',
        usertype: 'driver',
        phone: '+5521999999999',
        phoneValidated: false,
        onboardingCompleted: false,
        acceptTerms: true,
        acceptPrivacy: true,
        consentBackgroundCheck: true,
      });

    expect(response.status).toBe(200);
    expect(mockUserDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Motorista Novo',
        usertype: 'driver',
        phone: '+5521102938475',
        phoneNumber: '+5521102938475',
        mobile: '+5521102938475',
        phoneValidated: true,
        profileComplete: true,
        onboardingCompleted: true,
        acceptTerms: true,
        acceptPrivacy: true,
        consentBackgroundCheck: true,
        approved: false,
        isApproved: false,
        canGoOnline: false,
      }),
      { merge: true },
    );
    expect(mockDatabaseUpdate).toHaveBeenCalledWith({
      usertype: 'driver',
      userType: 'driver',
      role: 'driver',
    });
  });

  it('projects the immutable canonical role into the RTDB user node', async () => {
    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        uid: 'review-user',
        name: 'Motorista Canônico',
        usertype: 'driver',
        userType: 'driver',
        phone: '+5521102938475',
        phoneValidated: true,
        profileComplete: true,
        onboardingCompleted: true,
      }),
    });

    const response = await request(createApp())
      .put('/api/account/profile')
      .set('Authorization', 'Bearer firebase-token')
      .send({ name: 'Motorista Canônico Atualizado' });

    expect(response.status).toBe(200);
    expect(mockDatabaseUpdate).toHaveBeenCalledWith({
      usertype: 'driver',
      userType: 'driver',
      role: 'driver',
    });
  });

  it.each([
    [
      'terms',
      { usertype: 'customer', acceptTerms: false, acceptPrivacy: true },
      ['acceptTerms'],
    ],
    [
      'privacy',
      { usertype: 'customer', acceptTerms: true },
      ['acceptPrivacy'],
    ],
    [
      'background check for drivers',
      { usertype: 'driver', acceptTerms: true, acceptPrivacy: true },
      ['consentBackgroundCheck'],
    ],
  ])('blocks first profile completion without required %s consent', async (_label, profile, expectedMissing) => {
    const response = await request(createApp())
      .put('/api/account/profile')
      .set('Authorization', 'Bearer firebase-token')
      .send(profile);

    expect(response.status).toBe(400);
    expect(response.body).toEqual(expect.objectContaining({
      success: false,
      code: 'PROFILE_REQUIRED_CONSENTS_MISSING',
      missingConsents: expectedMissing,
    }));
    expect(mockUserDocSet).not.toHaveBeenCalled();
    expect(mockDatabaseUpdate).not.toHaveBeenCalled();
  });

  it('requires an explicit valid role on first profile completion', async () => {
    const response = await request(createApp())
      .put('/api/account/profile')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        name: 'Perfil sem papel',
        acceptTerms: true,
        acceptPrivacy: true,
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      code: 'PROFILE_ROLE_REQUIRED_FOR_COMPLETION',
    });
    expect(mockUserDocSet).not.toHaveBeenCalled();
  });

  it('completes an OTP RTDB bootstrap once and resets customer approval when selecting driver', async () => {
    mockDatabaseOnce.mockResolvedValue({
      exists: () => true,
      val: () => ({
        uid: 'review-user',
        name: 'Usuário 8475',
        mobile: '+5521102938475',
        phone: '+5521102938475',
        phoneNumber: '+5521102938475',
        usertype: 'customer',
        userType: 'customer',
        approved: true,
        isApproved: true,
        canGoOnline: true,
        phoneValidated: true,
        profileComplete: false,
        onboardingCompleted: false,
        createdVia: 'otp_verify',
      }),
    });

    const response = await request(createApp())
      .put('/api/account/profile')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        name: 'Motorista OTP',
        userType: 'driver',
        phone: '+5521999999999',
        acceptTerms: true,
        acceptPrivacy: true,
        consentBackgroundCheck: true,
      });

    expect(response.status).toBe(200);
    expect(mockUserDocSet).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: 'Motorista OTP',
        usertype: 'driver',
        userType: 'driver',
        phone: '+5521102938475',
        phoneValidated: true,
        profileComplete: true,
        onboardingCompleted: true,
        acceptTerms: true,
        acceptPrivacy: true,
        consentBackgroundCheck: true,
        approved: false,
        isApproved: false,
        canGoOnline: false,
      }),
      { merge: true },
    );
  });

  it('persists only supported app preferences behind the authenticated account API', async () => {
    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ appPreferences: { notificationsEnabled: false } }),
    });

    const response = await request(createApp())
      .patch('/api/account/preferences')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        preferences: {
          voiceGuidanceEnabled: true,
          takeRate: 99,
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.preferences).toMatchObject({
      notificationsEnabled: false,
      voiceGuidanceEnabled: true,
    });
    expect(response.body.preferences).not.toHaveProperty('takeRate');
    expect(mockUserDocSet).toHaveBeenCalledWith({
      appPreferences: expect.objectContaining({
        notificationsEnabled: false,
        voiceGuidanceEnabled: true,
        updatedAt: 'server-ts',
      }),
    }, { merge: true });
  });

  it('blocks vehicle mutations while the authenticated driver is online', async () => {
    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ uid: 'review-user', usertype: 'driver' }),
    });
    mockRedisHgetall.mockResolvedValue({ status: 'online', isOnline: 'true' });

    const response = await request(createApp())
      .post('/api/account/vehicles')
      .set('Authorization', 'Bearer firebase-token')
      .send({ vehicle: { plate: 'ABC1D23', brand: 'Nissan', model: 'Leaf', color: 'Branco', year: 2025 } });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'DRIVER_MUST_BE_OFFLINE' });
    expect(mockDatabaseUpdate).not.toHaveBeenCalled();
  });

  it('links a shared catalog vehicle to the profile without claiming global exclusivity', async () => {
    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ uid: 'review-user', usertype: 'driver' }),
    });
    mockDatabaseOnce
      .mockResolvedValueOnce({ exists: () => false, val: () => null })
      .mockResolvedValueOnce({ exists: () => true, val: () => 'shared-vehicle-1' })
      .mockResolvedValueOnce({
        exists: () => true,
        val: () => ({ plate: 'ABC1D23', brand: 'Nissan', model: 'Leaf', color: 'Branco', year: 2025 }),
      });

    const response = await request(createApp())
      .post('/api/account/vehicles')
      .set('Authorization', 'Bearer firebase-token')
      .send({ vehicle: { plate: 'ABC1D23', brand: 'Nissan', model: 'Leaf', color: 'Branco', year: 2025 } });

    expect(response.status).toBe(201);
    expect(response.body.vehicle).toMatchObject({ id: 'shared-vehicle-1', status: 'pending' });
    const updates = mockDatabaseUpdate.mock.calls[0][0];
    expect(Object.keys(updates)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^user_vehicles\/review-user\//),
    ]));
    expect(Object.keys(updates).some(path => path.startsWith('vehicles/'))).toBe(false);
    expect(Object.keys(updates).some(path => path.startsWith('vehicle_active_assignment/'))).toBe(false);
  });

  it.each([
    ['get', '/api/account/vehicles'],
    ['post', '/api/account/vehicles'],
    ['patch', '/api/account/vehicles/vehicle_1/active'],
    ['delete', '/api/account/vehicles/vehicle_1'],
  ])('requires driver role for %s %s', async (method, endpoint) => {
    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ uid: 'review-user', usertype: 'customer' }),
    });

    const operation = request(createApp())[method](endpoint)
      .set('Authorization', 'Bearer firebase-token');
    const response = method === 'post'
      ? await operation.send({ vehicle: { plate: 'ABC1D23' } })
      : await operation;

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'DRIVER_ACCOUNT_REQUIRED' });
    expect(mockDatabaseUpdate).not.toHaveBeenCalled();
  });

  it('deletes an authenticated account even when no Firestore profile exists', async () => {
    const response = await request(createApp())
      .post('/api/account/delete')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        phone: '+5521102938475',
        source: 'unit-test',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      success: true,
      deletionRequested: true,
      deleted: true,
    }));
    expect(mockUpdateUser).toHaveBeenCalledWith('review-user', { disabled: true });
    expect(mockDeleteUser).toHaveBeenCalledWith('review-user');
    expect(mockUserDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'deleted',
        accountDisabled: true,
      }),
      { merge: true }
    );
  });

  it('migrates and removes the legacy Realtime DB profile during deletion', async () => {
    mockDatabaseOnce.mockResolvedValue({
      exists: () => true,
      val: () => ({
        name: 'Leaf Passageiro Teste',
        phone: '+5521102938475',
        usertype: 'customer',
      }),
    });

    const response = await request(createApp())
      .post('/api/account/delete')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        phone: '+5521102938475',
        source: 'unit-test',
      });

    expect(response.status).toBe(200);
    expect(mockUserDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'review-user',
        name: 'Leaf Passageiro Teste',
      }),
      { merge: true }
    );
    expect(mockDatabaseRemove).toHaveBeenCalled();
  });

  it('returns success without reprocessing an account already marked deleted', async () => {
    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        status: 'deleted',
        phone: '+5521102938475',
      }),
    });

    const response = await request(createApp())
      .post('/api/account/delete')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        phone: '+5521102938475',
        source: 'unit-test',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      success: true,
      deletionRequested: true,
      deleted: true,
    }));
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });
});
