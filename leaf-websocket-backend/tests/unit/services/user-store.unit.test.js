const { createTreeFirestore } = require('../../helpers/rtdb-tree-firestore');
const userStore = require('../../../services/user-store');

// The emulator run (scripts/benchmark/user-store-diff.cjs) proves parity with
// the RTDB router; this covers creating a brand-new account record.
describe('user-store createUserIfMissing', () => {
  it('creates users/{uid} only when the record does not exist', async () => {
    const state = { users: { existing: { usertype: 'driver', name: 'Ana' } } };
    const firestore = createTreeFirestore(state);

    await expect(userStore.createUserIfMissing(firestore, 'fresh', { uid: 'fresh', usertype: 'customer', optional: null }))
      .resolves.toEqual({ created: true, value: { uid: 'fresh', usertype: 'customer' } });
    expect(state.users.fresh).toEqual({ uid: 'fresh', usertype: 'customer' });

    await expect(userStore.createUserIfMissing(firestore, 'existing', { uid: 'existing', usertype: 'customer' }))
      .resolves.toEqual({ created: false, value: { usertype: 'driver', name: 'Ana' } });
    expect(state.users.existing).toEqual({ usertype: 'driver', name: 'Ana' });
  });

  it('refuses an empty profile', async () => {
    const firestore = createTreeFirestore({ users: {} });
    await expect(userStore.createUserIfMissing(firestore, 'u1', null)).rejects.toMatchObject({ code: 'USER_STORE_INVALID_PROFILE' });
  });
});

describe('user-store listUsers / queryUsers', () => {
  const { Timestamp } = require('@google-cloud/firestore');
  const users = {
    d1: { usertype: 'driver', approvedAt: Timestamp.fromMillis(Date.UTC(2026, 9, 1)), note: null },
    c1: { usertype: 'customer' }
  };
  function fakeFirestore(calls) {
    const query = (filters, limit) => ({
      where: (field, op, value) => query([...filters, [field, op, value]], limit),
      limit: (count) => query(filters, count),
      get: async () => {
        calls.push({ filters, limit });
        const docs = Object.entries(users)
          .filter(([, data]) => filters.every(([field, , value]) => data[field] === value))
          .slice(0, limit ?? Infinity)
          .map(([id, data]) => ({ id, data: () => data }));
        return { docs };
      }
    });
    return { collection: (name) => (name === 'users' ? query([], undefined) : null) };
  }

  it('lists every user in the record view, bounded by limit', async () => {
    const calls = [];
    const firestore = fakeFirestore(calls);
    await expect(userStore.listUsers(firestore)).resolves.toEqual({
      d1: { usertype: 'driver', approvedAt: '2026-10-01T00:00:00.000Z' },
      c1: { usertype: 'customer' }
    });
    await expect(userStore.listUsers(firestore, { limit: 1 })).resolves.toEqual({
      d1: { usertype: 'driver', approvedAt: '2026-10-01T00:00:00.000Z' }
    });
    expect(calls).toEqual([{ filters: [], limit: undefined }, { filters: [], limit: 1 }]);
  });

  it('queries one top-level field by equality', async () => {
    const calls = [];
    await expect(userStore.queryUsers(fakeFirestore(calls), 'usertype', 'customer', { limit: 201 }))
      .resolves.toEqual({ c1: { usertype: 'customer' } });
    expect(calls).toEqual([{ filters: [['usertype', '==', 'customer']], limit: 201 }]);
  });

  it('refuses to scan without Firestore', async () => {
    await expect(userStore.listUsers(null)).rejects.toMatchObject({ code: 'USER_STORE_UNAVAILABLE' });
  });
});
