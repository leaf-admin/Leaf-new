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
        onboardingCompleted: true,
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
        onboardingCompleted: true,
      }),
      { merge: true },
    );
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
