const admin = require('firebase-admin');
const { readCpfReview } = require('./cpf-review-service');
const { assertAccountWritable } = require('./account-lifecycle-service');

const CPF_INDEX_COLLECTION = 'cpf_identity_index';

const CPF_ERROR_MESSAGES = Object.freeze({
  PROFILE_CPF_REQUIRED: 'Informe o CPF da CNH para concluir o cadastro.',
  PROFILE_CPF_INVALID: 'Informe um CPF válido.',
  PROFILE_CPF_ALREADY_REGISTERED: 'Este CPF já está vinculado a outro cadastro.',
  PROFILE_CPF_UNIQUENESS_UNAVAILABLE: 'Não foi possível confirmar o CPF agora. Tente novamente.'
});

class CpfIdentityError extends Error {
  constructor(code, message = CPF_ERROR_MESSAGES[code], status = 400) {
    super(message || 'Não foi possível validar o CPF.');
    this.name = 'CpfIdentityError';
    this.code = code;
    this.status = code === 'PROFILE_CPF_ALREADY_REGISTERED' && status === 400 ? 409 : status;
  }
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function isValidCpfDigits(digits) {
  if (!/^\d{11}$/.test(digits) || /^([0-9])\1{10}$/.test(digits)) {
    return false;
  }

  let firstSum = 0;
  for (let index = 0; index < 9; index += 1) {
    firstSum += Number(digits[index]) * (10 - index);
  }
  const firstCheckDigit = (firstSum * 10) % 11;
  const normalizedFirstCheckDigit = firstCheckDigit === 10 ? 0 : firstCheckDigit;
  if (normalizedFirstCheckDigit !== Number(digits[9])) {
    return false;
  }

  let secondSum = 0;
  for (let index = 0; index < 10; index += 1) {
    secondSum += Number(digits[index]) * (11 - index);
  }
  const secondCheckDigit = (secondSum * 10) % 11;
  const normalizedSecondCheckDigit = secondCheckDigit === 10 ? 0 : secondCheckDigit;
  return normalizedSecondCheckDigit === Number(digits[10]);
}

function formatCpf(digits) {
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function normalizeCpf(value, options = {}) {
  const { required = false } = options;
  const digits = digitsOnly(value);

  if (!digits) {
    if (required) {
      throw new CpfIdentityError('PROFILE_CPF_REQUIRED');
    }
    return null;
  }

  if (!isValidCpfDigits(digits)) {
    throw new CpfIdentityError('PROFILE_CPF_INVALID');
  }

  return {
    digits,
    formatted: formatCpf(digits)
  };
}

function normalizeCpfForComparison(value) {
  const digits = digitsOnly(value);
  return digits.length === 11 ? digits : '';
}

async function findExistingCpfOwnerIds(firestore, cpfDigits) {
  const values = [cpfDigits, formatCpf(cpfDigits)];
  const queries = [
    ...values.map((value) => ({ field: 'cpf', value })),
    { field: 'cpfNormalized', value: cpfDigits }
  ];

  try {
    const snapshots = await Promise.all(
      queries.map(({ field, value }) => (
        firestore.collection('users').where(field, '==', value).get()
      ))
    );

    return [...new Set(
      snapshots.flatMap((snapshot) => (
        Array.isArray(snapshot?.docs) ? snapshot.docs.map((doc) => doc.id) : []
      ))
    )];
  } catch (error) {
    throw new CpfIdentityError(
      'PROFILE_CPF_UNIQUENESS_UNAVAILABLE',
      CPF_ERROR_MESSAGES.PROFILE_CPF_UNIQUENESS_UNAVAILABLE,
      503
    );
  }
}

async function findRealtimeCpfOwnerIds(realtimeDb, cpfDigits) {
  const usersRef = realtimeDb?.ref?.('users');
  if (typeof usersRef?.orderByChild !== 'function') {
    return [];
  }

  const queries = [
    ['cpf', cpfDigits],
    ['cpf', formatCpf(cpfDigits)],
    ['cpfNormalized', cpfDigits]
  ];

  try {
    const snapshots = await Promise.all(
      queries.map(([field, value]) => (
        usersRef.orderByChild(field).equalTo(value).once('value')
      ))
    );

    return [...new Set(
      snapshots.flatMap((snapshot) => {
        const records = snapshot?.val?.() || {};
        return Object.entries(records)
          .filter(([, record]) => (
            normalizeCpfForComparison(record?.cpf || record?.cpfNormalized) === cpfDigits
          ))
          .map(([uid]) => uid);
      })
    )];
  } catch (error) {
    throw new CpfIdentityError(
      'PROFILE_CPF_UNIQUENESS_UNAVAILABLE',
      CPF_ERROR_MESSAGES.PROFILE_CPF_UNIQUENESS_UNAVAILABLE,
      503
    );
  }
}

async function claimCpf({ firestore = admin.firestore(), realtimeDb = null, userId, cpf, profile }) {
  const normalized = normalizeCpf(cpf, { required: true });
  const ownerId = String(userId || '').trim();

  if (!ownerId) {
    throw new CpfIdentityError(
      'PROFILE_CPF_UNIQUENESS_UNAVAILABLE',
      CPF_ERROR_MESSAGES.PROFILE_CPF_UNIQUENESS_UNAVAILABLE,
      503
    );
  }

  const [firestoreOwnerIds, realtimeOwnerIds] = await Promise.all([
    findExistingCpfOwnerIds(firestore, normalized.digits),
    findRealtimeCpfOwnerIds(realtimeDb, normalized.digits)
  ]);
  const legacyOwnerIds = [...new Set([...firestoreOwnerIds, ...realtimeOwnerIds])];
  if (legacyOwnerIds.some((candidateId) => candidateId !== ownerId)) {
    throw new CpfIdentityError('PROFILE_CPF_ALREADY_REGISTERED');
  }

  if (typeof firestore.runTransaction !== 'function') {
    throw new CpfIdentityError(
      'PROFILE_CPF_UNIQUENESS_UNAVAILABLE',
      CPF_ERROR_MESSAGES.PROFILE_CPF_UNIQUENESS_UNAVAILABLE,
      503
    );
  }

  const indexRef = firestore.collection(CPF_INDEX_COLLECTION).doc(normalized.digits);
  const now = new Date().toISOString();

  try {
    await firestore.runTransaction(async (transaction) => {
      const userRef = firestore.collection('users').doc(ownerId);
      const userSnapshot = await transaction.get(userRef);
      assertAccountWritable(userSnapshot.exists ? userSnapshot.data() : {});
      await readCpfReview({ firestore, transaction, cpf: normalized.digits });
      const indexSnapshot = await transaction.get(indexRef);
      const indexData = indexSnapshot.exists ? indexSnapshot.data() || {} : null;
      const indexedOwnerId = String(indexData?.uid || '').trim();

      if (indexedOwnerId && indexedOwnerId !== ownerId) {
        throw new CpfIdentityError('PROFILE_CPF_ALREADY_REGISTERED');
      }

      if (profile) transaction.set(userRef, profile, { merge: true });
      transaction.set(indexRef, {
        uid: ownerId,
        cpfNormalized: normalized.digits,
        createdAt: indexData?.createdAt || now,
        updatedAt: now
      }, { merge: true });
    });
  } catch (error) {
    if (error instanceof CpfIdentityError || ['ACCOUNT_DELETION_IN_PROGRESS', 'PROFILE_CPF_REVIEW_REQUIRED', 'CPF_REVIEW_CONFIG_UNAVAILABLE'].includes(error.code)) throw error;
    throw new CpfIdentityError(
      'PROFILE_CPF_UNIQUENESS_UNAVAILABLE',
      CPF_ERROR_MESSAGES.PROFILE_CPF_UNIQUENESS_UNAVAILABLE,
      503
    );
  }

  return normalized;
}

// Lookup by UID survives a partial purge that already removed CPF from the profile.
async function releaseCpfsForDeletedAccount({ firestore = admin.firestore(), userId }) {
  const ownerId = String(userId || '').trim();
  if (!ownerId) throw new Error('Account UID is required to release CPF');
  const snapshot = await firestore.collection(CPF_INDEX_COLLECTION)
    .where('uid', '==', ownerId).get();
  for (const candidate of snapshot.docs) {
    await firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(candidate.ref);
      if (current.exists && current.data()?.uid === ownerId) {
        transaction.delete(candidate.ref);
      }
    });
  }
}

module.exports = {
  CPF_ERROR_MESSAGES,
  CPF_INDEX_COLLECTION,
  CpfIdentityError,
  claimCpf,
  releaseCpfsForDeletedAccount,
  digitsOnly,
  findRealtimeCpfOwnerIds,
  findExistingCpfOwnerIds,
  formatCpf,
  isValidCpfDigits,
  normalizeCpf,
  normalizeCpfForComparison
};
