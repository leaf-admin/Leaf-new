const crypto = require('crypto');
const firebaseConfig = require('../firebase-config');

const COLLECTION = 'driver_canonical_document_approvals';
const MANUAL_APPROVAL_SOURCE = 'dashboard_manual_review';

function normalize(value) {
  return String(value || '').trim();
}

function normalizeStatus(value) {
  return normalize(value).toLowerCase();
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/i.test(normalize(value));
}

function sha256Buffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const error = new Error('Documento vazio para vinculo canonico');
    error.code = 'KYC_CANONICAL_DOCUMENT_BUFFER_INVALID';
    throw error;
  }
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function canonicalDocumentError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

class CanonicalDriverDocumentApprovalService {
  constructor(options = {}) {
    this.firestoreProvider = options.firestoreProvider || (() => firebaseConfig.getFirestore());
    this.now = options.now || (() => new Date());
  }

  getFirestore() {
    const firestore = this.firestoreProvider();
    if (!firestore) {
      throw canonicalDocumentError(
        'KYC_CANONICAL_DOCUMENT_STORE_UNAVAILABLE',
        'Firestore indisponivel para aprovacao canonica de documento'
      );
    }
    return firestore;
  }

  documentRef(firestore, driverId, documentType) {
    return firestore
      .collection(COLLECTION)
      .doc(normalize(driverId))
      .collection('documents')
      .doc(normalize(documentType).toLowerCase());
  }

  validateBinding(input = {}) {
    const driverId = normalize(input.driverId);
    const documentType = normalize(input.documentType).toLowerCase();
    const submissionId = normalize(input.submissionId || input.lastSubmissionId);
    const filePath = normalize(input.filePath);
    const documentSha256 = normalize(input.documentSha256).toLowerCase();
    const storageGeneration = normalize(input.storageGeneration);
    const expectedPrefix = `driver-activation/${driverId}/${documentType}/`;

    if (!driverId || !documentType || !submissionId) {
      throw canonicalDocumentError(
        'KYC_CANONICAL_DOCUMENT_BINDING_INVALID',
        'Motorista, tipo e submissao sao obrigatorios para o documento canonico'
      );
    }
    if (!filePath.startsWith(expectedPrefix) || filePath.includes('..')) {
      throw canonicalDocumentError(
        'KYC_CANONICAL_DOCUMENT_PATH_INVALID',
        'Caminho do documento canonico invalido'
      );
    }
    if (!isSha256(documentSha256) || !/^\d+$/.test(storageGeneration)) {
      throw canonicalDocumentError(
        'KYC_CANONICAL_DOCUMENT_INTEGRITY_MISSING',
        'Hash e generation do documento canonico sao obrigatorios'
      );
    }

    return {
      driverId,
      documentType,
      submissionId,
      filePath,
      documentSha256,
      storageGeneration
    };
  }

  assertSameBinding(stored = {}, input = {}) {
    const expected = this.validateBinding(input);
    const current = this.validateBinding({
      driverId: stored.driverId,
      documentType: stored.documentType,
      submissionId: stored.submissionId,
      filePath: stored.filePath,
      documentSha256: stored.documentSha256,
      storageGeneration: stored.storageGeneration
    });

    if (
      expected.driverId !== current.driverId
      || expected.documentType !== current.documentType
      || expected.submissionId !== current.submissionId
      || expected.filePath !== current.filePath
      || expected.documentSha256 !== current.documentSha256
      || expected.storageGeneration !== current.storageGeneration
    ) {
      throw canonicalDocumentError(
        'KYC_CANONICAL_DOCUMENT_BINDING_MISMATCH',
        'Documento revisado nao corresponde ao upload canonico atual'
      );
    }
    return current;
  }

  async markPending(input = {}) {
    const binding = this.validateBinding(input);
    const firestore = this.getFirestore();
    const nowIso = this.now().toISOString();
    const uploadedAt = normalize(input.uploadedAt) || nowIso;
    const payload = {
      schemaVersion: 1,
      bindingVersion: 1,
      ...binding,
      status: 'pending',
      analysisStatus: 'in_review',
      approvalSource: null,
      approvedBy: null,
      approvedAt: null,
      reviewedBy: null,
      reviewedByEmail: null,
      reviewedAt: null,
      rejectionReason: null,
      uploadedAt,
      fileSize: Number(input.fileSize || 0),
      createdAt: nowIso,
      updatedAt: nowIso
    };

    await this.documentRef(firestore, binding.driverId, binding.documentType)
      .set(payload, { merge: false });
    return payload;
  }

  async getDocument(driverId, documentType = 'cnh') {
    const safeDriverId = normalize(driverId);
    const safeDocumentType = normalize(documentType).toLowerCase();
    if (!safeDriverId || !safeDocumentType) return null;
    const firestore = this.getFirestore();
    const snapshot = await this.documentRef(firestore, safeDriverId, safeDocumentType).get();
    return snapshot.exists ? (snapshot.data() || null) : null;
  }

  async assertReviewableBinding(input = {}) {
    const binding = this.validateBinding(input);
    const stored = await this.getDocument(binding.driverId, binding.documentType);
    if (!stored) {
      throw canonicalDocumentError(
        'KYC_CANONICAL_DOCUMENT_REUPLOAD_REQUIRED',
        'Documento legado sem vinculo canonico; solicite novo upload antes da aprovacao'
      );
    }
    this.assertSameBinding(stored, binding);
    return stored;
  }

  validateManualReview(input = {}) {
    const binding = this.validateBinding(input);
    const action = normalizeStatus(input.action);
    const analysisStatus = normalizeStatus(input.analysisStatus);
    const reviewedBy = normalize(input.reviewedBy);
    const reviewedByEmail = normalize(input.reviewedByEmail) || null;
    if (!['approve', 'reject'].includes(action) || !reviewedBy) {
      throw canonicalDocumentError(
        'KYC_CANONICAL_DOCUMENT_REVIEW_INVALID',
        'Acao e revisor autenticado sao obrigatorios'
      );
    }
    if (action === 'reject' && !normalize(input.rejectionReason)) {
      throw canonicalDocumentError(
        'KYC_CANONICAL_DOCUMENT_REJECTION_REASON_REQUIRED',
        'Motivo da rejeicao e obrigatorio'
      );
    }

    if (action === 'approve' && analysisStatus !== 'approved') {
      throw canonicalDocumentError(
        'KYC_CANONICAL_DOCUMENT_ANALYSIS_NOT_APPROVED',
        'A CNH so pode ser aprovada manualmente depois da analise automatica aprovada'
      );
    }

    return {
      binding,
      action,
      analysisStatus,
      reviewedBy,
      reviewedByEmail,
      rejectionReason: action === 'reject' ? normalize(input.rejectionReason) : null
    };
  }

  async beginManualReview(input = {}) {
    const review = this.validateManualReview(input);
    const {
      binding,
      action,
      analysisStatus,
      reviewedBy,
      reviewedByEmail,
      rejectionReason
    } = review;

    const firestore = this.getFirestore();
    const ref = this.documentRef(firestore, binding.driverId, binding.documentType);
    const reviewedAt = this.now().toISOString();
    const result = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) {
        throw canonicalDocumentError(
          'KYC_CANONICAL_DOCUMENT_REUPLOAD_REQUIRED',
          'Documento legado sem vinculo canonico; solicite novo upload antes da aprovacao'
        );
      }
      const current = snapshot.data() || {};
      this.assertSameBinding(current, binding);

      const targetStatus = action === 'approve' ? 'approved' : 'rejected';
      if (normalizeStatus(current.status) === 'review_sync_pending') {
        if (
          normalizeStatus(current.reviewDecision) !== targetStatus
          || normalize(current.reviewedBy) !== reviewedBy
        ) {
          throw canonicalDocumentError(
            'KYC_CANONICAL_DOCUMENT_REVIEW_IN_PROGRESS',
            'Existe uma revisao canonica pendente de sincronizacao para este documento'
          );
        }
        return current;
      }

      const reviewSyncToken = crypto.randomUUID();
      const update = {
        status: 'review_sync_pending',
        analysisStatus: analysisStatus || current.analysisStatus || null,
        approvalSource: MANUAL_APPROVAL_SOURCE,
        reviewedBy,
        reviewedByEmail,
        reviewedAt,
        approvedBy: null,
        approvedAt: null,
        rejectionReason,
        reviewDecision: targetStatus,
        reviewSyncToken,
        reviewSyncStartedAt: reviewedAt,
        mirrorSyncedAt: null,
        updatedAt: reviewedAt
      };
      transaction.set(ref, update, { merge: true });
      return { ...current, ...update };
    });
    return result;
  }

  async finalizeManualReview(input = {}) {
    const binding = this.validateBinding(input);
    const reviewSyncToken = normalize(input.reviewSyncToken);
    if (!reviewSyncToken) {
      throw canonicalDocumentError(
        'KYC_CANONICAL_DOCUMENT_REVIEW_TOKEN_REQUIRED',
        'Token de sincronizacao da revisao canonica e obrigatorio'
      );
    }

    const firestore = this.getFirestore();
    const ref = this.documentRef(firestore, binding.driverId, binding.documentType);
    const mirrorSyncedAt = this.now().toISOString();
    return firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) {
        throw canonicalDocumentError(
          'KYC_CANONICAL_DOCUMENT_REUPLOAD_REQUIRED',
          'Documento legado sem vinculo canonico; solicite novo upload antes da aprovacao'
        );
      }
      const current = snapshot.data() || {};
      this.assertSameBinding(current, binding);
      if (
        normalizeStatus(current.status) !== 'review_sync_pending'
        || normalize(current.reviewSyncToken) !== reviewSyncToken
        || !['approved', 'rejected'].includes(normalizeStatus(current.reviewDecision))
      ) {
        throw canonicalDocumentError(
          'KYC_CANONICAL_DOCUMENT_REVIEW_STATE_INVALID',
          'Revisao canonica nao esta pronta para finalizacao'
        );
      }

      const status = normalizeStatus(current.reviewDecision);
      const update = {
        status,
        approvedBy: status === 'approved' ? current.reviewedBy : null,
        approvedAt: status === 'approved' ? current.reviewedAt : null,
        reviewDecision: null,
        reviewSyncToken: null,
        mirrorSyncedAt,
        updatedAt: mirrorSyncedAt
      };
      transaction.set(ref, update, { merge: true });
      return { ...current, ...update };
    });
  }

  // Compatibilidade interna para chamadas que nao possuem espelho RTDB. O
  // dashboard usa explicitamente begin -> RTDB -> finalize para fail-closed.
  async recordManualReview(input = {}) {
    const pending = await this.beginManualReview(input);
    return this.finalizeManualReview({
      ...input,
      reviewSyncToken: pending.reviewSyncToken
    });
  }

  async requireApprovedCnh(driverId) {
    const document = await this.getDocument(driverId, 'cnh');
    if (!document) {
      throw canonicalDocumentError(
        'KYC_CANONICAL_APPROVED_CNH_REQUIRED',
        'CNH canonica aprovada e obrigatoria'
      );
    }
    const binding = this.validateBinding(document);
    const reviewedAt = normalize(document.reviewedAt);
    const reviewedBy = normalize(document.reviewedBy);
    if (
      normalizeStatus(document.status) !== 'approved'
      || normalizeStatus(document.analysisStatus) !== 'approved'
      || document.approvalSource !== MANUAL_APPROVAL_SOURCE
      || !reviewedBy
      || !Number.isFinite(Date.parse(reviewedAt))
    ) {
      throw canonicalDocumentError(
        'KYC_CANONICAL_APPROVED_CNH_REQUIRED',
        'CNH precisa de aprovacao manual canonica antes da comparacao facial'
      );
    }
    return {
      ...document,
      ...binding,
      reviewedAt,
      reviewedBy
    };
  }
}

const service = new CanonicalDriverDocumentApprovalService();

module.exports = service;
module.exports.CanonicalDriverDocumentApprovalService = CanonicalDriverDocumentApprovalService;
module.exports.COLLECTION = COLLECTION;
module.exports.MANUAL_APPROVAL_SOURCE = MANUAL_APPROVAL_SOURCE;
module.exports.sha256Buffer = sha256Buffer;
