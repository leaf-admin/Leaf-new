const { verifyFirebaseIdToken, forgetAccountStatus, STATUS_TTL_MS } = require('../../../utils/firebase-id-token');

function fakeAuth({ user = {}, getUserError = null, uid = 'user_1', authTime = 1000 } = {}) {
  return {
    verifyIdToken: jest.fn(async () => ({ uid, auth_time: authTime })),
    getUser: jest.fn(async () => {
      if (getUserError) throw getUserError;
      return { disabled: false, tokensValidAfterTime: null, ...user };
    })
  };
}

describe('verifyFirebaseIdToken', () => {
  let uidSeq = 0;
  const nextUid = () => `user_${(uidSeq += 1)}`;

  it('accepts an active account', async () => {
    const auth = fakeAuth({ uid: nextUid() });
    await expect(verifyFirebaseIdToken(auth, 't')).resolves.toMatchObject({ auth_time: 1000 });
  });

  it('rejects a disabled account', async () => {
    const auth = fakeAuth({ uid: nextUid(), user: { disabled: true } });
    await expect(verifyFirebaseIdToken(auth, 't')).rejects.toMatchObject({ code: 'auth/user-disabled' });
  });

  it('rejects a token issued before the sessions were revoked', async () => {
    const auth = fakeAuth({ uid: nextUid(), authTime: 1000, user: { tokensValidAfterTime: new Date(2000 * 1000).toUTCString() } });
    await expect(verifyFirebaseIdToken(auth, 't')).rejects.toMatchObject({ code: 'auth/id-token-revoked' });
  });

  it('accepts a token issued after the revocation', async () => {
    const auth = fakeAuth({ uid: nextUid(), authTime: 3000, user: { tokensValidAfterTime: new Date(2000 * 1000).toUTCString() } });
    await expect(verifyFirebaseIdToken(auth, 't')).resolves.toBeTruthy();
  });

  it('rejects a deleted account', async () => {
    const auth = fakeAuth({ uid: nextUid(), getUserError: Object.assign(new Error('x'), { code: 'auth/user-not-found' }) });
    await expect(verifyFirebaseIdToken(auth, 't')).rejects.toMatchObject({ code: 'auth/user-not-found' });
  });

  it('keeps serving on the signed token when the Auth API is down', async () => {
    const auth = fakeAuth({ uid: nextUid(), getUserError: Object.assign(new Error('timeout'), { code: 'app/network-error' }) });
    await expect(verifyFirebaseIdToken(auth, 't')).resolves.toBeTruthy();
  });

  it('caches the account status per uid for a short time', async () => {
    const uid = nextUid();
    const auth = fakeAuth({ uid });
    await verifyFirebaseIdToken(auth, 't', { nowMs: 10 });
    await verifyFirebaseIdToken(auth, 't', { nowMs: 10 + STATUS_TTL_MS - 1 });
    expect(auth.getUser).toHaveBeenCalledTimes(1);
    await verifyFirebaseIdToken(auth, 't', { nowMs: 10 + STATUS_TTL_MS + 1 });
    expect(auth.getUser).toHaveBeenCalledTimes(2);
    forgetAccountStatus(uid);
    await verifyFirebaseIdToken(auth, 't', { nowMs: 10 + STATUS_TTL_MS + 2 });
    expect(auth.getUser).toHaveBeenCalledTimes(3);
  });

  it('propagates an invalid token without calling the Auth API', async () => {
    const auth = fakeAuth();
    auth.verifyIdToken.mockRejectedValueOnce(Object.assign(new Error('bad'), { code: 'auth/argument-error' }));
    await expect(verifyFirebaseIdToken(auth, 't')).rejects.toMatchObject({ code: 'auth/argument-error' });
    expect(auth.getUser).not.toHaveBeenCalled();
  });
});
