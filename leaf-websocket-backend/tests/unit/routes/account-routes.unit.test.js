jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockDeletionJobGet = jest.fn();
const mockAdminDocGet = jest.fn();
const mockAttemptSet = jest.fn();
const mockVerifyIdToken = jest.fn();
const mockUpdateUser = jest.fn();
const mockDeleteUser = jest.fn();
const mockUserDocGet = jest.fn();
const mockUserDocSet = jest.fn();
const mockCpfQueryGet = jest.fn();
const mockCpfIndexDocGet = jest.fn();
const mockCpfIndexDocSet = jest.fn();
const mockCpfTransactionGet = jest.fn();
const mockCpfTransactionSet = jest.fn();
const mockCpfReleaseQueryGet = jest.fn();
const mockCpfTransactionDelete = jest.fn();
const mockRunTransaction = jest.fn();
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
          kind: 'user',
          get: mockUserDocGet,
          set: mockUserDocSet,
        })),
        where: jest.fn(() => ({
          get: mockCpfQueryGet,
        })),
      };
    }

    if (collectionName === 'cpf_identity_index') {
      return {
        where: jest.fn(() => ({ get: mockCpfReleaseQueryGet })),
        doc: jest.fn(() => ({
          kind: 'cpf',
          get: mockCpfIndexDocGet,
          set: mockCpfIndexDocSet,
        })),
      };
    }

    if (collectionName === 'adminUsers') return { doc: () => ({ get: mockAdminDocGet }) };
    if (collectionName === 'account_deletions') {
      return {
        add: mockDeletionAdd,
        where: () => ({ get: async () => ({ docs: [] }) }),
        doc: () => ({ kind: 'job', get: mockDeletionJobGet,
          collection: () => ({ doc: () => ({ set: mockAttemptSet }) }) }),
      };
    }

    return {};
  }),
  runTransaction: mockRunTransaction,
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
      set: mockDatabaseRemove,
      transaction: async callback => {
        const value = callback(null);
        if (value === undefined) return { committed: false };
        await mockDatabaseUpdate(value);
        return { committed: true };
      },
      update: mockDatabaseUpdate,
    })),
  })),
}));

jest.mock('../../../middleware/support-auth', () => ({
  authenticateSupport: (req, res, next) => {
    if (req.headers.authorization !== 'Bearer admin-token') return res.status(401).json({ success: false });
    req.user = { id: 'admin-1', authSource: 'admin_jwt' }; next();
  }
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

function valueSnapshot(value) {
  return {
    exists: () => value !== null && value !== undefined,
    val: () => value,
  };
}

function collectionSnapshot(records = {}) {
  return {
    exists: () => Object.keys(records).length > 0,
    val: () => records,
    forEach: (callback) => Object.entries(records).some(([key, value]) => callback({
      key,
      val: () => value,
    }) === true),
  };
}

describe('account deletion route', () => {
  beforeEach(() => {
    mockDeletionJobGet.mockResolvedValue({ exists: false, data: () => undefined });
    mockAdminDocGet.mockResolvedValue({ exists: true, data: () => ({ active: true, role: 'super-admin' }) });
    mockAttemptSet.mockResolvedValue(undefined);
    mockVerifyIdToken.mockResolvedValue({
      uid: 'review-user',
      phone_number: '+5521102938475',
      email: 'review@leaf.app.br',
    });
    mockUpdateUser.mockResolvedValue(undefined);
    mockDeleteUser.mockResolvedValue(undefined);
    mockUserDocGet.mockResolvedValue({ exists: false, data: () => null });
    mockUserDocSet.mockResolvedValue(undefined);
    mockCpfReleaseQueryGet.mockResolvedValue({ docs: [] });
    mockCpfTransactionDelete.mockImplementation(() => undefined);
    mockCpfQueryGet.mockResolvedValue({ docs: [] });
    mockCpfIndexDocGet.mockResolvedValue({ exists: false, data: () => null });
    mockCpfIndexDocSet.mockResolvedValue(undefined);
    mockCpfTransactionGet.mockResolvedValue({ exists: false, data: () => null });
    mockCpfTransactionSet.mockImplementation(() => undefined);
    mockRunTransaction.mockImplementation(async callback => callback({
      delete: mockCpfTransactionDelete,
      get: ref => ref?.kind === 'user' ? mockUserDocGet() : ref?.kind === 'job' ? mockDeletionJobGet() : mockCpfTransactionGet(ref),
      set: (ref, data, options) => ref?.kind === 'user' ? mockUserDocSet(data, options) : ref?.kind === 'job' ? mockDeletionLogUpdate(data) : mockCpfTransactionSet(ref, data, options),
    }));
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

  it.each(['/api/admin/account-deletions/old/retry', '/api/admin/cpf-reviews/decision'])('rejects non-admin access to %s', async endpoint => {
    const response = await request(createApp()).post(endpoint).set('Authorization', 'Bearer firebase-token').send({});
    expect(response.status).toBe(401);
  });

  it.each([null, { active: false, role: 'super-admin' }, { active: true, role: 'support' }])('requires an active authoritative super-admin: %j', async record => {
    mockAdminDocGet.mockResolvedValue({ exists: Boolean(record), data: () => record });
    const response = await request(createApp()).post('/api/admin/account-deletions/old/retry')
      .set('Authorization', 'Bearer admin-token').send({});
    expect(response.status).toBe(403);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('fails closed if authoritative admin lookup is unavailable', async () => {
    mockAdminDocGet.mockRejectedValueOnce(new Error('unavailable'));
    const response = await request(createApp()).post('/api/admin/cpf-reviews/decision')
      .set('Authorization', 'Bearer admin-token').send({});
    expect(response.status).toBe(503);
  });

  it('requires an existing deletion job for administrative recovery', async () => {
    const response = await request(createApp()).post('/api/admin/account-deletions/old/retry')
      .set('Authorization', 'Bearer admin-token').send({});
    expect(response.status).toBe(404);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('recovers a pending deletion using admin identity, without target-user authentication', async () => {
    mockDeletionJobGet.mockResolvedValue({ exists: true, data: () => ({ status: 'error', reason: 'requested' }) });
    mockUserDocGet.mockResolvedValue({ exists: true, data: () => ({ status: 'deletion_pending' }) });
    const response = await request(createApp()).post('/api/admin/account-deletions/old/retry')
      .set('Authorization', 'Bearer admin-token').send({});
    expect(response.status).toBe(200);
    expect(mockUpdateUser).toHaveBeenCalledWith('old', { disabled: true });
    expect(mockAttemptSet).toHaveBeenCalledWith(expect.objectContaining({ actor: 'admin-1', source: 'admin_recovery' }));
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
        cpf: '12345678909',
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
        cpf: '123.456.789-09',
        cpfNormalized: '12345678909',
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

  it('requires a CPF when a new driver profile is completed', async () => {
    const response = await request(createApp())
      .put('/api/account/profile')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        name: 'Motorista sem CPF',
        usertype: 'driver',
        acceptTerms: true,
        acceptPrivacy: true,
        consentBackgroundCheck: true,
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      code: 'PROFILE_CPF_REQUIRED',
    });
    expect(mockUserDocSet).not.toHaveBeenCalled();
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it('rejects a CPF already claimed by another profile', async () => {
    mockCpfQueryGet.mockResolvedValue({ docs: [{ id: 'another-user' }] });

    const response = await request(createApp())
      .put('/api/account/profile')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        name: 'Motorista duplicado',
        usertype: 'driver',
        cpf: '12345678909',
        acceptTerms: true,
        acceptPrivacy: true,
        consentBackgroundCheck: true,
      });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      code: 'PROFILE_CPF_ALREADY_REGISTERED',
    });
    expect(mockUserDocSet).not.toHaveBeenCalled();
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it('rejects an invalid CPF before writing the profile', async () => {
    const response = await request(createApp())
      .put('/api/account/profile')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        name: 'Motorista inválido',
        usertype: 'driver',
        cpf: '11111111111',
        acceptTerms: true,
        acceptPrivacy: true,
        consentBackgroundCheck: true,
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      code: 'PROFILE_CPF_INVALID',
    });
    expect(mockUserDocSet).not.toHaveBeenCalled();
    expect(mockRunTransaction).not.toHaveBeenCalled();
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
        cpf: '12345678909',
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

  it('edits only the authenticated profile link and resets vehicle approval', async () => {
    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ uid: 'review-user', usertype: 'driver' }),
    });
    mockDatabaseOnce
      .mockResolvedValueOnce(collectionSnapshot({
        link_1: {
          id: 'link_1',
          userId: 'review-user',
          vehicleId: 'shared-vehicle-1',
          status: 'approved',
          approved: true,
          isActive: true,
        },
      }))
      .mockResolvedValueOnce(valueSnapshot({
        plate: 'ABC1D23',
        brand: 'Nissan',
        model: 'Leaf',
        color: 'Branco',
        year: 2025,
      }));

    const response = await request(createApp())
      .patch('/api/account/vehicles/shared-vehicle-1')
      .set('Authorization', 'Bearer firebase-token')
      .send({ vehicle: { plate: 'ABC1D23', brand: 'Nissan', model: 'Leaf Plus', color: 'Prata', year: 2025 } });

    expect(response.status).toBe(200);
    expect(response.body.vehicle).toMatchObject({
      vehicleId: 'shared-vehicle-1',
      userVehicleId: 'link_1',
      status: 'pending',
      approved: false,
      isActive: false,
    });
    const updates = mockDatabaseUpdate.mock.calls[0][0];
    expect(updates).toEqual(expect.objectContaining({
      'user_vehicles/review-user/link_1/vehicleId': 'shared-vehicle-1',
      'user_vehicles/review-user/link_1/model': 'Leaf Plus',
      'user_vehicles/review-user/link_1/status': 'pending',
      'user_vehicles/review-user/link_1/approved': false,
      'user_vehicles/review-user/link_1/isActive': false,
      'users/review-user/activeVehicleId': '',
    }));
    expect(Object.keys(updates).some(path => path.startsWith('vehicles/'))).toBe(false);
    expect(Object.keys(updates).some(path => path.startsWith('vehicle_plate_index/'))).toBe(false);
    expect(mockRedisDel).toHaveBeenCalledWith('driver_eligibility_profile:review-user');
  });

  it('does not attach an edited plate to an unverified global catalog record', async () => {
    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ uid: 'review-user', usertype: 'driver' }),
    });
    mockDatabaseOnce
      .mockResolvedValueOnce(collectionSnapshot({
        link_1: {
          id: 'link_1',
          userId: 'review-user',
          vehicleId: 'shared-vehicle-1',
          status: 'approved',
          approved: true,
          isActive: false,
        },
      }))
      .mockResolvedValueOnce(valueSnapshot({ plate: 'ABC1D23' }))
      .mockResolvedValueOnce(valueSnapshot(null))
      .mockResolvedValueOnce(valueSnapshot(null));

    const response = await request(createApp())
      .patch('/api/account/vehicles/link_1')
      .set('Authorization', 'Bearer firebase-token')
      .send({ vehicle: { plate: 'DEF4G56', brand: 'Honda', model: 'City', color: 'Prata', year: 2024 } });

    expect(response.status).toBe(200);
    const updates = mockDatabaseUpdate.mock.calls[0][0];
    expect(updates['user_vehicles/review-user/link_1/vehicleId']).toBeNull();
    expect(updates['user_vehicles/review-user/link_1/plate']).toBe('DEF4G56');
    expect(Object.keys(updates).some(path => path.startsWith('vehicles/'))).toBe(false);
    expect(Object.keys(updates).some(path => path.startsWith('vehicle_plate_index/'))).toBe(false);
  });

  it('lists a pending profile submission even before CRLV creates its canonical catalog record', async () => {
    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ uid: 'review-user', usertype: 'driver' }),
    });
    mockDatabaseOnce.mockResolvedValueOnce(collectionSnapshot({
      link_1: {
        id: 'link_1',
        userId: 'review-user',
        status: 'pending',
        approved: false,
        isActive: false,
        plate: 'DEF4G56',
        brand: 'Honda',
        model: 'City',
        color: 'Prata',
        year: 2024,
      },
    }));

    const response = await request(createApp())
      .get('/api/account/vehicles')
      .set('Authorization', 'Bearer firebase-token');

    expect(response.status).toBe(200);
    expect(response.body.vehicles).toEqual([
      expect.objectContaining({
        id: 'link_1',
        vehicleId: null,
        userVehicleId: 'link_1',
        plate: 'DEF4G56',
        model: 'City',
        status: 'pending',
      }),
    ]);
  });

  it('blocks selecting a vehicle until the administrative approval is complete', async () => {
    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ uid: 'review-user', usertype: 'driver' }),
    });
    mockDatabaseOnce.mockResolvedValueOnce(collectionSnapshot({
      link_1: {
        id: 'link_1',
        userId: 'review-user',
        vehicleId: 'vehicle_1',
        status: 'pending',
        approved: false,
        isActive: false,
      },
    }));

    const response = await request(createApp())
      .patch('/api/account/vehicles/vehicle_1/active')
      .set('Authorization', 'Bearer firebase-token');

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'VEHICLE_APPROVAL_REQUIRED' });
    expect(mockDatabaseUpdate).not.toHaveBeenCalled();
  });

  it('blocks selecting an approved link without a canonical CRLV vehicle identity', async () => {
    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ uid: 'review-user', usertype: 'driver' }),
    });
    mockDatabaseOnce.mockResolvedValueOnce(collectionSnapshot({
      link_1: {
        id: 'link_1',
        userId: 'review-user',
        status: 'approved',
        approved: true,
        isActive: false,
      },
    }));

    const response = await request(createApp())
      .patch('/api/account/vehicles/link_1/active')
      .set('Authorization', 'Bearer firebase-token');

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'VEHICLE_CANONICAL_IDENTITY_REQUIRED' });
    expect(mockDatabaseUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['get', '/api/account/vehicles'],
    ['post', '/api/account/vehicles'],
    ['patch', '/api/account/vehicles/vehicle_1'],
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

  it('purges both CPF representations when deleting an authenticated profile', async () => {
    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        uid: 'review-user',
        usertype: 'customer',
        cpf: '123.456.789-09',
        cpfNormalized: '12345678909',
      }),
    });
    const response = await request(createApp())
      .post('/api/account/delete')
      .set('Authorization', 'Bearer firebase-token')
      .send({ source: 'unit-test' });

    expect(response.status).toBe(200);
    expect(mockUserDocSet).toHaveBeenCalledWith(
      expect.objectContaining({ cpf: 'field-delete', cpfNormalized: 'field-delete' }),
      { merge: true }
    );
  });

  it('releases the owned index after removing the legacy profile and Auth user', async () => {
    const ref = { id: 'cpf-index' };
    mockCpfReleaseQueryGet.mockResolvedValue({ docs: [{ ref }] });
    mockCpfTransactionGet.mockResolvedValue({ exists: true, data: () => ({ uid: 'review-user' }) });
    const response = await request(createApp()).post('/api/account/delete')
      .set('Authorization', 'Bearer firebase-token').send({});
    expect(response.status).toBe(200);
    expect(mockCpfTransactionDelete).toHaveBeenCalledWith(ref);
    expect(mockDatabaseRemove.mock.invocationCallOrder[0]).toBeLessThan(mockCpfReleaseQueryGet.mock.invocationCallOrder[0]);
    expect(mockDeleteUser.mock.invocationCallOrder[0]).toBeLessThan(mockCpfReleaseQueryGet.mock.invocationCallOrder[0]);
  });

  it('does not release CPF or report success when RTDB cleanup fails', async () => {
    mockDatabaseRemove.mockRejectedValueOnce(new Error('RTDB unavailable'));
    const response = await request(createApp()).post('/api/account/delete')
      .set('Authorization', 'Bearer firebase-token').send({});
    expect(response.status).toBe(500);
    expect(mockCpfReleaseQueryGet).not.toHaveBeenCalled();
    expect(mockUserDocSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'deletion_pending', accountDisabled: true
    }), { merge: true });
  });

  it('retries index cleanup after a partial purge, even without CPF or an Auth user', async () => {
    mockUserDocGet.mockResolvedValue({ exists: true, data: () => ({ status: 'deleted' }) });
    mockUpdateUser.mockRejectedValueOnce({ code: 'auth/user-not-found' });
    mockDeleteUser.mockRejectedValueOnce({ code: 'auth/user-not-found' });
    const response = await request(createApp()).post('/api/account/delete')
      .set('Authorization', 'Bearer firebase-token').send({});
    expect(response.status).toBe(200);
    expect(mockCpfReleaseQueryGet).toHaveBeenCalled();
  });

  it('does not report completion when the index lookup fails', async () => {
    mockCpfReleaseQueryGet.mockRejectedValueOnce(new Error('Firestore unavailable'));
    const response = await request(createApp()).post('/api/account/delete')
      .set('Authorization', 'Bearer firebase-token').send({});
    expect(response.status).toBe(500);
    expect(mockDeletionLogUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
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

  it('returns success without reprocessing a completed deletion job', async () => {
    mockDeletionJobGet.mockResolvedValue({ exists: true, data: () => ({ status: 'completed' }) });
    mockUserDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        status: 'deleted',
        cpfIndexReleased: true,
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
