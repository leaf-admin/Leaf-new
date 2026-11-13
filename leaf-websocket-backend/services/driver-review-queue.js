'use strict';

// Classifica um cadastro de motorista na mesma fila que o painel mostra
// (leaf-dashboard-js/src/utils/driver-review.js: classifyDriver). Fica no
// backend para o espelho driver_applications guardar a fila e desde quando o
// cadastro espera, e o contador do painel sair de uma contagem agregada em vez
// de ler a coleção inteira.

const REVIEW_BUCKETS = Object.freeze(['review', 'onboarding', 'approved', 'rejected']);

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function findDocument(application, type) {
  const docs = application?.documents?.all_documents;
  if (!Array.isArray(docs)) return null;
  return docs.find((doc) => normalize(doc?.type) === type) || null;
}

function documentStepStatus(doc) {
  if (!doc) return 'pending';
  const status = normalize(doc?.status);
  if (status === 'approved') return 'approved';
  if (['rejected', 'failed'].includes(status)) return 'failed';
  if (['in_review', 'pending', 'analyzing', 'uploaded'].includes(status)) return 'review';
  return 'pending';
}

/**
 * Devolve { bucket, reason }. reason só vem para bucket "review":
 * - manual_review: aprovação automática pediu revisão humana ou KYC em revisão
 * - ready_to_approve: tudo certo, falta o clique de aprovar
 * - background_certificate: falta emitir/revisar a certidão de antecedentes
 * - documents: documento enviado esperando revisão
 */
function classifyDriverApplication(application = {}) {
  const driver = application.driver || {};
  const status = normalize(application.status || driver.status);
  if (driver.approved === true || status === 'approved') return { bucket: 'approved', reason: null };
  if (status === 'rejected' || normalize(driver.status) === 'blocked') return { bucket: 'rejected', reason: null };

  const activation = application.activation || {};
  const checklist = activation.checklist || {};
  const kyc = application.kyc || {};

  if (normalize(application.autoApproval?.status) === 'needs_review' || kyc.needsReview === true) {
    return { bucket: 'review', reason: 'manual_review' };
  }
  if (activation.canGoOnline === true) {
    return { bucket: 'review', reason: 'ready_to_approve' };
  }
  if (checklist.awaitingBackgroundCertificate === true) {
    return { bucket: 'review', reason: 'background_certificate' };
  }

  const cnh = findDocument(application, 'cnh');
  const crlv = findDocument(application, 'crlv');
  const certificate = findDocument(application, 'antecedentes_criminais');
  const documentsInReview = [
    documentStepStatus(cnh) === 'review' ? cnh : null,
    !activation.vehicleReady && documentStepStatus(crlv) === 'review' ? crlv : null,
    checklist.backgroundCertificate !== true && documentStepStatus(certificate) === 'review' ? certificate : null
  ].filter(Boolean);
  if (documentsInReview.length > 0) {
    return { bucket: 'review', reason: 'documents' };
  }

  return { bucket: 'onboarding', reason: null };
}

function firstValidIso(...values) {
  for (const value of values) {
    if (!value) continue;
    const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return null;
}

/**
 * Campos de fila gravados no espelho. Mantém reviewWaitingSince enquanto o
 * cadastro continua em "review" e zera quando sai.
 */
function buildReviewQueueFields(application = {}, previous = {}, nowIso = new Date().toISOString()) {
  const { bucket, reason } = classifyDriverApplication(application);
  const previousBucket = normalize(previous?.reviewBucket);
  let waitingSince = null;
  if (bucket === 'review') {
    waitingSince = previousBucket === 'review'
      ? firstValidIso(previous?.reviewWaitingSince, nowIso)
      : nowIso;
  }
  return {
    reviewBucket: bucket,
    reviewReason: reason,
    reviewWaitingSince: waitingSince,
    changed: previousBucket !== bucket || normalize(previous?.reviewReason) !== normalize(reason)
  };
}

/**
 * Para espelhos antigos sem reviewWaitingSince: usa a data mais recente que o
 * cadastro já tem como melhor estimativa de quando entrou na fila.
 */
function estimateWaitingSince(application = {}) {
  return firstValidIso(
    application.updatedAt,
    application.lastUpdated,
    application.submissionDate,
    application.createdAt
  );
}

module.exports = {
  REVIEW_BUCKETS,
  classifyDriverApplication,
  buildReviewQueueFields,
  estimateWaitingSince
};
