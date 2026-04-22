const firebaseConfig = require('../firebase-config');
const ocrService = require('./ocr-service');
const documentAIExtractionService = require('./document-ai-extraction-service');
const { logStructured, logError } = require('../utils/logger');
const { metrics: runtimeMetrics } = require('../utils/prometheus-metrics');
const driverActivationStateService = require('./driver-activation-state-service');

const ALLOWED_DRIVER_DOCUMENT_TYPES = Object.freeze(['cnh', 'crlv', 'mei']);
const REVIEWABLE_INDEX_STATUSES = Object.freeze(['pending', 'approved', 'rejected']);

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

  const normalizedStatus = String(status || 'pending').trim().toLowerCase();
  const statusUpdatedAt = nowIso();
  const db = getDbOrThrow();

  const activationDocPath = `driver_activation/${safeDriverId}/documents/${safeType}`;
  const activationHistoryPath = `driver_activation/${safeDriverId}/documents_history/${safeSubmissionId}`;
  const userDocumentPath = `users/${safeDriverId}/documents/${safeType}`;

  const previousUserDocumentSnapshot = await db.ref(userDocumentPath).once('value');
  const previousUserDocument = previousUserDocumentSnapshot.val() || {};
  const previousReviewStatus = String(previousUserDocument?.status || '').toLowerCase();

  const reviewStatus = toReviewQueueStatus(normalizedStatus);

  const basePayload = {
    documentType: safeType,
    status: normalizedStatus,
    reason: reason || '',
    updatedAt: statusUpdatedAt,
    reviewedAt: normalizedStatus === 'approved' || normalizedStatus === 'failed' ? statusUpdatedAt : null,
    model: model || null,
    extractionSource: extractionSource || null,
    data: data || null,
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
    analysisReason: reason || '',
    analysisData: data || null,
    reviewedAt: normalizedStatus === 'approved' || normalizedStatus === 'failed' ? statusUpdatedAt : null,
    rejectionReason: normalizedStatus === 'failed' ? reason || 'Documento reprovado na análise.' : null,
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

  await db.ref().update({
    [activationDocPath]: basePayload,
    [activationHistoryPath]: historyPayload,
    [userDocumentPath]: userDocumentPayload,
    [`driver_documents_index/${safeType}/pending/${safeDriverId}`]: reviewStatus === 'pending' ? indexPayload : null,
    [`driver_documents_index/${safeType}/approved/${safeDriverId}`]: reviewStatus === 'approved' ? indexPayload : null,
    [`driver_documents_index/${safeType}/rejected/${safeDriverId}`]: reviewStatus === 'rejected' ? indexPayload : null,
    [`driver_activation/${safeDriverId}/updatedAt`]: statusUpdatedAt
  });

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

  const eventPayload = {
    driverId: safeDriverId,
    documentType: safeType,
    submissionId: safeSubmissionId,
    status: normalizedStatus,
    reason: reason || '',
    updatedAt: statusUpdatedAt,
    canGoOnline: Boolean(aggregatedStatus?.canGoOnline)
  };

  if (io) {
    io.to(`driver_${safeDriverId}`).emit('driverDocumentStatusUpdated', eventPayload);
  }

  return {
    eventPayload,
    aggregatedStatus,
    documentPayload: basePayload
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

  const hasVehicleIdentity = Boolean(String(data?.placa || '').trim()) && Boolean(String(data?.renavam || '').trim());
  if (!hasVehicleIdentity) {
    return {
      success: false,
      reason: 'CRLV sem dados mínimos válidos (placa/renavam).',
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
            uploadedAt: currentJob.uploadedAt || nowIso()
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
    const activationSnapshot = await db.ref(`driver_activation/${safeDriverId}`).once('value');
    const activationNode = activationSnapshot.val() || {};

    let statusPayload = activationNode?.status || null;
    if (!statusPayload || typeof statusPayload !== 'object') {
      const recomputed = await recomputeDriverActivationStatus(safeDriverId);
      statusPayload = {
        checklist: recomputed.checklist,
        canGoOnline: recomputed.canGoOnline,
        activationState: recomputed.activationState || null,
        activationStateLabel: recomputed.activationStateLabel || null,
        canAttemptOnline: Boolean(recomputed.canAttemptOnline),
        requiresLiveness: Boolean(recomputed.requiresLiveness),
        blockingReason: recomputed.blockingReason || null,
        vehicle: recomputed.vehicle || {},
        liveness: recomputed.liveness || {},
        summary: recomputed.summary,
        updatedAt: recomputed.updatedAt
      };
    }

    const docs = activationNode?.documents || {};
    const byType = {};
    ALLOWED_DRIVER_DOCUMENT_TYPES.forEach(type => {
      byType[type] = {
        documentType: type,
        status: String(docs?.[type]?.status || 'pending').toLowerCase(),
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

    const consentAcceptedAt = activationNode?.consent?.backgroundCheck?.acceptedAt || null;

    return {
      driverId: safeDriverId,
      checklist: {
        ...(statusPayload?.checklist || {}),
        backgroundCheckConsent: Boolean(consentAcceptedAt)
      },
      canGoOnline: Boolean(statusPayload?.canGoOnline),
      activationState: statusPayload?.activationState || null,
      activationStateLabel: statusPayload?.activationStateLabel || null,
      canAttemptOnline: Boolean(statusPayload?.canAttemptOnline),
      requiresLiveness: Boolean(statusPayload?.requiresLiveness),
      blockingReason: statusPayload?.blockingReason || null,
      vehicle: statusPayload?.vehicle || {},
      liveness: statusPayload?.liveness || {},
      summary: statusPayload?.summary || {
        inReview: 0,
        approved: 0,
        failed: 0,
        pending: 0
      },
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
  updateDocumentState
};
