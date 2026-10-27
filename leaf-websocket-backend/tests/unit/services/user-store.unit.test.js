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
