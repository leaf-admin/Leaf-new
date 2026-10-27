const crypto = require('crypto');
const firebaseConfig = require('../firebase-config');
const ocrService = require('./ocr-service');
const documentAIExtractionService = require('./document-ai-extraction-service');
const CnhFaceBiometricService = require('./cnh-face-biometric-service');
const { validateCnhDocumentIdentity } = require('./cnh-document-identity-validator');
const { logStructured, logError } = require('../utils/logger');
const { metrics: runtimeMetrics } = require('../utils/prometheus-metrics');
const driverActivationStateService = require('./driver-activation-state-service');
const driverDocumentStore = require('./driver-document-store');
const { normalizeVehicleOcrPayload } = require('../utils/vehicle-ocr-data');
const {
  buildApprovedCrlvVehicleLinkUpdates
} = require('./driver-crlv-vehicle-link-service');

const MEI_DOCUMENTS_ENABLED =
  String(process.env.ENABLE_DRIVER_MEI_DOCUMENTS || 'false').toLowerCase() === 'true';
const ALLOWED_DRIVER_DOCUMENT_TYPES = Object.freeze([
  'cnh',
  'crlv',
  ...(MEI_DOCUMENTS_ENABLED ? ['mei'] : [])
]);
const SERIALIZABLE_DRIVER_DOCUMENT_TYPES = Object.freeze([
  ...ALLOWED_DRIVER_DOCUMENT_TYPES,
  'antecedentes_criminais'
]);
const REVIEWABLE_INDEX_STATUSES = Object.freeze(['pending', 'approved', 'rejected']);
const DOCUMENT_MUTATION_LOCK_TTL_MS = Math.max(
  30 * 1000,
  Number.parseInt(process.env.DRIVER_DOCUMENT_MUTATION_LOCK_TTL_MS || `${2 * 60 * 1000}`, 10) || 2 * 60 * 1000
);
const DOCUMENT_MUTATION_LOCK_WAIT_MS = Math.max(
  1000,
  Number.parseInt(process.env.DRIVER_DOCUMENT_MUTATION_LOCK_WAIT_MS || '15000', 10) || 15000
);
const CNH_FACE_BIOMETRICS_ENABLED =
  String(process.env.ENABLE_CNH_FACE_BIOMETRICS || 'false').toLowerCase() === 'true';
const CNH_FACE_BIOMETRICS_BLOCKING =
  String(process.env.CNH_FACE_BIOMETRICS_BLOCKING || 'false').toLowerCase() === 'true';
const CNH_FACE_BIOMETRICS_MAX_ATTEMPTS = Math.max(
  1,
  Number.parseInt(process.env.CNH_FACE_BIOMETRICS_MAX_ATTEMPTS || '3', 10) || 3
);
const CNH_FACE_BIOMETRICS_RETRY_BASE_DELAY_MS = Math.max(
  0,
  Number.parseInt(process.env.CNH_FACE_BIOMETRICS_RETRY_BASE_DELAY_MS || '750', 10) || 750
);
const CNH_FACE_BIOMETRICS_RETRY_MAX_DELAY_MS = Math.max(
  CNH_FACE_BIOMETRICS_RETRY_BASE_DELAY_MS,
  Number.parseInt(process.env.CNH_FACE_BIOMETRICS_RETRY_MAX_DELAY_MS || '4000', 10) || 4000
);

let cnhFaceBiometricService = null;

function sanitizeDocumentType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ALLOWED_DRIVER_DOCUMENT_TYPES.includes(normalized) ? normalized : null;
}

function sanitizeDocumentMutationType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return SERIALIZABLE_DRIVER_DOCUMENT_TYPES.includes(normalized) ? normalized : null;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hasUsefulCnhText(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length < 700) {
    return false;
  }

  const upper = raw.toUpperCase();
  const markers = ['CPF', 'REGISTRO', 'VALIDADE', 'CATEGORIA', 'NOME', 'HABILIT'];
  const hitCount = markers.reduce((acc, marker) => (upper.includes(marker) ? acc + 1 : acc), 0);
  return hitCount >= 2;
}

function hasUsefulVehicleText(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length < 350) {
    return false;
  }

  const upper = raw.toUpperCase();
  const markers = ['PLACA', 'RENAVAM', 'CHASSI', 'MUNICIPIO', 'MARCA', 'MODELO'];
  const hitCount = markers.reduce((acc, marker) => (upper.includes(marker) ? acc + 1 : acc), 0);
  return hitCount >= 2;
}

function hasRequiredCrlvVehicleIdentity(data = {}) {
  return Boolean(String(data?.plate || data?.placa || '').trim()) &&
    Boolean(String(data?.renavam || '').trim()) &&
    Boolean(String(data?.model || data?.modelo || data?.vehicleModel || '').trim()) &&
    Boolean(String(data?.color || data?.cor || data?.vehicleColor || data?.carColor || '').trim());
}

function getFirestoreOrThrow() {
  const firestore = firebaseConfig?.getFirestore?.();
  if (!firestore) {
    throw new Error('FIREBASE_FIRESTORE_UNAVAILABLE');
  }
  return firestore;
}

const { activationField: activationWrite, userField: userWrite } = driverDocumentStore;

function nowIso() {
  return new Date().toISOString();
}

function documentBindingError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeDocumentBinding(input = {}) {
  return {
    submissionId: String(input?.submissionId || input?.lastSubmissionId || '').trim(),
    filePath: String(input?.filePath || '').trim(),
    documentSha256: String(input?.documentSha256 || '').trim().toLowerCase(),
    storageGeneration: String(input?.storageGeneration || '').trim()
  };
}

function requireCompleteDocumentBinding(input = {}) {
  const binding = normalizeDocumentBinding(input);
  if (
    !binding.submissionId
    || !binding.filePath
    || !/^[a-f0-9]{64}$/.test(binding.documentSha256)
    || !/^\d+$/.test(binding.storageGeneration)
  ) {
    throw documentBindingError(
      'DRIVER_DOCUMENT_BINDING_INCOMPLETE',
      'Submission, caminho, hash e generation sao obrigatorios para materializar o documento'
    );
  }
  return binding;
}

function documentBindingsMatch(left = {}, right = {}) {
  const normalizedLeft = normalizeDocumentBinding(left);
  const normalizedRight = normalizeDocumentBinding(right);
  return normalizedLeft.submissionId === normalizedRight.submissionId
    && normalizedLeft.filePath === normalizedRight.filePath
    && normalizedLeft.documentSha256 === normalizedRight.documentSha256
    && normalizedLeft.storageGeneration === normalizedRight.storageGeneration;
}

async function acquireDocumentMutationLease({ firestore, driverId, documentType, scope }) {
  const safeDriverId = String(driverId || '').trim();
  const safeType = sanitizeDocumentMutationType(documentType);
  if (!firestore || !safeDriverId || !safeType) {
    throw documentBindingError(
      'DRIVER_DOCUMENT_MUTATION_INPUT_INVALID',
      'Motorista e tipo sao obrigatorios para serializar a mutacao documental'
    );
  }

  const token = crypto.randomUUID();
  const lockKey = { driverId: safeDriverId, documentType: safeType };
  const deadline = Date.now() + DOCUMENT_MUTATION_LOCK_WAIT_MS;

  while (Date.now() <= deadline) {
    const acquiredAtMs = Date.now();
    const result = await driverDocumentStore.transactLock(firestore, lockKey, (current) => {
      const currentExpiresAtMs = Number(current?.expiresAtMs || 0);
      if (
        current?.token
        && current.token !== token
        && currentExpiresAtMs > acquiredAtMs
      ) {
        return undefined;
      }
      return {
        token,
        driverId: safeDriverId,
        documentType: safeType,
        scope: String(scope || 'document_mutation').trim(),
        acquiredAt: new Date(acquiredAtMs).toISOString(),
        acquiredAtMs,
        expiresAtMs: acquiredAtMs + DOCUMENT_MUTATION_LOCK_TTL_MS
      };
    });
    const stored = result?.value || null;
    if (result?.committed === true && stored?.token === token) {
      let released = false;
      let lost = false;
      let renewalInFlight = null;

      const renew = async () => {
        if (released || lost) return false;
        if (renewalInFlight) return renewalInFlight;
        const renewedAtMs = Date.now();
        renewalInFlight = driverDocumentStore.transactLock(firestore, lockKey, (current) => {
          if (current?.token !== token) return undefined;
          return {
            ...current,
            renewedAt: new Date(renewedAtMs).toISOString(),
            renewedAtMs,
            expiresAtMs: renewedAtMs + DOCUMENT_MUTATION_LOCK_TTL_MS
          };
        })
          .then((renewal) => {
            const value = renewal?.value || null;
            const held = renewal?.committed === true && value?.token === token;
            if (!held) lost = true;
            return held;
          })
          .catch(() => {
            lost = true;
            return false;
          })
          .finally(() => {
            renewalInFlight = null;
          });
        return renewalInFlight;
      };

      const heartbeat = setInterval(() => {
        void renew();
      }, Math.max(5000, Math.floor(DOCUMENT_MUTATION_LOCK_TTL_MS / 3)));
      heartbeat.unref?.();

      return {
        token,
        async assertHeld() {
          if (lost || !(await renew())) {
            throw documentBindingError(
              'DRIVER_DOCUMENT_MUTATION_LEASE_LOST',
              'A janela de serializacao documental foi perdida'
            );
          }
          return true;
        },
        async release() {
          if (released) return;
          released = true;
          clearInterval(heartbeat);
          await driverDocumentStore.transactLock(firestore, lockKey, (current) => (
            current?.token === token ? null : undefined
          )).catch(() => null);
        }
      };
    }

    await sleep(75);
  }

  throw documentBindingError(
    'DRIVER_DOCUMENT_MUTATION_BUSY',
    'Outra atualizacao deste documento ainda esta em andamento'
  );
}

async function runWithDocumentMutationLease({
  driverId,
  documentType,
  scope
}, callback) {
  if (typeof callback !== 'function') {
    throw documentBindingError(
      'DRIVER_DOCUMENT_MUTATION_CALLBACK_REQUIRED',
      'Callback obrigatorio para mutacao documental serializada'
    );
  }
  const firestore = getFirestoreOrThrow();
  const lease = await acquireDocumentMutationLease({
    firestore,
    driverId,
    documentType,
    scope
  });
  try {
    await lease.assertHeld();
    return await callback({ firestore, lease });
  } finally {
    await lease.release();
  }
}

async function commitDocumentSubmissionState({
  driverId,
  documentType,
  activationDocument,
  userDocument,
  updatedAt = nowIso()
} = {}) {
  const safeDriverId = String(driverId || '').trim();
  const safeType = sanitizeDocumentType(documentType);
  const binding = requireCompleteDocumentBinding(activationDocument);
  if (
    !safeDriverId
    || !safeType
    || !documentBindingsMatch(binding, userDocument)
  ) {
    throw documentBindingError(
      'DRIVER_DOCUMENT_SUBMISSION_BINDING_MISMATCH',
      'As projecoes da submissao documental possuem bindings divergentes'
    );
  }

  return runWithDocumentMutationLease({
    driverId: safeDriverId,
    documentType: safeType,
    scope: `submission_commit_${binding.submissionId}`
  }, async ({ firestore, lease }) => {
    await lease.assertHeld();
    await driverDocumentStore.commit(firestore, [
      activationWrite(safeDriverId, ['documents', safeType], activationDocument),
      activationWrite(safeDriverId, ['documents_history', binding.submissionId], activationDocument),
      activationWrite(safeDriverId, ['updatedAt'], updatedAt),
      userWrite(safeDriverId, ['documents', safeType], userDocument)
    ]);
    return { binding };
  });
}

async function runWithCurrentDocumentBinding({
  driverId,
  documentType,
  expectedBinding,
  scope = 'current_document_binding'
} = {}, callback) {
  const safeDriverId = String(driverId || '').trim();
  const safeType = sanitizeDocumentMutationType(documentType);
  let binding = null;
  try {
    binding = requireCompleteDocumentBinding(expectedBinding);
  } catch (_error) {
    throw documentBindingError(
      'DRIVER_ACTIVATION_DOCUMENT_BINDING_MISMATCH',
      'O documento mudou desde que esta operacao foi iniciada. Recarregue os dados antes de continuar.'
    );
  }
  if (!safeDriverId || !safeType || typeof callback !== 'function') {
    throw documentBindingError(
      'DRIVER_ACTIVATION_DOCUMENT_BINDING_MISMATCH',
      'Motorista, tipo e binding documental atual sao obrigatorios'
    );
  }

  return runWithDocumentMutationLease({
    driverId: safeDriverId,
    documentType: safeType,
    scope: `${scope}_${binding.submissionId}`
  }, async ({ firestore, lease }) => {
    const {
      activationDocument,
      userDocument,
      historyDocument
    } = await driverDocumentStore.readDocumentBinding(firestore, {
      driverId: safeDriverId,
      documentType: safeType,
      submissionId: binding.submissionId
    });
    if (
      !documentBindingsMatch(binding, activationDocument)
      || !documentBindingsMatch(binding, userDocument)
      || !documentBindingsMatch(binding, historyDocument)
    ) {
      throw documentBindingError(
        'DRIVER_ACTIVATION_DOCUMENT_BINDING_MISMATCH',
        'O documento mudou desde que esta operacao foi iniciada. Recarregue os dados antes de continuar.'
      );
    }

    return callback({
      firestore,
      lease,
      binding,
      activationDocument,
      userDocument,
      historyDocument
    });
  });
}

function getCnhFaceBiometricService() {
  if (!cnhFaceBiometricService) {
    cnhFaceBiometricService = new CnhFaceBiometricService();
  }
  return cnhFaceBiometricService;
}

function withoutEmbedding(payload) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }
  const { embedding, ...rest } = payload;
  return rest;
}

function sleep(ms) {
  if (!ms) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getErrorStatus(error) {
  return Number(error?.status || error?.response?.status || error?.statusCode || 0);
}

function isRetryableCnhFaceBiometricError(error) {
  const status = getErrorStatus(error);
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) {
    return true;
  }
  if (status >= 400 && status < 500) {
    return false;
  }

  const code = String(error?.code || error?.cause?.code || '').toUpperCase();
  if (
    code.includes('PERMISSION')
    || code.includes('AUTH')
    || code.includes('UNAUTHENTICATED')
  ) {
    return false;
  }
  if ([
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'ENOTFOUND',
    'ESOCKETTIMEDOUT',
    'ERR_NETWORK',
    'ERR_BAD_RESPONSE',
    'UNAVAILABLE',
    'DEADLINE_EXCEEDED',
    'RESOURCE_EXHAUSTED',
    'INTERNAL'
  ].includes(code)) {
    return true;
  }

  const message = String(error?.message || '').toLowerCase();
  if (
    message.includes('timeout')
    || message.includes('temporarily')
    || message.includes('connection')
    || message.includes('socket')
    || message.includes('model load')
    || message.includes('model not loaded')
    || message.includes('service unavailable')
    || message.includes('database unavailable')
    || message.includes('rtdb unavailable')
    || message.includes('deadline exceeded')
  ) {
    return true;
  }

  if (
    message.includes('no face')
    || message.includes('nenhuma face')
    || message.includes('upload must be an image')
    || message.includes('image is empty')
    || message.includes('image is too large')
    || message.includes('pdf')
  ) {
    return false;
  }

  return false;
}

function getCnhFaceBiometricRetryDelayMs(attempt) {
  const exponentialDelay = CNH_FACE_BIOMETRICS_RETRY_BASE_DELAY_MS * (2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 150);
  return Math.min(CNH_FACE_BIOMETRICS_RETRY_MAX_DELAY_MS, exponentialDelay + jitter);
}

async function generateCnhFaceBiometricShadow({ driverId, submissionId, fileBuffer }) {
  if (!CNH_FACE_BIOMETRICS_ENABLED) {
    return null;
  }

  const safeDriverId = String(driverId || '').trim();
  const safeSubmissionId = String(submissionId || '').trim();
  const startedAt = Date.now();
  const service = getCnhFaceBiometricService();

  if (!service.isConfigured()) {
    logStructured('warn', 'Biometria facial da CNH habilitada, mas microservico nao configurado', {
      service: 'driver-activation-queue',
      driverId: safeDriverId,
      submissionId: safeSubmissionId
    });
    const documentPayload = {
      status: 'skipped',
      provider: 'leaf_face_compare_service',
      reason: 'not_configured',
      createdAt: nowIso()
    };
    return {
      documentPayload,
      userPayload: null,
      activationPayload: null
    };
  }

  let lastError = null;
  let attempts = 0;

  try {
    let result = null;
    let biometricPayload = null;

    for (attempts = 1; attempts <= CNH_FACE_BIOMETRICS_MAX_ATTEMPTS; attempts += 1) {
      try {
        if (!result) {
          result = await service.generateCnhFaceEmbeddingFromPdf(fileBuffer, {
            filename: `cnh-${safeSubmissionId || Date.now()}.pdf`
          });
        }

        const createdAt = nowIso();
        biometricPayload = {
          provider: 'leaf_face_compare_service',
          status: 'generated',
          source: result.source || 'cnh_pdf',
          embedding: result.embedding,
          dimension: result.dimension || null,
          embeddingNorm: result.embedding_norm || null,
          faceCount: result.face_count || null,
          selectedFace: result.selected_face || null,
          model: result.model || null,
          crop: result.crop || null,
          documentType: 'cnh',
          submissionId: safeSubmissionId || null,
          createdAt,
          durationMs: Date.now() - startedAt,
          attempts
        };

        break;
      } catch (error) {
        lastError = error;
        const retryable = isRetryableCnhFaceBiometricError(error);
        const hasAnotherAttempt = attempts < CNH_FACE_BIOMETRICS_MAX_ATTEMPTS;

        if (!retryable || !hasAnotherAttempt) {
          throw error;
        }

        const retryDelayMs = getCnhFaceBiometricRetryDelayMs(attempts);
        runtimeMetrics.recordRealtimeUpdate('cnh_face_biometric', 'retry');
        logStructured('warn', 'Falha transitória ao gerar embedding facial da CNH; retry agendado', {
          service: 'driver-activation-queue',
          driverId: safeDriverId,
          submissionId: safeSubmissionId,
          attempt: attempts,
          maxAttempts: CNH_FACE_BIOMETRICS_MAX_ATTEMPTS,
          retryDelayMs,
          error: error.message,
          status: getErrorStatus(error) || null,
          code: error?.code || error?.cause?.code || null
        });
        await sleep(retryDelayMs);
      }
    }

    logStructured('info', 'Embedding facial da CNH gerado em shadow mode', {
      service: 'driver-activation-queue',
      driverId: safeDriverId,
      submissionId: safeSubmissionId,
      durationMs: biometricPayload.durationMs,
      attempts,
      source: biometricPayload.source,
      detScore: biometricPayload.selectedFace?.detection_score || null
    });

    const activationPayload = withoutEmbedding(biometricPayload);
    return {
      documentPayload: activationPayload,
      userPayload: biometricPayload,
      activationPayload
    };
  } catch (error) {
    const retryable = isRetryableCnhFaceBiometricError(error);
    const failurePayload = {
      status: 'failed',
      provider: 'leaf_face_compare_service',
      error: error.message,
      errorCode: error?.code || error?.cause?.code || null,
      statusCode: getErrorStatus(error) || null,
      retryable,
      attempts,
      maxAttempts: CNH_FACE_BIOMETRICS_MAX_ATTEMPTS,
      createdAt: nowIso(),
      durationMs: Date.now() - startedAt
    };

    logError(error, 'Falha ao gerar embedding facial da CNH em shadow mode', {
      service: 'driver-activation-queue',
      driverId: safeDriverId,
      submissionId: safeSubmissionId,
      durationMs: failurePayload.durationMs,
      retryable,
      attempts,
      status: failurePayload.statusCode,
      lastError: lastError?.message || null
    });

    if (CNH_FACE_BIOMETRICS_BLOCKING) {
      throw error;
    }

    return {
      documentPayload: failurePayload,
      userPayload: null,
      activationPayload: failurePayload
    };
  }
}

function toReviewQueueStatus(documentStatus) {
  const normalized = String(documentStatus || '').trim().toLowerCase();
  if (normalized === 'approved') {
    return 'approved';
  }
  if (normalized === 'failed') {
    return 'rejected';
  }
  return 'pending';
}

async function adjustDocumentIndexCounters(firestore, documentType, previousStatus, nextStatus) {
  const safeDocumentType = sanitizeDocumentType(documentType);
  if (!safeDocumentType) {
    return;
  }

  const fromStatus = REVIEWABLE_INDEX_STATUSES.includes(String(previousStatus || '').toLowerCase())
    ? String(previousStatus).toLowerCase()
    : null;
  const toStatus = REVIEWABLE_INDEX_STATUSES.includes(String(nextStatus || '').toLowerCase())
    ? String(nextStatus).toLowerCase()
    : null;

  if (!fromStatus && !toStatus) {
    return;
  }
  if (fromStatus === toStatus) {
    return;
  }

  const deltas = {};
  if (fromStatus) {
    deltas[fromStatus] = (deltas[fromStatus] || 0) - 1;
  }
  if (toStatus) {
    deltas[toStatus] = (deltas[toStatus] || 0) + 1;
  }

  await driverDocumentStore.adjustStats(firestore, safeDocumentType, deltas);
}

async function recomputeDriverActivationStatus(driverId) {
  const safeDriverId = String(driverId || '').trim();
  if (!safeDriverId) {
    throw new Error('DRIVER_ID_REQUIRED');
  }

  const firestore = getFirestoreOrThrow();
  const activationNode = await driverDocumentStore.readActivation(firestore, safeDriverId) || {};
  const documents = activationNode.documents || {};
  const consent = activationNode.consent || {};

  const checklist = {
    cnhEar: String(documents?.cnh?.status || '').toLowerCase() === 'approved',
    vehicleRegistration: String(documents?.crlv?.status || '').toLowerCase() === 'approved',
    inssOrMei: String(documents?.mei?.status || '').toLowerCase() === 'approved',
    backgroundCheckConsent: Boolean(consent?.backgroundCheck?.acceptedAt)
  };

  const summary = {
    inReview: 0,
    approved: 0,
    failed: 0,
    pending: 0
  };

  ALLOWED_DRIVER_DOCUMENT_TYPES.forEach(type => {
    const status = String(documents?.[type]?.status || 'pending').toLowerCase();
    if (status === 'in_review') {
      summary.inReview += 1;
    } else if (status === 'approved') {
      summary.approved += 1;
    } else if (status === 'failed') {
      summary.failed += 1;
    } else {
      summary.pending += 1;
    }
  });

  const canonicalState = await driverActivationStateService.resolveDriverActivationState({
    driverId: safeDriverId,
    activationNode
  });
  const storedStatus = activationNode?.status || {};
  const canGoOnline = Boolean(canonicalState?.canGoOnline);

  const updatedAt = nowIso();
  const statusPayload = {
    checklist,
    canGoOnline,
    activationState: canonicalState?.state || null,
    activationStateLabel: canonicalState?.label || null,
    canAttemptOnline: Boolean(canonicalState?.canAttemptOnline),
    requiresLiveness: Boolean(canonicalState?.requiresLiveness),
    blockingReason: canonicalState?.blockingReason || null,
    kyc: canonicalState?.kyc || storedStatus?.kyc || {},
    vehicle: canonicalState?.vehicle || {},
    liveness: canonicalState?.liveness || {},
    summary,
    updatedAt
  };

  await driverDocumentStore.commit(firestore, [
    activationWrite(safeDriverId, ['status'], statusPayload),
    // RTDB `update` semantics: only these keys of driverActivation change.
    ...Object.entries({ ...statusPayload, source: 'driver_activation_pipeline' })
      .map(([field, value]) => userWrite(safeDriverId, ['driverActivation', field], value))
  ]);

  if (canGoOnline) {
    try {
      // Carregado sob demanda para não criar ciclo de inicialização.
      const { getDefaultDriverAutoApprovalService } = require('./driver-auto-approval-service');
      await getDefaultDriverAutoApprovalService().maybeAutoApprove({
        driverId: safeDriverId,
        canonicalState
      });
    } catch (error) {
      logStructured('warn', 'Falha na aprovação automática do motorista', {
        service: 'driver-activation-queue',
        driverId: safeDriverId,
        error: error?.message || String(error)
      });
    }
  }

  return {
    driverId: safeDriverId,
    checklist,
    canGoOnline,
    activationState: canonicalState?.state || null,
    activationStateLabel: canonicalState?.label || null,
    canAttemptOnline: Boolean(canonicalState?.canAttemptOnline),
    requiresLiveness: Boolean(canonicalState?.requiresLiveness),
    blockingReason: canonicalState?.blockingReason || null,
    kyc: statusPayload?.kyc || {},
    vehicle: canonicalState?.vehicle || {},
    liveness: canonicalState?.liveness || {},
    summary,
    documents,
    updatedAt
  };
}

async function syncDriverApplicationMirror(driverId) {
  try {
    // Resolve lazily so document analysis never creates an initialization cycle.
    const driverApplicationService = require('./driver-application-service');
    await driverApplicationService.syncDriverApplication(driverId, {
      includeRatings: false
    });
  } catch (error) {
    logStructured('warn', 'Falha ao sincronizar espelho do dashboard apos analise documental', {
      service: 'driver-activation-queue',
      driverId,
      error: error?.message || String(error)
    });
  }
}

async function updateDocumentState({
  driverId,
  documentType,
  submissionId,
  status,
  reason = '',
  data = null,
  extractionSource = null,
  model = null,
  metadata = {},
  biometricState = null,
  io = null
}) {
  const safeDriverId = String(driverId || '').trim();
  const safeType = sanitizeDocumentType(documentType);
  const safeSubmissionId = String(submissionId || '').trim();

  if (!safeDriverId || !safeType || !safeSubmissionId) {
    throw new Error('INVALID_DOCUMENT_STATE_UPDATE');
  }

  let normalizedStatus = String(status || 'pending').trim().toLowerCase();
  const statusUpdatedAt = nowIso();
  const expectedBinding = requireCompleteDocumentBinding({
    ...metadata,
    submissionId: safeSubmissionId
  });

  const activationDocField = ['documents', safeType];
  const activationHistoryField = ['documents_history', safeSubmissionId];
  const userDocumentField = ['documents', safeType];

  const normalizedDocumentData = safeType === 'crlv' && data
    ? normalizeVehicleOcrPayload(data)
    : data || null;
  let effectiveReason = reason || '';

  if (safeType === 'crlv' && normalizedStatus === 'approved' && !hasRequiredCrlvVehicleIdentity(normalizedDocumentData)) {
    normalizedStatus = 'failed';
    effectiveReason = 'CRLV sem dados obrigatórios de veículo (placa, RENAVAM, modelo e cor).';
  }
  const reviewStatus = toReviewQueueStatus(normalizedStatus);

  return runWithDocumentMutationLease({
    driverId: safeDriverId,
    documentType: safeType,
    scope: `analysis_result_${safeSubmissionId}`
  }, async ({ firestore, lease }) => {
    const {
      activationDocument: currentDocument,
      userDocument: previousUserDocument,
      historyDocument: existingHistory
    } = await driverDocumentStore.readDocumentBinding(firestore, {
      driverId: safeDriverId,
      documentType: safeType,
      submissionId: safeSubmissionId
    });
    const currentBinding = normalizeDocumentBinding(currentDocument);

    if (!documentBindingsMatch(expectedBinding, currentBinding)) {
      const supersededReason = 'Resultado ignorado porque uma submissao mais recente substituiu este documento.';
      const supersededPayload = {
        ...existingHistory,
        ...metadata,
        documentType: safeType,
        submissionId: safeSubmissionId,
        filePath: expectedBinding.filePath,
        documentSha256: expectedBinding.documentSha256,
        storageGeneration: expectedBinding.storageGeneration,
        status: 'superseded',
        reason: supersededReason,
        resultStatus: normalizedStatus,
        resultReason: effectiveReason,
        result: {
          status: normalizedStatus,
          reason: effectiveReason,
          data: normalizedDocumentData,
          extractionSource: extractionSource || null,
          model: model || null,
          completedAt: statusUpdatedAt
        },
        supersededBySubmissionId: currentBinding.submissionId || null,
        supersededBy: currentBinding,
        supersededAt: statusUpdatedAt,
        updatedAt: statusUpdatedAt,
        createdAt: metadata?.createdAt || existingHistory?.createdAt || statusUpdatedAt
      };

      await lease.assertHeld();
      await driverDocumentStore.commit(firestore, [
        activationWrite(safeDriverId, activationHistoryField, supersededPayload)
      ]);
      runtimeMetrics.recordRealtimeUpdate('driver_activation_queue', 'result_superseded');
      logStructured('info', 'Resultado documental antigo preservado apenas no historico', {
        service: 'driver-activation-queue',
        driverId: safeDriverId,
        documentType: safeType,
        submissionId: safeSubmissionId,
        supersededBySubmissionId: currentBinding.submissionId || null
      });

      return {
        stale: true,
        superseded: true,
        eventPayload: null,
        aggregatedStatus: null,
        documentPayload: supersededPayload,
        vehicleLink: null
      };
    }

    const previousReviewStatus = String(previousUserDocument?.status || '').toLowerCase();

    const basePayload = {
      ...metadata,
      documentType: safeType,
      submissionId: safeSubmissionId,
      filePath: expectedBinding.filePath,
      documentSha256: expectedBinding.documentSha256,
      storageGeneration: expectedBinding.storageGeneration,
      status: normalizedStatus,
      reason: effectiveReason,
      updatedAt: statusUpdatedAt,
      reviewedAt: normalizedStatus === 'approved' || normalizedStatus === 'failed' ? statusUpdatedAt : null,
      model: model || null,
      extractionSource: extractionSource || null,
      data: normalizedDocumentData
    };

    const historyPayload = {
      ...basePayload,
      createdAt: metadata?.createdAt || previousUserDocument?.uploadedAt || statusUpdatedAt
    };

    const userDocumentPayload = {
      ...(previousUserDocument || {}),
      type: safeType,
      status: reviewStatus,
      analysisStatus: normalizedStatus,
      analysisReason: effectiveReason,
      analysisData: normalizedDocumentData,
      // The dashboard review projection reads extractedData. Keep it aligned with
      // analysisData so the CRLV identity cannot diverge between operational views.
      extractedData: normalizedDocumentData,
      reviewedAt: normalizedStatus === 'approved' || normalizedStatus === 'failed' ? statusUpdatedAt : null,
      rejectionReason: normalizedStatus === 'failed' ? effectiveReason || 'Documento reprovado na análise.' : null,
      updatedAt: statusUpdatedAt,
      lastSubmissionId: safeSubmissionId,
      filePath: expectedBinding.filePath,
      documentSha256: expectedBinding.documentSha256,
      storageGeneration: expectedBinding.storageGeneration,
      model: model || null,
      extractionSource: extractionSource || null
    };

    const crlvVehicleLink = safeType === 'crlv' && normalizedStatus === 'approved'
      ? await buildApprovedCrlvVehicleLinkUpdates({
        firestore,
        driverId: safeDriverId,
        crlvData: normalizedDocumentData,
        submissionId: safeSubmissionId,
        extractionSource,
        model,
        updatedAt: statusUpdatedAt
      })
      : null;

    await lease.assertHeld();
    // driver_documents_index is no longer written: nothing reads it and it is
    // not served by Firestore (writes were dropped once RTDB was retired).
    await driverDocumentStore.commit(firestore, [
      ...driverDocumentStore.vehicleLinkWrites(crlvVehicleLink?.updates || {}),
      ...(safeType === 'cnh' && biometricState?.userPayload
        ? [userWrite(safeDriverId, ['biometrics', 'cnhFace'], biometricState.userPayload)]
        : []),
      ...(safeType === 'cnh' && biometricState?.activationPayload
        ? [activationWrite(safeDriverId, ['biometrics', 'cnhFace'], biometricState.activationPayload)]
        : []),
      activationWrite(safeDriverId, activationDocField, basePayload),
      activationWrite(safeDriverId, activationHistoryField, historyPayload),
      userWrite(safeDriverId, userDocumentField, userDocumentPayload),
      activationWrite(safeDriverId, ['updatedAt'], statusUpdatedAt)
    ]);

    if (crlvVehicleLink) {
      runtimeMetrics.recordRealtimeUpdate(
        'driver_activation',
        crlvVehicleLink.createdLink ? 'crlv_vehicle_link_created' : 'crlv_vehicle_link_reused'
      );
      logStructured('info', 'CRLV aprovado materializado no cadastro canonico de veiculo', {
        service: 'driver-activation-queue',
        driverId: safeDriverId,
        submissionId: safeSubmissionId,
        vehicleId: crlvVehicleLink.vehicleId,
        userVehicleId: crlvVehicleLink.userVehicleId,
        createdCatalog: crlvVehicleLink.createdCatalog,
        createdLink: crlvVehicleLink.createdLink
      });
    }

    await adjustDocumentIndexCounters(firestore, safeType, previousReviewStatus, reviewStatus);

    runtimeMetrics.recordRealtimeUpdate(
      'driver_activation',
      normalizedStatus === 'failed' ? 'doc_failed' : normalizedStatus === 'in_review' ? 'doc_in_review' : `doc_${normalizedStatus}`
    );

    if (normalizedStatus === 'failed') {
      runtimeMetrics.recordRealtimeUpdate('doc_failed', 'total');
    }
    if (normalizedStatus === 'in_review') {
      runtimeMetrics.recordRealtimeUpdate('doc_in_review', 'total');
    }

    const aggregatedStatus = await recomputeDriverActivationStatus(safeDriverId);
    await syncDriverApplicationMirror(safeDriverId);

    const eventPayload = {
      driverId: safeDriverId,
      documentType: safeType,
      submissionId: safeSubmissionId,
      status: normalizedStatus,
      reason: effectiveReason,
      updatedAt: statusUpdatedAt,
      canGoOnline: Boolean(aggregatedStatus?.canGoOnline)
    };

    if (io) {
      io.to(`driver_${safeDriverId}`).emit('driverDocumentStatusUpdated', eventPayload);
    }

    return {
      stale: false,
      superseded: false,
      eventPayload,
      aggregatedStatus,
      documentPayload: basePayload,
      vehicleLink: crlvVehicleLink
    };
  });
}

async function analyzeCnhDocument(fileBuffer) {
  if (!documentAIExtractionService.enabled) {
    throw new Error('OPENAI_DOCUMENT_ANALYSIS_UNAVAILABLE');
  }

  let extractedText = '';
  try {
    extractedText = await ocrService.extractTextFromPDF(fileBuffer);
  } catch (error) {
    logStructured('warn', 'Falha na extração textual da CNH para ativação', {
      service: 'driver-activation-queue',
      error: error?.message || String(error)
    });
  }

  let data = null;
  let extractionSource = 'pdf_text';

  if (hasUsefulCnhText(extractedText)) {
    data = await documentAIExtractionService.extractCNHFromText(extractedText, {
      source: 'driver_activation_pdf_text',
      textLength: extractedText.length
    });
  } else {
    const imageBuffer = await ocrService.convertPDFToImage(fileBuffer);
    data = await documentAIExtractionService.extractCNHFromImageBuffer(imageBuffer, {
      source: 'driver_activation_pdf_image',
      imageBytes: imageBuffer.length
    });
    extractionSource = 'pdf_image';
  }

  const documentIdentity = validateCnhDocumentIdentity({
    text: extractedText,
    data
  });

  if (!documentIdentity.valid) {
    return {
      success: false,
      reason: 'O documento enviado não parece ser uma CNH válida. Envie sua CNH Digital em PDF.',
      data: {
        ...(data || {}),
        documentIdentity
      },
      extractionSource
    };
  }

  const hasRequiredIdentity = Boolean(String(data?.nome || '').trim()) && Boolean(String(data?.cpf || '').trim());
  if (!hasRequiredIdentity) {
    return {
      success: false,
      reason: 'Não foi possível validar os dados principais da CNH (nome/CPF).',
      data,
      extractionSource
    };
  }

  const earValue = data?.ear;
  const earApproved = earValue === true || String(earValue || '').trim().toLowerCase() === 'sim';
  if (!earApproved) {
    return {
      success: false,
      reason: 'CNH enviada não possui EAR válido para operação na plataforma.',
      data,
      extractionSource
    };
  }

  return {
    success: true,
    data,
    extractionSource,
    model: data?.extractedBy || documentAIExtractionService.model || 'gpt-5.4-mini'
  };
}

async function analyzeCrlvDocument(fileBuffer) {
  if (!documentAIExtractionService.enabled) {
    throw new Error('OPENAI_DOCUMENT_ANALYSIS_UNAVAILABLE');
  }

  let extractedText = '';
  try {
    extractedText = await ocrService.extractTextFromPDF(fileBuffer);
  } catch (error) {
    logStructured('warn', 'Falha na extração textual do CRLV para ativação', {
      service: 'driver-activation-queue',
      error: error?.message || String(error)
    });
  }

  let data = null;
  let extractionSource = 'pdf_text';

  if (hasUsefulVehicleText(extractedText)) {
    data = await documentAIExtractionService.extractVehicleFromText(extractedText, {
      source: 'driver_activation_pdf_text',
      textLength: extractedText.length
    });
  } else {
    const imageBuffer = await ocrService.convertPDFToImage(fileBuffer);
    data = await documentAIExtractionService.extractVehicleFromImageBuffer(imageBuffer, {
      source: 'driver_activation_pdf_image',
      imageBytes: imageBuffer.length
    });
    extractionSource = 'pdf_image';
  }

  data = normalizeVehicleOcrPayload(data || {});

  if (!hasRequiredCrlvVehicleIdentity(data)) {
    return {
      success: false,
      reason: 'CRLV sem dados obrigatórios de veículo (placa, RENAVAM, modelo e cor).',
      data,
      extractionSource
    };
  }

  return {
    success: true,
    data,
    extractionSource,
    model: data?.extractedBy || documentAIExtractionService.model || 'gpt-5.4-mini'
  };
}

async function analyzeMeiDocument(fileBuffer) {
  const text = await ocrService.extractText(fileBuffer, 'application/pdf');
  const normalized = normalizeText(text);
  const hasMeiMarker = normalized.includes('mei') || normalized.includes('microempreendedor');
  const hasActiveStatus =
    normalized.includes('situacao cadastral') && normalized.includes('ativa') ||
    normalized.includes('situacao: ativo') ||
    normalized.includes('status: ativo');

  if (!hasMeiMarker || !hasActiveStatus) {
    return {
      success: false,
      reason: 'Comprovante de MEI inválido ou sem status ativo.',
      data: {
        detected: false,
        active: false
      },
      extractionSource: 'pdf_text',
      model: 'rule_engine'
    };
  }

  return {
    success: true,
    data: {
      detected: true,
      active: true
    },
    extractionSource: 'pdf_text',
    model: 'rule_engine'
  };
}

function buildQueuedDocumentMetadata(job = {}) {
  return {
    fileName: job.fileName,
    fileType: job.fileType,
    fileSize: Number(job.fileSize || 0),
    fileUrl: job.fileUrl || null,
    filePath: job.filePath || null,
    fileUrlExpiresAt: job.fileUrlExpiresAt || null,
    documentSha256: job.documentSha256 || null,
    storageGeneration: job.storageGeneration || null,
    createdAt: job.createdAt || nowIso(),
    uploadedAt: job.uploadedAt || nowIso()
  };
}

class DriverDocumentAnalysisQueue {
  constructor() {
    this.jobs = [];
    this.processing = false;
  }

  enqueue(job) {
    this.jobs.push(job);
    runtimeMetrics.recordRealtimeUpdate('driver_activation_queue', 'enqueued');
    this.run().catch(error => {
      logError(error, 'Erro inesperado no processamento da fila de documentos de ativação', {
        service: 'driver-activation-queue'
      });
    });
  }

  async run() {
    if (this.processing) {
      return;
    }

    this.processing = true;

    while (this.jobs.length > 0) {
      const currentJob = this.jobs.shift();
      if (!currentJob) {
        continue;
      }

      const startedAt = Date.now();
      const safeDriverId = String(currentJob.driverId || '').trim();
      const safeDocumentType = sanitizeDocumentType(currentJob.documentType);

      try {
        runtimeMetrics.recordRealtimeUpdate('driver_activation_queue', 'processing');
        logStructured('info', 'Processando documento de ativação', {
          service: 'driver-activation-queue',
          driverId: safeDriverId,
          documentType: safeDocumentType,
          submissionId: currentJob.submissionId
        });

        let analysisResult = null;
        if (safeDocumentType === 'cnh') {
          analysisResult = await analyzeCnhDocument(currentJob.fileBuffer);
        } else if (safeDocumentType === 'crlv') {
          analysisResult = await analyzeCrlvDocument(currentJob.fileBuffer);
        } else if (safeDocumentType === 'mei') {
          analysisResult = await analyzeMeiDocument(currentJob.fileBuffer);
        } else {
          throw new Error(`UNSUPPORTED_DOCUMENT_TYPE_${safeDocumentType || 'unknown'}`);
        }

        if (!analysisResult?.success) {
          const persistenceResult = await updateDocumentState({
            driverId: safeDriverId,
            documentType: safeDocumentType,
            submissionId: currentJob.submissionId,
            status: 'failed',
            reason: analysisResult?.reason || 'Documento reprovado na análise automatizada.',
            data: analysisResult?.data || null,
            extractionSource: analysisResult?.extractionSource || null,
            model: analysisResult?.model || null,
            metadata: buildQueuedDocumentMetadata(currentJob),
            io: currentJob.io
          });

          runtimeMetrics.recordRealtimeUpdate(
            'driver_activation_queue',
            persistenceResult?.stale ? 'processed_superseded' : 'processed_failed'
          );
          continue;
        }

        const cnhFaceBiometric = safeDocumentType === 'cnh'
          ? await generateCnhFaceBiometricShadow({
            driverId: safeDriverId,
            submissionId: currentJob.submissionId,
            fileBuffer: currentJob.fileBuffer
          })
          : null;

        const persistenceResult = await updateDocumentState({
          driverId: safeDriverId,
          documentType: safeDocumentType,
          submissionId: currentJob.submissionId,
          status: 'approved',
          reason: '',
          data: analysisResult.data || null,
          extractionSource: analysisResult.extractionSource || null,
          model: analysisResult.model || null,
          metadata: {
            ...buildQueuedDocumentMetadata(currentJob),
            biometricFace: cnhFaceBiometric?.documentPayload || null
          },
          biometricState: cnhFaceBiometric,
          io: currentJob.io
        });

        runtimeMetrics.recordRealtimeUpdate(
          'driver_activation_queue',
          persistenceResult?.stale ? 'processed_superseded' : 'processed_success'
        );
      } catch (error) {
        logError(error, 'Erro ao analisar documento de ativação', {
          service: 'driver-activation-queue',
          driverId: safeDriverId,
          documentType: safeDocumentType,
          submissionId: currentJob.submissionId
        });

        try {
          const persistenceResult = await updateDocumentState({
            driverId: safeDriverId,
            documentType: safeDocumentType,
            submissionId: currentJob.submissionId,
            status: 'failed',
            reason: 'Falha técnica temporária na análise. Reenvie o documento em alguns minutos.',
            data: null,
            extractionSource: null,
            model: null,
            metadata: buildQueuedDocumentMetadata(currentJob),
            io: currentJob.io
          });
          if (persistenceResult?.stale) {
            runtimeMetrics.recordRealtimeUpdate('driver_activation_queue', 'processed_superseded');
          }
        } catch (nestedError) {
          logError(nestedError, 'Erro ao marcar documento como failed após exceção', {
            service: 'driver-activation-queue',
            driverId: safeDriverId,
            documentType: safeDocumentType,
            submissionId: currentJob.submissionId
          });
        }

        runtimeMetrics.recordRealtimeUpdate('driver_activation_queue', 'processed_error');
      } finally {
        const durationMs = Date.now() - startedAt;
        runtimeMetrics.recordHotpathLatency('driver_activation_document_analysis', durationMs / 1000, true);
      }
    }

    this.processing = false;
  }

  async setConsentBackgroundCheck({ driverId, accepted, io = null }) {
    const safeDriverId = String(driverId || '').trim();
    if (!safeDriverId) {
      throw new Error('DRIVER_ID_REQUIRED');
    }

    const acceptedNow = Boolean(accepted);
    const updatedAt = nowIso();

    await driverDocumentStore.commit(getFirestoreOrThrow(), [
      activationWrite(safeDriverId, ['consent', 'backgroundCheck'], {
        acceptedAt: acceptedNow ? updatedAt : null,
        accepted: acceptedNow,
        updatedAt
      }),
      userWrite(safeDriverId, ['driverActivationConsent', 'backgroundCheck'], acceptedNow),
      userWrite(safeDriverId, ['driverActivationConsent', 'updatedAt'], updatedAt)
    ]);

    const aggregatedStatus = await recomputeDriverActivationStatus(safeDriverId);

    if (io) {
      io.to(`driver_${safeDriverId}`).emit('driverDocumentStatusUpdated', {
        driverId: safeDriverId,
        documentType: 'background_check_consent',
        status: acceptedNow ? 'approved' : 'pending',
        reason: '',
        updatedAt,
        canGoOnline: Boolean(aggregatedStatus?.canGoOnline)
      });
    }

    return aggregatedStatus;
  }

  async getActivationSnapshot(driverId) {
    const safeDriverId = String(driverId || '').trim();
    if (!safeDriverId) {
      throw new Error('DRIVER_ID_REQUIRED');
    }

      const firestore = getFirestoreOrThrow();
    const [activationNode, userData] = await Promise.all([
      driverDocumentStore.readActivation(firestore, safeDriverId).then(value => value || {}),
      driverDocumentStore.readUser(firestore, safeDriverId).then(value => value || {})
    ]);
    const docs = activationNode?.documents || {};
    const consentAcceptedAt = activationNode?.consent?.backgroundCheck?.acceptedAt || null;

    const summary = {
      inReview: 0,
      approved: 0,
      failed: 0,
      pending: 0
    };

    const byType = {};
    ALLOWED_DRIVER_DOCUMENT_TYPES.forEach(type => {
      const normalizedStatus = String(docs?.[type]?.status || 'pending').toLowerCase();
      if (normalizedStatus === 'in_review') {
        summary.inReview += 1;
      } else if (normalizedStatus === 'approved') {
        summary.approved += 1;
      } else if (normalizedStatus === 'failed') {
        summary.failed += 1;
      } else {
        summary.pending += 1;
      }

      byType[type] = {
        documentType: type,
        status: normalizedStatus,
        reason: String(docs?.[type]?.reason || ''),
        updatedAt: docs?.[type]?.updatedAt || null,
        reviewedAt: docs?.[type]?.reviewedAt || null,
        uploadedAt: docs?.[type]?.uploadedAt || null,
        fileName: docs?.[type]?.fileName || null,
        fileType: docs?.[type]?.fileType || null,
        fileSize: Number(docs?.[type]?.fileSize || 0),
        data: docs?.[type]?.data || null
      };
    });

    let canonicalState = null;
    try {
      canonicalState = await driverActivationStateService.resolveDriverActivationState({
        driverId: safeDriverId,
        activationNode,
        userData
      });
    } catch (error) {
      logStructured('warn', 'Falha ao calcular estado canônico de ativação em tempo real', {
        service: 'driver-activation-queue',
        driverId: safeDriverId,
        error: error?.message || String(error)
      });
    }

    const storedStatus = activationNode?.status || {};
    const statusPayload = {
      checklist: canonicalState?.checklist || storedStatus?.checklist || {},
      canGoOnline: Boolean(
        canonicalState?.canGoOnline ??
          storedStatus?.canGoOnline
      ),
      activationState: canonicalState?.state || storedStatus?.activationState || null,
      activationStateLabel: canonicalState?.label || storedStatus?.activationStateLabel || null,
      canAttemptOnline: Boolean(
        canonicalState?.canAttemptOnline ??
          storedStatus?.canAttemptOnline
      ),
      requiresLiveness: Boolean(
        canonicalState?.requiresLiveness ??
          storedStatus?.requiresLiveness
      ),
      blockingReason: canonicalState?.blockingReason || storedStatus?.blockingReason || null,
      kyc: canonicalState?.kyc || storedStatus?.kyc || {},
      vehicle: canonicalState?.vehicle || storedStatus?.vehicle || {},
      liveness: canonicalState?.liveness || storedStatus?.liveness || {},
      summary,
      updatedAt:
        canonicalState?.updatedAt ||
        storedStatus?.updatedAt ||
        activationNode?.updatedAt ||
        null
    };

    return {
      driverId: safeDriverId,
      checklist: {
        ...(statusPayload?.checklist || {}),
        backgroundCheckConsent:
          Boolean(consentAcceptedAt) ||
          Boolean(statusPayload?.checklist?.backgroundCheckConsent)
      },
      canGoOnline: Boolean(statusPayload?.canGoOnline),
      activationState: statusPayload?.activationState || null,
      activationStateLabel: statusPayload?.activationStateLabel || null,
      canAttemptOnline: Boolean(statusPayload?.canAttemptOnline),
      requiresLiveness: Boolean(statusPayload?.requiresLiveness),
      blockingReason: statusPayload?.blockingReason || null,
      kyc: statusPayload?.kyc || {},
      vehicle: statusPayload?.vehicle || {},
      liveness: statusPayload?.liveness || {},
      summary,
      documents: byType,
      consent: {
        backgroundCheck: {
          acceptedAt: consentAcceptedAt,
          accepted: Boolean(consentAcceptedAt),
          updatedAt: activationNode?.consent?.backgroundCheck?.updatedAt || null
        }
      },
      updatedAt: statusPayload?.updatedAt || activationNode?.updatedAt || null
    };
  }

  async listActivationDocuments(driverId) {
    const safeDriverId = String(driverId || '').trim();
    if (!safeDriverId) {
      throw new Error('DRIVER_ID_REQUIRED');
    }

    const activationNode = await driverDocumentStore.readActivation(getFirestoreOrThrow(), safeDriverId);
    const historyMap = activationNode?.documents_history || {};

    const items = Object.entries(historyMap)
      .map(([submissionId, payload]) => ({
        submissionId,
        documentType: payload?.documentType || null,
        status: payload?.status || 'pending',
        reason: payload?.reason || '',
        updatedAt: payload?.updatedAt || null,
        reviewedAt: payload?.reviewedAt || null,
        uploadedAt: payload?.uploadedAt || payload?.createdAt || null,
        fileName: payload?.fileName || null,
        fileType: payload?.fileType || null,
        fileSize: Number(payload?.fileSize || 0),
        data: payload?.data || null
      }))
      .sort((left, right) => {
        const leftTs = new Date(left.updatedAt || left.uploadedAt || 0).getTime();
        const rightTs = new Date(right.updatedAt || right.uploadedAt || 0).getTime();
        return rightTs - leftTs;
      });

    return items;
  }
}

const driverDocumentAnalysisQueue = new DriverDocumentAnalysisQueue();

module.exports = {
  driverDocumentAnalysisQueue,
  ALLOWED_DRIVER_DOCUMENT_TYPES,
  sanitizeDocumentType,
  recomputeDriverActivationStatus,
  commitDocumentSubmissionState,
  runWithDocumentMutationLease,
  runWithCurrentDocumentBinding,
  updateDocumentState,
  isRetryableCnhFaceBiometricError,
  getCnhFaceBiometricRetryDelayMs
};
