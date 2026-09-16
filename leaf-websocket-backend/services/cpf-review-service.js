const crypto = require('crypto');

function reviewEnabled() {
  return process.env.NODE_ENV === 'production' || process.env.CPF_REVIEW_ENABLED === 'true';
}
function reviewError(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}
function reviewKey(cpf) {
  if (!reviewEnabled()) throw reviewError('CPF_REVIEW_DISABLED', 503);
  const key = process.env.CPF_REVIEW_HMAC_KEY;
  if (!key || Buffer.byteLength(key) < 32) throw reviewError('CPF_REVIEW_CONFIG_UNAVAILABLE', 503);
  return crypto.createHmac('sha256', key).update(`leaf:cpf-review:v1:${cpf}`).digest('hex');
}

async function readCpfReview({ firestore, transaction, cpf, now = Date.now() }) {
  if (!reviewEnabled()) return null;
  const snapshot = await transaction.get(firestore.collection('cpf_review_restrictions').doc(reviewKey(cpf)));
  if (!snapshot.exists) return null;
  const record = snapshot.data();
  // No silent renewal: expired restrictions stop blocking, but still require audited cleanup.
  if (Number.isFinite(Date.parse(record.expiresAt)) && Date.parse(record.expiresAt) <= now) return null;
  const error = reviewError('PROFILE_CPF_REVIEW_REQUIRED', 423);
  error.message = 'Seu cadastro precisa de revisão. Entre em contato com o suporte para solicitar análise ou contestar a restrição.';
  error.reviewReference = record.caseId;
  throw error;
}

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) throw reviewError(`INVALID_${field}`);
  return value.trim();
}

async function decideCpfReview({ firestore, cpf, input, actor, now = Date.now() }) {
  if (!reviewEnabled()) throw reviewError('CPF_REVIEW_DISABLED', 503);
  let ref;
  if (input.caseId) {
    const matches = await firestore.collection('cpf_review_restrictions').where('caseId', '==', input.caseId).get();
    if (matches.docs.length !== 1) throw reviewError('CPF_REVIEW_NOT_FOUND', 404);
    ref = matches.docs[0].ref;
  } else {
    ref = firestore.collection('cpf_review_restrictions').doc(reviewKey(cpf));
  }
  const auditRef = firestore.collection('cpf_review_audit').doc();
  const action = input.action;
  if (!['restrict', 'release', 'expire'].includes(action)) throw reviewError('INVALID_REVIEW_ACTION');
  const decisionReason = requiredText(input.decisionReason, 'DECISION_REASON');
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) throw reviewError('INVALID_REVISION');
  let details;
  if (action === 'restrict') {
    if (!['fraud_confirmed', 'safety_restriction'].includes(input.reason)) throw reviewError('INVALID_RESTRICTION_REASON');
    const reviewAt = Date.parse(input.reviewAt);
    const expiresAt = Date.parse(input.expiresAt);
    if (!(reviewAt > now && expiresAt >= reviewAt)) throw reviewError('INVALID_RETENTION_DATES');
    details = {
      reason: input.reason,
      evidenceRef: requiredText(input.evidenceRef, 'EVIDENCE_REFERENCE'),
      legalBasis: requiredText(input.legalBasis, 'LEGAL_BASIS'),
      reviewAt: new Date(reviewAt).toISOString(), expiresAt: new Date(expiresAt).toISOString()
    };
  }
  return firestore.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const previous = snapshot.exists ? snapshot.data() : null;
    if (previous && input.caseId !== previous.caseId) throw reviewError('CPF_REVIEW_CASE_CONFLICT', 409);
    if ((previous?.revision || 0) !== input.expectedRevision) throw reviewError('CPF_REVIEW_REVISION_CONFLICT', 409);
    if (action !== 'restrict' && !previous) throw reviewError('CPF_REVIEW_NOT_FOUND', 404);
    if (action === 'expire' && !(Date.parse(previous.expiresAt) <= now)) throw reviewError('CPF_REVIEW_NOT_EXPIRED', 409);
    const caseId = previous?.caseId || auditRef.id;
    const revision = (previous?.revision || 0) + 1;
    if (action === 'restrict') tx.set(ref, { ...details, caseId, revision, updatedAt: new Date(now).toISOString() });
    else tx.delete(ref);
    // Audit has no raw CPF or HMAC. Evidence stays in its separately controlled system.
    tx.set(auditRef, { caseId, revision, action, actor, decisionReason,
      ...(details || {}), createdAt: new Date(now).toISOString() });
    return { caseId, revision, action };
  });
}

module.exports = { readCpfReview, decideCpfReview, reviewKey, reviewEnabled };
