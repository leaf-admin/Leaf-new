const firebaseConfig = require('../firebase-config');
const { logStructured } = require('../utils/logger');
const { normalizeVehicleOcrPayload } = require('../utils/vehicle-ocr-data');

const DRIVER_ACTIVATION_STATES = Object.freeze({
  PRE_REGISTERED: 'PRE_REGISTERED',
  DRIVER_DOCS_PENDING: 'DRIVER_DOCS_PENDING',
  DRIVER_DOCS_IN_REVIEW: 'DRIVER_DOCS_IN_REVIEW',
  VEHICLE_PENDING: 'VEHICLE_PENDING',
  VEHICLE_IN_REVIEW: 'VEHICLE_IN_REVIEW',
  APPROVED_NEEDS_LIVENESS: 'APPROVED_NEEDS_LIVENESS',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  REJECTED: 'REJECTED'
});

const STATE_LABELS = Object.freeze({
  [DRIVER_ACTIVATION_STATES.PRE_REGISTERED]: 'Pre-cadastro iniciado',
  [DRIVER_ACTIVATION_STATES.DRIVER_DOCS_PENDING]: 'Documentos do motorista pendentes',
  [DRIVER_ACTIVATION_STATES.DRIVER_DOCS_IN_REVIEW]: 'Documentos em analise',
  [DRIVER_ACTIVATION_STATES.VEHICLE_PENDING]: 'Veiculo pendente',
  [DRIVER_ACTIVATION_STATES.VEHICLE_IN_REVIEW]: 'Veiculo em analise',
  [DRIVER_ACTIVATION_STATES.APPROVED_NEEDS_LIVENESS]: 'Validacao facial obrigatoria',
  [DRIVER_ACTIVATION_STATES.ACTIVE]: 'Aprovado',
  [DRIVER_ACTIVATION_STATES.SUSPENDED]: 'Suspenso',
  [DRIVER_ACTIVATION_STATES.REJECTED]: 'Rejeitado'
});

const KYC_TERMINAL_STATUSES = new Set([
  'blocked',
  'rejected',
  'failed',
  'denied'
]);

function boolish(value) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'sim' || normalized === 'approved';
}

function normalizeStatus(value, fallback = 'pending') {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || fallback;
}

function isReviewStatus(status) {
  return ['pending', 'in_review', 'review', 'analyzing', 'analysis', 'uploaded'].includes(normalizeStatus(status));
}

function isApprovedStatus(status) {
  return ['approved', 'active', 'valid'].includes(normalizeStatus(status));
}

function isRejectedStatus(status) {
  return ['rejected', 'failed', 'denied', 'blocked'].includes(normalizeStatus(status));
}

function resolveKycApproval(userData = {}) {
  const normalizedStatus = normalizeStatus(
    userData?.kycStatus || userData?.kyc_status || userData?.kyc?.status || '',
    'missing'
  );
  const explicitlyBlocked = boolish(userData?.kycBlocked) || boolish(userData?.kyc?.blocked);
  const reverifyRequired = boolish(userData?.kycReverifyRequired);

  if (explicitlyBlocked || KYC_TERMINAL_STATUSES.has(normalizedStatus)) {
    return {
      approved: false,
      blocked: true,
      pending: false,
      status: KYC_TERMINAL_STATUSES.has(normalizedStatus) ? normalizedStatus : 'blocked',
      reverifyRequired
    };
  }

  const status = reverifyRequired ? 'pending_reverify' : normalizedStatus;
  const approved = !reverifyRequired &&
    (
      status === 'approved' ||
      (status === 'missing' && boolish(userData?.kyc?.approved))
    );

  return {
    approved,
    blocked: false,
    pending: !approved,
    status,
    reverifyRequired
  };
}

function requiresMeiDocument() {
  return String(process.env.DRIVER_REQUIRE_MEI_DOCUMENT || 'false').toLowerCase() === 'true';
}

function extractDocumentStatus(activationNode = {}, userData = {}, type) {
  return normalizeStatus(
    activationNode?.documents?.[type]?.status ||
    userData?.documents?.[type]?.analysisStatus ||
    userData?.documents?.[type]?.status ||
    'pending'
  );
}

function hasBackgroundConsent(activationNode = {}, userData = {}) {
  return Boolean(activationNode?.consent?.backgroundCheck?.acceptedAt) ||
    boolish(activationNode?.consent?.backgroundCheck?.accepted) ||
    boolish(userData?.driverActivationConsent?.backgroundCheck) ||
    boolish(userData?.backgroundCheckConsent);
}

function firstText(...values) {
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }
  return '';
}

function resolveCrlvDocumentIdentity(activationNode = {}, userData = {}, crlvStatus = 'pending') {
  const documentData =
    activationNode?.documents?.crlv?.data ||
    activationNode?.documents?.crlv?.extractedData ||
    userData?.documents?.crlv?.extractedData ||
    userData?.documents?.crlv?.analysisData ||
    {};
  const normalized = normalizeVehicleOcrPayload(documentData);
  const hasIdentity = Boolean(normalized.plate || normalized.model || normalized.color);

  return {
    plate: normalized.plate || '',
    model: normalized.model || '',
    color: normalized.color || '',
    year: normalized.year || '',
    source: hasIdentity
      ? (isApprovedStatus(crlvStatus) ? 'crlv_pdf_ocr' : 'crlv_document_analysis')
      : 'unavailable',
    verified: hasIdentity && isApprovedStatus(crlvStatus)
  };
}

function resolveLivenessEvidence(userData = {}) {
  const candidates = [
    userData?.driverActivation?.firstLivenessPassedAt,
    userData?.driverActivation?.livenessPassedAt,
    userData?.kycFirstAccessVerifiedAt,
    userData?.kyc?.lastPassedAt,
    userData?.kyc?.lastVerificationAt,
    userData?.liveness?.lastPassedAt,
    userData?.lastKycVerificationAt,
    userData?.kycLastVerifiedAt
  ].filter(Boolean);

  const passed =
    boolish(userData?.driverActivation?.firstLivenessPassed) ||
    boolish(userData?.kyc?.passed) ||
    boolish(userData?.liveness?.passed) ||
    candidates.length > 0;

  return {
    passed,
    lastPassedAt: candidates[0] || null
  };
}

async function readUserVehicles(db, driverId) {
  try {
    const snapshot = await db.ref(`user_vehicles/${driverId}`).once('value');
    const raw = snapshot.val() || {};
    return Object.entries(raw).map(([id, value]) => ({
      id,
      ...(value || {})
    }));
  } catch (error) {
    logStructured('warn', 'Falha ao ler user_vehicles para estado canonico do motorista', {
      service: 'driver-activation-state-service',
      driverId,
      error: error?.message || String(error)
    });
    return [];
  }
}

function resolveVehicleStatusFromEntries(userData = {}, entries = [], crlvIdentity = {}) {
  const approvedEntries = entries.filter((vehicle) =>
    isApprovedStatus(vehicle?.status) ||
    boolish(vehicle?.approved) ||
    boolish(vehicle?.carApproved) ||
    boolish(vehicle?.vehicleApproved)
  );
  const activeApprovedEntry = approvedEntries.find((vehicle) => vehicle?.isActive === true);
  const inReviewEntry = entries.find((vehicle) =>
    isReviewStatus(vehicle?.status) && !isApprovedStatus(vehicle?.status)
  );

  const profileHasApprovedVehicle =
    Boolean(userData?.vehicleNumber || userData?.vehiclePlate || userData?.carPlate) &&
    boolish(userData?.vehicleApproved ?? userData?.carApproved ?? true);

  const approved = Boolean(activeApprovedEntry || approvedEntries.length > 0 || profileHasApprovedVehicle);
  const active = Boolean(activeApprovedEntry || (profileHasApprovedVehicle && userData?.activeVehicleId));
  const inReview = Boolean(inReviewEntry || userData?.vehicleStatus === 'pending' || userData?.vehicleStatus === 'in_review');
  const selectedEntry = activeApprovedEntry || approvedEntries[0] || inReviewEntry || {};
  const plate = firstText(
    selectedEntry?.plate,
    selectedEntry?.vehiclePlate,
    selectedEntry?.vehicleNumber,
    userData?.vehiclePlate,
    userData?.vehicleNumber,
    userData?.carPlate,
    crlvIdentity?.plate
  );
  const model = firstText(
    selectedEntry?.model,
    selectedEntry?.vehicleModel,
    selectedEntry?.carModel,
    userData?.vehicleModel,
    userData?.carModel,
    crlvIdentity?.model
  );
  const color = firstText(
    selectedEntry?.color,
    selectedEntry?.vehicleColor,
    selectedEntry?.carColor,
    userData?.vehicleColor,
    userData?.carColor,
    crlvIdentity?.color
  );
  const year = firstText(
    selectedEntry?.year,
    selectedEntry?.anoModelo,
    userData?.vehicleYear,
    userData?.carYear,
    crlvIdentity?.year
  );
  const selectedRecordHasIdentity = Boolean(
    firstText(
      selectedEntry?.plate,
      selectedEntry?.vehiclePlate,
      selectedEntry?.vehicleNumber,
      selectedEntry?.model,
      selectedEntry?.vehicleModel,
      selectedEntry?.carModel,
      selectedEntry?.color,
      selectedEntry?.vehicleColor,
      selectedEntry?.carColor,
      userData?.vehiclePlate,
      userData?.vehicleNumber,
      userData?.carPlate,
      userData?.vehicleModel,
      userData?.carModel,
      userData?.vehicleColor,
      userData?.carColor
    )
  );
  const usesDocumentIdentity = Boolean(
    crlvIdentity?.verified && !selectedRecordHasIdentity
  );

  return {
    approved,
    active,
    inReview,
    vehicleId: activeApprovedEntry?.vehicleId || activeApprovedEntry?.id || approvedEntries[0]?.vehicleId || approvedEntries[0]?.id || userData?.activeVehicleId || null,
    count: entries.length,
    status: selectedEntry?.status || (approved ? 'approved' : inReview ? 'in_review' : 'pending'),
    plate,
    model,
    color,
    year,
    documentStatus: crlvIdentity?.verified ? 'approved' : null,
    identitySource: usesDocumentIdentity ? 'crlv_pdf_ocr' : (plate || model || color ? 'vehicle_record' : 'unavailable'),
    identityComplete: Boolean(plate && model && color)
  };
}

async function resolveDriverActivationState({
  driverId,
  db = null,
  activationNode = null,
  userData = null
} = {}) {
  const safeDriverId = String(driverId || '').trim();
  if (!safeDriverId) {
    throw new Error('DRIVER_ID_REQUIRED');
  }

  const realtimeDb = db || firebaseConfig?.getRealtimeDB?.();
  if (!realtimeDb) {
    throw new Error('FIREBASE_RTDB_UNAVAILABLE');
  }

  const [resolvedActivationSnapshot, resolvedUserSnapshot] = await Promise.all([
    activationNode ? Promise.resolve(null) : realtimeDb.ref(`driver_activation/${safeDriverId}`).once('value'),
    userData ? Promise.resolve(null) : realtimeDb.ref(`users/${safeDriverId}`).once('value')
  ]);

  const resolvedActivationNode = activationNode || resolvedActivationSnapshot?.val?.() || {};
  const resolvedUserData = userData || resolvedUserSnapshot?.val?.() || {};
  const vehicles = await readUserVehicles(realtimeDb, safeDriverId);
  const crlvStatus = extractDocumentStatus(resolvedActivationNode, resolvedUserData, 'crlv');
  const crlvIdentity = resolveCrlvDocumentIdentity(
    resolvedActivationNode,
    resolvedUserData,
    crlvStatus
  );
  const vehicle = resolveVehicleStatusFromEntries(resolvedUserData, vehicles, crlvIdentity);

  const accountStatus = normalizeStatus(
    resolvedUserData?.accountStatus ||
    resolvedUserData?.driverStatus ||
    resolvedUserData?.status ||
    ''
  );

  if (['suspended', 'blocked', 'banido', 'banned'].includes(accountStatus)) {
    return buildStatePayload(DRIVER_ACTIVATION_STATES.SUSPENDED, {
      driverId: safeDriverId,
      reason: 'Conta de motorista suspensa.',
      vehicle
    });
  }

  if (['rejected', 'denied', 'reprovado'].includes(accountStatus)) {
    return buildStatePayload(DRIVER_ACTIVATION_STATES.REJECTED, {
      driverId: safeDriverId,
      reason: 'Cadastro de motorista rejeitado.',
      vehicle
    });
  }

  const cnhStatus = extractDocumentStatus(resolvedActivationNode, resolvedUserData, 'cnh');
  const meiStatus = extractDocumentStatus(resolvedActivationNode, resolvedUserData, 'mei');
  const backgroundCheckConsent = hasBackgroundConsent(resolvedActivationNode, resolvedUserData);
  const meiRequired = requiresMeiDocument();
  const cnhApproved = isApprovedStatus(cnhStatus);
  const meiApproved = !meiRequired || isApprovedStatus(meiStatus);
  const docsRejected = isRejectedStatus(cnhStatus) || (meiRequired && isRejectedStatus(meiStatus));
  const docsInReview = isReviewStatus(cnhStatus) || (meiRequired && isReviewStatus(meiStatus));
  const effectiveBackgroundConsent = backgroundCheckConsent;
  const effectiveCnhApproved = cnhApproved;
  const effectiveMeiApproved = meiApproved;
  const driverDocsApproved =
    effectiveCnhApproved &&
    effectiveMeiApproved &&
    effectiveBackgroundConsent;
  const kycApproval = resolveKycApproval(resolvedUserData);
  const liveness = resolveLivenessEvidence(resolvedUserData);

  const meta = {
    driverId: safeDriverId,
    documents: {
      cnh: cnhStatus,
      crlv: crlvStatus,
      mei: meiStatus,
      meiRequired
    },
    checklist: {
      cnhEar: effectiveCnhApproved,
      inssOrMei: effectiveMeiApproved,
      backgroundCheckConsent: effectiveBackgroundConsent,
      vehicleRegistration: vehicle.approved
    },
    vehicle,
    kyc: kycApproval,
    liveness
  };

  if (kycApproval.blocked) {
    return buildStatePayload(DRIVER_ACTIVATION_STATES.REJECTED, {
      ...meta,
      reason: kycApproval.status === 'rejected'
        ? 'KYC do motorista reprovado.'
        : 'KYC do motorista bloqueado ou aguardando revisao.'
    });
  }

  if (
    !resolvedActivationNode?.documents &&
    !cnhApproved &&
    !backgroundCheckConsent
  ) {
    return buildStatePayload(DRIVER_ACTIVATION_STATES.PRE_REGISTERED, {
      ...meta,
      reason: 'Pre-cadastro iniciado; documentos ainda nao enviados.'
    });
  }

  if (docsRejected || !driverDocsApproved) {
    return buildStatePayload(
      docsInReview ? DRIVER_ACTIVATION_STATES.DRIVER_DOCS_IN_REVIEW : DRIVER_ACTIVATION_STATES.DRIVER_DOCS_PENDING,
      {
        ...meta,
        reason: docsRejected
          ? 'Ha documento de motorista rejeitado ou pendente de reenvio.'
          : 'CNH e consentimentos ainda nao estao aprovados.'
      }
    );
  }

  if (!vehicle.approved) {
    return buildStatePayload(
      vehicle.inReview ? DRIVER_ACTIVATION_STATES.VEHICLE_IN_REVIEW : DRIVER_ACTIVATION_STATES.VEHICLE_PENDING,
      {
        ...meta,
        reason: vehicle.inReview
          ? 'Veiculo enviado e aguardando analise.'
          : 'Veiculo aprovado e ativo e obrigatorio para ficar online.'
      }
    );
  }

  if (!kycApproval.approved) {
    return buildStatePayload(DRIVER_ACTIVATION_STATES.PRE_REGISTERED, {
      ...meta,
      reason: kycApproval.pending
        ? 'KYC do motorista em analise ou aguardando aprovacao.'
        : 'KYC do motorista ainda nao aprovado.'
    });
  }

  if (!liveness.passed) {
    return buildStatePayload(DRIVER_ACTIVATION_STATES.APPROVED_NEEDS_LIVENESS, {
      ...meta,
      reason: 'Primeira validacao facial obrigatoria antes de ficar online.'
    });
  }

  return buildStatePayload(DRIVER_ACTIVATION_STATES.ACTIVE, {
    ...meta,
    reason: 'Motorista apto para ficar online.'
  });
}

function buildStatePayload(state, meta = {}) {
  return {
    state,
    label: STATE_LABELS[state] || state,
    canGoOnline: state === DRIVER_ACTIVATION_STATES.ACTIVE,
    canAttemptOnline: state === DRIVER_ACTIVATION_STATES.ACTIVE ||
      state === DRIVER_ACTIVATION_STATES.APPROVED_NEEDS_LIVENESS,
    requiresLiveness: state === DRIVER_ACTIVATION_STATES.APPROVED_NEEDS_LIVENESS,
    blockingReason: meta.reason || null,
    driverId: meta.driverId || null,
    checklist: meta.checklist || {},
    documents: meta.documents || {},
    vehicle: meta.vehicle || {},
    kyc: meta.kyc || {},
    liveness: meta.liveness || {},
    updatedAt: new Date().toISOString()
  };
}

module.exports = {
  DRIVER_ACTIVATION_STATES,
  STATE_LABELS,
  resolveDriverActivationState
};
