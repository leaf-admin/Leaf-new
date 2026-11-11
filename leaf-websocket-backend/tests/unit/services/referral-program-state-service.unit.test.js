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
  referralProgramStateService.firestore = null;
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

  it('keeps one personal code per owner and skips codes already in use', async () => {
    const firestore = createInMemoryFirestore();
    resetServiceWithFirestore(firestore);
    firestore.docs.set('referral_invite_codes/TAKEN2', { code: 'TAKEN2' });

    const candidates = ['TAKEN2', 'FRESH3', 'OTHER4'];
    const generator = jest.fn(() => candidates.shift());

    const first = await referralProgramStateService.ensurePersonalCode('owner_1', generator);
    expect(first).toMatchObject({ code: 'FRESH3', ownerId: 'owner_1', shareCount: 0, acceptedCount: 0 });

    const again = await referralProgramStateService.ensurePersonalCode('owner_1', () => 'NEWONE');
    expect(again.code).toBe('FRESH3');
    expect(firestore.docs.has('referral_personal_codes/NEWONE')).toBe(false);
  });

  it('counts shares and accepts each invitee once through a personal code', async () => {
    const firestore = createInMemoryFirestore();
    resetServiceWithFirestore(firestore);
    await referralProgramStateService.ensurePersonalCode('owner_1', () => 'K7M2QX');

    await referralProgramStateService.recordPersonalCodeShare('K7M2QX', 'owner_1');
    await expect(referralProgramStateService.recordPersonalCodeShare('K7M2QX', 'intruder'))
      .rejects.toMatchObject({ code: 'PERSONAL_CODE_FORBIDDEN' });

    const invite = await referralProgramStateService.acceptPersonalCode('K7M2QX', 'friend_1', { campaignId: 'camp_1' });
    expect(invite).toMatchObject({
      id: 'personal_K7M2QX_friend_1',
      personalCode: 'K7M2QX',
      inviterId: 'owner_1',
      acceptedBy: 'friend_1',
      status: 'accepted',
      campaignId: 'camp_1'
    });
    await referralProgramStateService.acceptPersonalCode('K7M2QX', 'friend_2');

    await expect(referralProgramStateService.acceptPersonalCode('K7M2QX', 'friend_1'))
      .rejects.toMatchObject({ code: 'PERSONAL_CODE_ALREADY_ACCEPTED', statusCode: 409 });
    await expect(referralProgramStateService.acceptPersonalCode('K7M2QX', 'owner_1'))
      .rejects.toMatchObject({ code: 'PERSONAL_CODE_SELF' });

    expect(await referralProgramStateService.findPersonalCode('k7m2qx')).toMatchObject({
      shareCount: 1,
      acceptedCount: 2
    });
  });

  it('counts visits only on group links and keeps their name and channel', async () => {
    const firestore = createInMemoryFirestore();
    resetServiceWithFirestore(firestore);
    await referralProgramStateService.ensurePersonalCode('leaf-source:facebook_group:motoristas-rio', () => 'GRP4ZA', {
      sourceFields: { sourceKind: 'group', label: 'Motoristas Rio', channel: 'facebook_group', createdBy: 'admin_1', visitCount: 0 }
    });
    await referralProgramStateService.ensurePersonalCode('owner_1', () => 'K7M2QX');

    await referralProgramStateService.recordSourceCodeVisit('grp4za');
    await referralProgramStateService.recordSourceCodeVisit('GRP4ZA');
    expect(await referralProgramStateService.recordSourceCodeVisit('K7M2QX')).toBeNull();
    expect(await referralProgramStateService.recordSourceCodeVisit('NOPE22')).toBeNull();

    expect(await referralProgramStateService.findPersonalCode('GRP4ZA')).toMatchObject({
      sourceKind: 'group', label: 'Motoristas Rio', channel: 'facebook_group', visitCount: 2
    });
    expect(await referralProgramStateService.findPersonalCode('K7M2QX')).toMatchObject({ sourceKind: null, visitCount: 0 });
  });
});
