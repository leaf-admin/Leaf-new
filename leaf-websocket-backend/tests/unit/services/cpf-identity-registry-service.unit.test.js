const {
  claimCpf,
  releaseCpfsForDeletedAccount,
  normalizeCpf,
  CpfIdentityError
} = require('../../../services/cpf-identity-registry-service');

function createFirestoreMock({ userIds = [], indexedOwnerId = '' } = {}) {
  const writes = [];
  const userQuery = {
    get: jest.fn(async () => ({
      docs: userIds.map((id) => ({ id }))
    }))
  };
  const indexSnapshot = {
    exists: Boolean(indexedOwnerId),
    data: () => indexedOwnerId ? { uid: indexedOwnerId } : null
  };
  const indexRef = { id: '12345678909' };

  return {
    writes,
    collection: jest.fn((name) => {
      if (name === 'users') {
        return {
          doc: () => ({ kind: 'user' }),
          where: jest.fn(() => userQuery)
        };
      }

      return {
        doc: jest.fn(() => indexRef)
      };
    }),
    runTransaction: jest.fn(async (callback) => callback({
      get: jest.fn(async ref => ref.kind === 'user' ? ({ exists: false }) : indexSnapshot),
      set: jest.fn((ref, value, options) => writes.push({ ref, value, options }))
    }))
  };
}

describe('cpf identity registry', () => {
  test('normalizes and validates a Brazilian CPF', () => {
    expect(normalizeCpf('123.456.789-09')).toEqual({
      digits: '12345678909',
      formatted: '123.456.789-09'
    });
  });

  test('rejects malformed or invalid CPFs', () => {
    expect(() => normalizeCpf('11111111111')).toThrow(CpfIdentityError);
    expect(() => normalizeCpf('11111111111')).toThrow(
      expect.objectContaining({ code: 'PROFILE_CPF_INVALID' })
    );
  });

  test('claims a normalized CPF through a deterministic transaction index', async () => {
    const firestore = createFirestoreMock();

    await expect(claimCpf({
      firestore,
      userId: 'driver_1',
      cpf: '123.456.789-09'
    })).resolves.toEqual({
      digits: '12345678909',
      formatted: '123.456.789-09'
    });

    expect(firestore.runTransaction).toHaveBeenCalledTimes(1);
    expect(firestore.writes[0].value).toEqual(expect.objectContaining({
      uid: 'driver_1',
      cpfNormalized: '12345678909'
    }));
  });

  test('rejects a legacy profile that already owns the CPF', async () => {
    const firestore = createFirestoreMock({ userIds: ['driver_other'] });

    await expect(claimCpf({
      firestore,
      userId: 'driver_1',
      cpf: '12345678909'
    })).rejects.toMatchObject({
      code: 'PROFILE_CPF_ALREADY_REGISTERED',
      status: 409
    });
    expect(firestore.runTransaction).not.toHaveBeenCalled();
  });

  test('rejects an index collision even when the legacy query is empty', async () => {
    const firestore = createFirestoreMock({ indexedOwnerId: 'driver_other' });

    await expect(claimCpf({
      firestore,
      userId: 'driver_1',
      cpf: '12345678909'
    })).rejects.toMatchObject({
      code: 'PROFILE_CPF_ALREADY_REGISTERED',
      status: 409
    });
  });

  test('reports transaction outages as retryable unavailability without exposing provider errors', async () => {
    const firestore = createFirestoreMock();
    firestore.runTransaction.mockRejectedValue(new Error('internal provider failure'));
    await expect(claimCpf({ firestore, userId: 'driver_1', cpf: '12345678909' }))
      .rejects.toMatchObject({
        code: 'PROFILE_CPF_UNIQUENESS_UNAVAILABLE',
        status: 503,
        message: 'Não foi possível confirmar o CPF agora. Tente novamente.'
      });
    expect(firestore.writes).toEqual([]);
  });

  test('allows the same owner to retry an existing CPF claim', async () => {
    const firestore = createFirestoreMock({ userIds: ['driver_1'], indexedOwnerId: 'driver_1' });
    await expect(claimCpf({ firestore, userId: 'driver_1', cpf: '12345678909' }))
      .resolves.toMatchObject({ digits: '12345678909' });
  });

  test('rejects a CPF owned only by a legacy RTDB profile', async () => {
    const firestore = createFirestoreMock();
    const once = jest.fn().mockResolvedValue({
      val: () => ({ legacy_driver: { cpf: '123.456.789-09' } })
    });
    const realtimeDb = { ref: () => ({ orderByChild: () => ({ equalTo: () => ({ once }) }) }) };
    await expect(claimCpf({ firestore, realtimeDb, userId: 'driver_1', cpf: '12345678909' }))
      .rejects.toMatchObject({ code: 'PROFILE_CPF_ALREADY_REGISTERED', status: 409 });
    expect(firestore.runTransaction).not.toHaveBeenCalled();
  });

  test('does not claim a CPF when the legacy RTDB lookup fails', async () => {
    const firestore = createFirestoreMock();
    const once = jest.fn().mockRejectedValue(new Error('lookup unavailable'));
    const realtimeDb = { ref: () => ({ orderByChild: () => ({ equalTo: () => ({ once }) }) }) };
    await expect(claimCpf({ firestore, realtimeDb, userId: 'driver_1', cpf: '12345678909' }))
      .rejects.toMatchObject({ code: 'PROFILE_CPF_UNIQUENESS_UNAVAILABLE', status: 503 });
    expect(firestore.runTransaction).not.toHaveBeenCalled();
  });
});

describe('CPF release after deletion', () => {
  test.each(['old-user', 'new-user', null])('checks current ownership transactionally: %s', async (owner) => {
    const ref = { id: 'index' };
    const remove = jest.fn();
    const firestore = {
      collection: jest.fn(() => ({ where: jest.fn(() => ({ get: async () => ({ docs: [{ ref }] }) })) })),
      runTransaction: async (callback) => callback({
        get: async () => ({ exists: owner !== null, data: () => ({ uid: owner }) }),
        delete: remove
      })
    };
    await releaseCpfsForDeletedAccount({ firestore, userId: 'old-user' });
    expect(remove).toHaveBeenCalledTimes(owner === 'old-user' ? 1 : 0);
  });

  test('rejects missing UID without querying the index', async () => {
    const firestore = { collection: jest.fn() };
    await expect(releaseCpfsForDeletedAccount({ firestore, userId: '' })).rejects.toThrow();
    expect(firestore.collection).not.toHaveBeenCalled();
  });
});

test('a fresh UID can claim the CPF after deletion releases the former owner', async () => {
  let index = { uid: 'old-user' };
  const ref = { id: '12345678909' };
  const firestore = {
    collection: (name) => ({
      doc: () => name === 'users' ? ({ kind: 'user' }) : ref,
      where: () => ({ get: async () => ({
        docs: name === 'users' || !index ? [] : [{ ref }]
      }) })
    }),
    runTransaction: async (callback) => callback({
      get: async ref => ref.kind === 'user' ? ({ exists: false }) : ({ exists: Boolean(index), data: () => index }),
      delete: () => { index = null; },
      set: (_, value) => { index = value; }
    })
  };
  await releaseCpfsForDeletedAccount({ firestore, userId: 'old-user' });
  await releaseCpfsForDeletedAccount({ firestore, userId: 'old-user' });
  await claimCpf({ firestore, userId: 'new-user', cpf: '12345678909' });
  expect(index.uid).toBe('new-user');
  await expect(claimCpf({ firestore, userId: 'third-user', cpf: '12345678909' }))
    .rejects.toMatchObject({ code: 'PROFILE_CPF_ALREADY_REGISTERED' });
});
