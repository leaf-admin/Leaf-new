jest.mock('firebase-admin', () => ({ firestore: Object.assign(jest.fn(), { FieldValue: { serverTimestamp: () => 'server-time' } }) }));
const { memoryFirestore } = require('../helpers/lifecycle-memory.cjs');
const { runAccountDeletion, saveAccountProfile, projectRealtimeProfile } = require('../../../services/account-lifecycle-service');
const { claimCpf, releaseCpfsForDeletedAccount } = require('../../../services/cpf-identity-registry-service');

function fixture() {
  const firestore = memoryFirestore({ 'users/old': { status: 'active' },
    'cpf_identity_index/12345678909': { uid: 'old' } });
  let realtime = { cpf: '12345678909' };
  const ref = { set: jest.fn(async value => { realtime = value; }),
    transaction: async callback => { const value = callback(realtime);
      if (value === undefined) return { committed: false };
      realtime = value; return { committed: true }; } };
  const db = { ref: () => ref };
  const auth = { updateUser: jest.fn().mockResolvedValue(), deleteUser: jest.fn().mockResolvedValue() };
  const options = { firestore, db, auth, userId: 'old', metadata: { reason: 'user_request' },
    purge: { status: 'deleted', accountDisabled: true }, releaseCpf: releaseCpfsForDeletedAccount };
  return { firestore, ref, db, auth, options, getRealtime: () => realtime };
}

test.each(['profile-first', 'delete-first'])('concurrent profile/CPF writes cannot resurrect deletion: %s', async order => {
  const f = fixture();
  const profile = () => claimCpf({ firestore: f.firestore, userId: 'old', cpf: '12345678909', profile: { name: 'late', status: 'active' } });
  const deletion = () => runAccountDeletion(f.options);
  const tasks = order === 'profile-first' ? [profile(), deletion()] : [deletion(), profile()];
  await Promise.allSettled(tasks);
  expect(f.firestore.records.get('users/old')).toMatchObject({ status: 'deleted', accountDisabled: true });
  expect(f.firestore.records.has('cpf_identity_index/12345678909')).toBe(false);
  await expect(saveAccountProfile({ firestore: f.firestore, userId: 'old', profile: { status: 'active' } }))
    .rejects.toMatchObject({ code: 'ACCOUNT_DELETION_IN_PROGRESS' });
  await expect(profile()).rejects.toMatchObject({ code: 'ACCOUNT_DELETION_IN_PROGRESS' });
  await expect(projectRealtimeProfile('old', { cpf: '12345678909' }, f.db)).rejects.toThrow();
  expect(f.getRealtime()).toEqual({ status: 'deleted', accountDisabled: true });
});

test.each(['auth', 'rtdb', 'index'])('manual recovery completes after %s failure without user login', async step => {
  const f = fixture();
  if (step === 'auth') f.auth.deleteUser.mockRejectedValueOnce(new Error('outage'));
  if (step === 'rtdb') f.ref.set.mockRejectedValueOnce(new Error('outage'));
  if (step === 'index') f.options.releaseCpf = jest.fn().mockRejectedValueOnce(new Error('outage')).mockImplementation(releaseCpfsForDeletedAccount);
  await expect(runAccountDeletion(f.options)).rejects.toThrow();
  expect(f.firestore.records.get('account_deletions/old').status).toBe('error');
  f.auth.updateUser.mockRejectedValue({ code: 'auth/user-not-found' });
  f.auth.deleteUser.mockRejectedValue({ code: 'auth/user-not-found' });
  await expect(runAccountDeletion({ ...f.options, recoveryActor: 'admin-1' })).resolves.toEqual({ deleted: true });
  expect(f.firestore.records.get('account_deletions/old').status).toBe('completed');
  expect([...f.firestore.records.values()]).toEqual(expect.arrayContaining([
    expect.objectContaining({ actor: 'admin-1', source: 'admin_recovery', status: 'completed' })
  ]));
});

test('queued deletion retains CPF until explicit recovery completes it', async () => {
  const f = fixture();
  await expect(runAccountDeletion({ ...f.options, immediate: false })).resolves.toEqual({ deleted: false });
  expect(f.firestore.records.get('cpf_identity_index/12345678909').uid).toBe('old');
  await runAccountDeletion({ ...f.options, recoveryActor: 'admin-1' });
  expect(f.firestore.records.has('cpf_identity_index/12345678909')).toBe(false);
});

test('administrative recovery cannot initiate deletion on an active account', async () => {
  const f = fixture();
  await expect(runAccountDeletion({ ...f.options, recoveryActor: 'admin-1' })).rejects.toMatchObject({ status: 409 });
  expect(f.auth.updateUser).not.toHaveBeenCalled();
});

test('recovers a legacy random-ID deletion only after validating its owner and pending state', async () => {
  const f = fixture();
  f.firestore.records.set('users/old', { status: 'deletion_pending', accountDisabled: true });
  f.firestore.records.set('account_deletions/legacy-id', { userId: 'old', status: 'error' });
  const recoverySourceRef = f.firestore.collection('account_deletions').doc('legacy-id');
  await runAccountDeletion({ ...f.options, recoveryActor: 'admin-1', recoverySourceRef });
  expect(f.firestore.records.get('account_deletions/old')).toMatchObject({ status: 'completed', legacyDeletionId: 'legacy-id' });
  expect(f.firestore.records.get('account_deletions/legacy-id')).toEqual({ userId: 'old', status: 'error' });
});
