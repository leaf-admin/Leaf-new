const firebaseConfig = require('../firebase-config');
const ocrService = require('./ocr-service');
const documentAIExtractionService = require('./document-ai-extraction-service');
const CnhFaceBiometricService = require('./cnh-face-biometric-service');
const { validateCnhDocumentIdentity } = require('./cnh-document-identity-validator');
const { logStructured, logError } = require('../utils/logger');
const { metrics: runtimeMetrics } = require('../utils/prometheus-metrics');
const driverActivationStateService = require('./driver-activation-state-service');
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
const REVIEWABLE_INDEX_STATUSES = Object.freeze(['pending', 'approved', 'rejected']);
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

function getDbOrThrow() {
  const db = firebaseConfig?.getRealtimeDB?.();
  if (!db) {
    throw new Error('FIREBASE_RTDB_UNAVAILABLE');
  }
  return db;
}

function nowIso() {
  return new Date().toISOString();
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
    return {
      status: 'skipped',
      provider: 'leaf_face_compare_service',
      reason: 'not_configured',
      createdAt: nowIso()
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

        const db = getDbOrThrow();
        await db.ref().update({
          [`users/${safeDriverId}/biometrics/cnhFace`]: biometricPayload,
          [`driver_activation/${safeDriverId}/biometrics/cnhFace`]: withoutEmbedding(biometricPayload)
        });

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
        logStructured('warn', 'Falha transitória ao gerar ou armazenar embedding facial da CNH; retry agendado', {
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

    logStructured('info', 'Embedding facial da CNH armazenado em shadow mode', {
      service: 'driver-activation-queue',
      driverId: safeDriverId,
      submissionId: safeSubmissionId,
      durationMs: biometricPayload.durationMs,
      attempts,
      source: biometricPayload.source,
      detScore: biometricPayload.selectedFace?.detection_score || null
    });

    return withoutEmbedding(biometricPayload);
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

    try {
      const db = getDbOrThrow();
      await db.ref(`driver_activation/${safeDriverId}/biometrics/cnhFace`).set(failurePayload);
    } catch (statusError) {
      logError(statusError, 'Falha ao registrar status de erro da biometria CNH', {
        service: 'driver-activation-queue',
        driverId: safeDriverId,
        submissionId: safeSubmissionId
      });
    }

    return failurePayload;
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

async function adjustDocumentIndexCounters(db, documentType, previousStatus, nextStatus) {
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

  await Promise.all(
    Object.entries(deltas).map(([status, delta]) =>
      db.ref(`driver_documents_index_stats/${safeDocumentType}/${status}`).transaction(current => {
        const currentNumber = Number.parseInt(current, 10);
        const safeCurrent = Number.isFinite(currentNumber) ? currentNumber : 0;
        const nextValue = safeCurrent + delta;
        return nextValue > 0 ? nextValue : 0;
      })
    )
  );
}

async function recomputeDriverActivationStatus(driverId) {
  const safeDriverId = String(driverId || '').trim();
  if (!safeDriverId) {
    throw new Error('DRIVER_ID_REQUIRED');
  }

  const db = getDbOrThrow();
  const activationPath = `driver_activation/${safeDriverId}`;
  const activationSnapshot = await db.ref(activationPath).once('value');
  const activationNode = activationSnapshot.val() || {};
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
    db,
    activationNode
  });
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
    vehicle: canonicalState?.vehicle || {},
    liveness: canonicalState?.liveness || {},
    summary,
    updatedAt
  };

  await db.ref(`${activationPath}/status`).set(statusPayload);

  await db.ref(`users/${safeDriverId}/driverActivation`).update({
    ...statusPayload,
    source: 'driver_activation_pipeline'
  });

  return {
    driverId: safeDriverId,
    checklist,
    canGoOnline,
    activationState: canonicalState?.state || null,
    activationStateLabel: canonicalState?.label || null,
    canAttemptOnline: Boolean(canonicalState?.canAttemptOnline),
    requiresLiveness: Boolean(canonicalState?.requiresLiveness),
    blockingReason: canonicalState?.blockingReason || null,
    vehicle: canonicalState?.vehicle || {},
    liveness: canonicalState?.liveness || {},
    summary,
    documents,
    updatedAt
  };
}

async function syncDriverApplicationMirror(driverId, db) {
  try {
    // Resolve lazily so document analysis never creates an initialization cycle.
    const driverApplicationService = require('./driver-application-service');
    await driverApplicationService.syncDriverApplication(driverId, {
      db,
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
  const db = getDbOrThrow();

  const activationDocPath = `driver_activation/${safeDriverId}/documents/${safeType}`;
  const activationHistoryPath = `driver_activation/${safeDriverId}/documents_history/${safeSubmissionId}`;
  const userDocumentPath = `users/${safeDriverId}/documents/${safeType}`;

  const previousUserDocumentSnapshot = await db.ref(userDocumentPath).once('value');
  const previousUserDocument = previousUserDocumentSnapshot.val() || {};
  const previousReviewStatus = String(previousUserDocument?.status || '').toLowerCase();

  const normalizedDocumentData = safeType === 'crlv' && data
    ? normalizeVehicleOcrPayload(data)
    : data || null;
  let effectiveReason = reason || '';

  if (safeType === 'crlv' && normalizedStatus === 'approved' && !hasRequiredCrlvVehicleIdentity(normalizedDocumentData)) {
    normalizedStatus = 'failed';
    effectiveReason = 'CRLV sem dados obrigatórios de veículo (placa, RENAVAM, modelo e cor).';
  }
  const reviewStatus = toReviewQueueStatus(normalizedStatus);

  const basePayload = {
    documentType: safeType,
    status: normalizedStatus,
    reason: effectiveReason,
    updatedAt: statusUpdatedAt,
    reviewedAt: normalizedStatus === 'approved' || normalizedStatus === 'failed' ? statusUpdatedAt : null,
    model: model || null,
    extractionSource: extractionSource || null,
    data: normalizedDocumentData,
    ...metadata
  };

  const historyPayload = {
    ...basePayload,
    submissionId: safeSubmissionId,
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
    model: model || null,
    extractionSource: extractionSource || null
  };

  const indexPayload = {
    driverId: safeDriverId,
    documentType: safeType,
    status: reviewStatus,
    uploadedAt: userDocumentPayload.uploadedAt || metadata?.createdAt || statusUpdatedAt,
    reviewedAt: userDocumentPayload.reviewedAt || null,
    updatedAt: statusUpdatedAt,
    fileName: userDocumentPayload.fileName || metadata?.fileName || null,
    fileType: userDocumentPayload.fileType || metadata?.fileType || null
  };

  const crlvVehicleLink = safeType === 'crlv' && normalizedStatus === 'approved'
    ? await buildApprovedCrlvVehicleLinkUpdates({
      db,
      driverId: safeDriverId,
      crlvData: normalizedDocumentData,
      submissionId: safeSubmissionId,
      extractionSource,
      model,
      updatedAt: statusUpdatedAt
    })
    : null;

  await db.ref().update({
    ...(crlvVehicleLink?.updates || {}),
    [activationDocPath]: basePayload,
    [activationHistoryPath]: historyPayload,
    [userDocumentPath]: userDocumentPayload,
    [`driver_documents_index/${safeType}/pending/${safeDriverId}`]: reviewStatus === 'pending' ? indexPayload : null,
    [`driver_documents_index/${safeType}/approved/${safeDriverId}`]: reviewStatus === 'approved' ? indexPayload : null,
    [`driver_documents_index/${safeType}/rejected/${safeDriverId}`]: reviewStatus === 'rejected' ? indexPayload : null,
    [`driver_activation/${safeDriverId}/updatedAt`]: statusUpdatedAt
  });

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

  await adjustDocumentIndexCounters(db, safeType, previousReviewStatus, reviewStatus);

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
  await syncDriverApplicationMirror(safeDriverId, db);

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
    eventPayload,
    aggregatedStatus,
    documentPayload: basePayload,
    vehicleLink: crlvVehicleLink
  };
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
          await updateDocumentState({
            driverId: safeDriverId,
            documentType: safeDocumentType,
            submissionId: currentJob.submissionId,
            status: 'failed',
            reason: analysisResult?.reason || 'Documento reprovado na análise automatizada.',
            data: analysisResult?.data || null,
            extractionSource: analysisResult?.extractionSource || null,
            model: analysisResult?.model || null,
            metadata: {
              fileName: currentJob.fileName,
              fileType: currentJob.fileType,
              fileSize: Number(currentJob.fileSize || 0),
              fileUrl: currentJob.fileUrl || null,
              filePath: currentJob.filePath || null,
              createdAt: currentJob.createdAt || nowIso(),
              uploadedAt: currentJob.uploadedAt || nowIso()
            },
            io: currentJob.io
          });

          runtimeMetrics.recordRealtimeUpdate('driver_activation_queue', 'processed_failed');
          continue;
        }

        const cnhFaceBiometric = safeDocumentType === 'cnh'
          ? await generateCnhFaceBiometricShadow({
            driverId: safeDriverId,
            submissionId: currentJob.submissionId,
            fileBuffer: currentJob.fileBuffer
          })
          : null;

        await updateDocumentState({
          driverId: safeDriverId,
          documentType: safeDocumentType,
          submissionId: currentJob.submissionId,
          status: 'approved',
          reason: '',
          data: analysisResult.data || null,
          extractionSource: analysisResult.extractionSource || null,
          model: analysisResult.model || null,
          metadata: {
            fileName: currentJob.fileName,
            fileType: currentJob.fileType,
            fileSize: Number(currentJob.fileSize || 0),
            fileUrl: currentJob.fileUrl || null,
            filePath: currentJob.filePath || null,
            createdAt: currentJob.createdAt || nowIso(),
            uploadedAt: currentJob.uploadedAt || nowIso(),
            biometricFace: cnhFaceBiometric
          },
          io: currentJob.io
        });

        runtimeMetrics.recordRealtimeUpdate('driver_activation_queue', 'processed_success');
      } catch (error) {
        logError(error, 'Erro ao analisar documento de ativação', {
          service: 'driver-activation-queue',
          driverId: safeDriverId,
          documentType: safeDocumentType,
          submissionId: currentJob.submissionId
        });

        try {
          await updateDocumentState({
            driverId: safeDriverId,
            documentType: safeDocumentType,
            submissionId: currentJob.submissionId,
            status: 'failed',
            reason: 'Falha técnica temporária na análise. Reenvie o documento em alguns minutos.',
            data: null,
            extractionSource: null,
            model: null,
            metadata: {
              fileName: currentJob.fileName,
              fileType: currentJob.fileType,
              fileSize: Number(currentJob.fileSize || 0),
              fileUrl: currentJob.fileUrl || null,
              filePath: currentJob.filePath || null,
              createdAt: currentJob.createdAt || nowIso(),
              uploadedAt: currentJob.uploadedAt || nowIso()
            },
            io: currentJob.io
          });
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

    const db = getDbOrThrow();
    const acceptedNow = Boolean(accepted);
    const updatedAt = nowIso();

    await db.ref(`driver_activation/${safeDriverId}/consent/backgroundCheck`).set({
      acceptedAt: acceptedNow ? updatedAt : null,
      accepted: acceptedNow,
      updatedAt
    });

    await db.ref(`users/${safeDriverId}/driverActivationConsent`).update({
      backgroundCheck: acceptedNow,
      updatedAt
    });

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

    const db = getDbOrThrow();
    const [activationSnapshot, userSnapshot] = await Promise.all([
      db.ref(`driver_activation/${safeDriverId}`).once('value'),
      db.ref(`users/${safeDriverId}`).once('value')
    ]);
    const activationNode = activationSnapshot.val() || {};
    const userData = userSnapshot.val() || {};
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
        db,
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

    const db = getDbOrThrow();
    const historySnapshot = await db.ref(`driver_activation/${safeDriverId}/documents_history`).once('value');
    const historyMap = historySnapshot.val() || {};

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
  updateDocumentState,
  isRetryableCnhFaceBiometricError,
  getCnhFaceBiometricRetryDelayMs
};
