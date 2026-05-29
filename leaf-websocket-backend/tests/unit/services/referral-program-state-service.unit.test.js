jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => null),
  getRealtimeDB: jest.fn(() => null)
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const firebaseConfig = require('../../../firebase-config');
const referralProgramStateService = require('../../../services/referral-program-state-service');

function createInMemoryFirestore() {
  const docs = new Map();

  const writeDoc = (ref, data, options = {}) => {
    const previous = docs.get(ref.path) || {};
    docs.set(ref.path, options.merge ? { ...previous, ...data } : { ...data });
  };

  const makeSnapshot = (rows) => ({
    empty: rows.length === 0,
    size: rows.length,
    docs: rows.map(([path, data]) => ({
      id: path.split('/').pop(),
      data: () => data
    }))
  });

  const doc = (path) => ({
    path,
    id: path.split('/').pop(),
    get: async () => ({
      exists: docs.has(path),
      data: () => docs.get(path)
    }),
    set: async (data, options) => writeDoc({ path }, data, options)
  });

  const collection = (path) => {
    const queryState = { filters: [], limitValue: null };
    const queryApi = {
      doc: (id = `auto_${docs.size + 1}`) => doc(`${path}/${id}`),
      where: (field, operator, expected) => {
        queryState.filters.push({ field, operator, expected });
        return queryApi;
      },
      limit: (value) => {
        queryState.limitValue = value;
        return queryApi;
      },
      get: async () => {
        let rows = Array.from(docs.entries()).filter(([docPath]) => docPath.startsWith(`${path}/`));
        queryState.filters.forEach(({ field, operator, expected }) => {
          if (operator !== '==') return;
          rows = rows.filter(([, data]) => data?.[field] === expected);
        });
        if (Number.isFinite(queryState.limitValue)) {
          rows = rows.slice(0, queryState.limitValue);
        }
        return makeSnapshot(rows);
      }
    };
    return queryApi;
  };

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

function resetServiceWithFirestore(firestore) {
  firebaseConfig.getFirestore.mockReturnValue(firestore);
  firebaseConfig.getRealtimeDB.mockReturnValue(null);
  referralProgramStateService.firestore = null;
  referralProgramStateService.legacyDb = null;
}

describe('referral-program-state-service production guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates invite and code index atomically, rejecting duplicate codes', async () => {
    const firestore = createInMemoryFirestore();
    resetServiceWithFirestore(firestore);

    const invite = await referralProgramStateService.createInviteWithUniqueCode({
      id: 'invite_1',
      code: 'PSG-UNIQUE',
      type: 'passenger_referral',
      status: 'pending',
      inviterId: 'user_1',
      inviteePhone: '+5521999999999',
      expiresAt: '2030-01-01T00:00:00.000Z'
    });

    expect(invite).toMatchObject({
      id: 'invite_1',
      code: 'PSG-UNIQUE',
      status: 'pending'
    });
    expect(firestore.docs.get('referral_invites/invite_1')).toMatchObject({
      code: 'PSG-UNIQUE'
    });
    expect(firestore.docs.get('referral_invite_codes/PSG-UNIQUE')).toMatchObject({
      inviteId: 'invite_1',
      status: 'pending'
    });

    await expect(referralProgramStateService.createInviteWithUniqueCode({
      id: 'invite_2',
      code: 'PSG-UNIQUE',
      type: 'passenger_referral',
      status: 'pending',
      inviterId: 'user_1'
    })).rejects.toMatchObject({
      code: 'INVITE_CODE_ALREADY_EXISTS',
      statusCode: 409
    });
  });

  it('accepts an invite once and updates the code index in the same transaction', async () => {
    const firestore = createInMemoryFirestore();
    resetServiceWithFirestore(firestore);

    await referralProgramStateService.createInviteWithUniqueCode({
      id: 'invite_driver',
      code: 'DRV-OK',
      type: 'driver_referral',
      status: 'pending',
      inviterId: 'driver_1',
      inviteePhone: '+5521999999999',
      expiresAt: '2030-01-01T00:00:00.000Z'
    });

    const accepted = await referralProgramStateService.acceptInvite(
      'invite_driver',
      {
        acceptedBy: 'driver_2',
        acceptedAt: '2026-05-26T00:00:00.000Z'
      },
      { expectedCode: 'DRV-OK' }
    );

    expect(accepted).toMatchObject({
      id: 'invite_driver',
      status: 'accepted',
      acceptedBy: 'driver_2'
    });
    expect(firestore.docs.get('referral_invite_codes/DRV-OK')).toMatchObject({
      status: 'accepted',
      acceptedBy: 'driver_2'
    });

    await expect(referralProgramStateService.acceptInvite(
      'invite_driver',
      { acceptedBy: 'driver_3' },
      { expectedCode: 'DRV-OK' }
    )).rejects.toMatchObject({
      code: 'INVITE_NOT_PENDING',
      statusCode: 409
    });
  });

  it('rejects expired invites before acceptance', async () => {
    const firestore = createInMemoryFirestore();
    resetServiceWithFirestore(firestore);

    await referralProgramStateService.createInviteWithUniqueCode({
      id: 'invite_expired',
      code: 'PSG-OLD',
      type: 'passenger_referral',
      status: 'pending',
      inviterId: 'user_1',
      inviteePhone: '+5521999999999',
      expiresAt: '2020-01-01T00:00:00.000Z'
    });

    await expect(referralProgramStateService.acceptInvite(
      'invite_expired',
      { acceptedBy: 'user_2' },
      { expectedCode: 'PSG-OLD' }
    )).rejects.toMatchObject({
      code: 'INVITE_EXPIRED',
      statusCode: 410
    });
  });
});
