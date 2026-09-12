const admin = require('firebase-admin');

function assertAccountWritable(data = {}) {
  if (data.accountDisabled === true || ['deletion_pending', 'deleted'].includes(data.status)) {
    const error = new Error('Esta conta está em processo de exclusão ou já foi excluída.');
    error.code = 'ACCOUNT_DELETION_IN_PROGRESS';
    error.status = 409;
    throw error;
  }
}

async function saveAccountProfile({ firestore = admin.firestore(), userId, profile }) {
  const ref = firestore.collection('users').doc(userId);
  await firestore.runTransaction(async tx => {
    const current = await tx.get(ref);
    assertAccountWritable(current.exists ? current.data() : {});
    tx.set(ref, profile, { merge: true });
  });
}

// A tombstone makes delayed projections abort atomically, including after Auth removal.
async function projectRealtimeProfile(userId, profile, db = admin.database()) {
  const result = await db.ref(`users/${userId}`).transaction(current => {
    if (current?.accountDisabled || ['deleted', 'deletion_pending'].includes(current?.status)) return;
    return { ...current, ...profile };
  });
  if (!result.committed) assertAccountWritable({ status: 'deleted' });
}

async function runAccountDeletion({ userId, metadata, purge, immediate = true, removeAuth = true,
  recoveryActor = null, recoverySourceRef = null, firestore = admin.firestore(), db = admin.database(), auth = admin.auth(),
  releaseCpf }) {
  const userRef = firestore.collection('users').doc(userId);
  const jobRef = firestore.collection('account_deletions').doc(userId);
  const now = () => admin.firestore.FieldValue.serverTimestamp();
  const completed = await firestore.runTransaction(async tx => {
    const user = await tx.get(userRef);
    const job = await tx.get(jobRef);
    const legacyJob = recoverySourceRef ? await tx.get(recoverySourceRef) : null;
    const legacyData = legacyJob?.exists ? legacyJob.data() : null;
    const recoverableLegacy = legacyData?.userId === userId && ['processing', 'error', 'queued'].includes(legacyData.status);
    const data = user.exists ? user.data() : {};
    if (recoveryActor && ((!job.exists && !recoverableLegacy) || !['deletion_pending', 'deleted'].includes(data.status))) {
      const error = new Error('Nenhuma exclusão recuperável para esta conta.');
      error.status = 409;
      throw error;
    }
    if (job.data()?.status === 'completed') return true;
    tx.set(userRef, { status: 'deletion_pending', accountDisabled: true }, { merge: true });
    if (!job.exists) tx.set(jobRef, { ...metadata, userId, status: 'processing', createdAt: now(),
      ...(recoverableLegacy ? { legacyDeletionId: recoverySourceRef.id } : {}) });
    return false;
  });
  if (completed) return { deleted: true };
  const attemptRef = jobRef.collection('attempts').doc();
  await attemptRef.set({ actor: recoveryActor || userId, source: recoveryActor ? 'admin_recovery' : 'self_service', startedAt: now() });
  const checkpoint = async (step, extra = {}) => {
    await attemptRef.set({ step, ...extra, updatedAt: now() }, { merge: true });
    await firestore.runTransaction(async tx => {
      const job = await tx.get(jobRef);
      if (job.data()?.status !== 'completed') tx.set(jobRef, { step, ...extra, updatedAt: now() }, { merge: true });
    });
  };
  try {
    try { await auth.updateUser(userId, { disabled: true }); }
    catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
    await checkpoint('auth_disabled');
    if (!immediate) {
      await checkpoint('queued', { status: 'queued' });
      return { deleted: false };
    }
    await db.ref(`users/${userId}`).set({ status: 'deleted', accountDisabled: true });
    await checkpoint('realtime_purged');
    await userRef.set(purge, { merge: true });
    await checkpoint('profile_purged');
    if (removeAuth) {
      try { await auth.deleteUser(userId); }
      catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
    }
    await checkpoint(removeAuth ? 'auth_removed' : 'auth_retained_disabled');
    await releaseCpf({ firestore, userId });
    await checkpoint('cpf_released');
    await firestore.runTransaction(async tx => {
      // Both completion markers commit together; a failed attempt never reactivates an account.
      tx.set(userRef, { status: 'deleted', accountDisabled: true, cpfIndexReleased: true }, { merge: true });
      tx.set(jobRef, { status: 'completed', step: 'completed', completedAt: now() }, { merge: true });
    });
    await attemptRef.set({ status: 'completed', completedAt: now() }, { merge: true });
    return { deleted: true };
  } catch (error) {
    await checkpoint('retry_required', { status: 'error', errorCode: 'ACCOUNT_DELETION_STEP_FAILED' });
    throw error;
  }
}

module.exports = { assertAccountWritable, saveAccountProfile, projectRealtimeProfile, runAccountDeletion };
