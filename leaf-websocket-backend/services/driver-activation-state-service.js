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

function resolveCrlvDocumentIdentity(activationNode = {}, crlvStatus = 'pending') {
  const documentData =
    activationNode?.documents?.crlv?.data ||
    activationNode?.documents?.crlv?.extractedData ||
    {};
  const normalized = normalizeVehicleOcrPayload(documentData);
  const hasIdentity = Boolean(normalized.plate || normalized.model || normalized.color);
  const canonicalApproval = normalizeStatus(crlvStatus) === 'approved';

  return {
    plate: normalized.plate || '',
    model: normalized.model || '',
    color: normalized.color || '',
    year: normalized.year || '',
    source: hasIdentity
      ? (canonicalApproval ? 'crlv_pdf_ocr' : 'crlv_document_analysis')
      : 'unavailable',
    verified: Boolean(normalized.plate) && canonicalApproval
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

function isCanonicalVehicleApproved(vehicle = {}) {
  const status = normalizeStatus(vehicle?.status, '');
  return Boolean(firstText(vehicle?.vehicleId)) &&
    vehicle?.approved === true &&
    (status === 'approved' || status === 'active');
}

async function readActiveVehicleRecord(db, driverId, entries = []) {
  const activeEntry = entries.find((vehicle) =>
    vehicle?.isActive === true && isCanonicalVehicleApproved(vehicle)
  );
  const vehicleId = firstText(activeEntry?.vehicleId);

  if (!vehicleId) {
    return {
      attempted: false,
      resolved: false,
      found: false,
      vehicleId: null,
      data: null
    };
  }

  try {
    const snapshot = await db.ref(`vehicles/${vehicleId}`).once('value');
    const data = snapshot.val();
    return {
      attempted: true,
      resolved: true,
      found: data !== null && data !== undefined,
      vehicleId,
      data: data || null
    };
  } catch (error) {
    logStructured('warn', 'Falha ao ler veiculo ativo para vinculo canonico do CRLV', {
      service: 'driver-activation-state-service',
      driverId,
      vehicleId,
      error: error?.message || String(error)
    });
    return {
      attempted: true,
      resolved: false,
      found: false,
      vehicleId,
      data: null
    };
  }
}

function resolveVehicleStatusFromEntries(
  userData = {},
  entries = [],
  crlvIdentity = {},
  activeVehicleRead = {}
) {
  const approvedEntries = entries.filter(isCanonicalVehicleApproved);
  const activeApprovedEntry = approvedEntries.find((vehicle) => vehicle?.isActive === true);
  const inReviewEntry = entries.find((vehicle) =>
    normalizeStatus(vehicle?.status, '') &&
    isReviewStatus(vehicle?.status) &&
    !isApprovedStatus(vehicle?.status)
  );

  // Only user_vehicles is authoritative for operational vehicle approval/activity.
  // Profile fields remain display-only fallbacks below.
  const approved = approvedEntries.length > 0;
  const active = Boolean(activeApprovedEntry);
  const inReview = Boolean(inReviewEntry);
  const selectedEntry = activeApprovedEntry || approvedEntries[0] || inReviewEntry || {};
  const canonicalRecordReady = Boolean(
    activeApprovedEntry &&
    activeVehicleRead?.resolved &&
    activeVehicleRead?.found
  );
  const activeCatalogIdentity = canonicalRecordReady
    ? (activeVehicleRead?.data || {})
    : {};
  const activeCatalogOcrIdentity = activeCatalogIdentity?.ocrData?.data || {};
  const activeLinkIdentity = canonicalRecordReady ? selectedEntry : {};
  const canonicalIdentity = normalizeVehicleOcrPayload({
    plate: firstText(
      activeCatalogIdentity?.plate,
      activeCatalogIdentity?.plateNormalized,
      activeCatalogIdentity?.vehiclePlate,
      activeCatalogOcrIdentity?.plate,
      activeCatalogOcrIdentity?.placa,
      activeLinkIdentity?.plate,
      activeLinkIdentity?.plateNormalized,
      activeLinkIdentity?.vehiclePlate,
      activeLinkIdentity?.vehicleNumber
    ),
    model: firstText(
      activeCatalogIdentity?.model,
      activeCatalogIdentity?.vehicleModel,
      activeCatalogOcrIdentity?.model,
      activeCatalogOcrIdentity?.modelo,
      activeLinkIdentity?.model,
      activeLinkIdentity?.vehicleModel,
      activeLinkIdentity?.carModel
    ),
    color: firstText(
      activeCatalogIdentity?.color,
      activeCatalogIdentity?.vehicleColor,
      activeCatalogOcrIdentity?.color,
      activeCatalogOcrIdentity?.cor,
      activeLinkIdentity?.color,
      activeLinkIdentity?.vehicleColor,
      activeLinkIdentity?.carColor
    ),
    year: firstText(
      activeCatalogIdentity?.year,
      activeCatalogIdentity?.anoModelo,
      activeCatalogOcrIdentity?.year,
      activeCatalogOcrIdentity?.anoModelo,
      activeLinkIdentity?.year,
      activeLinkIdentity?.anoModelo
    )
  });
  const linkDisplayIdentity = normalizeVehicleOcrPayload({
    plate: firstText(
      selectedEntry?.plate,
      selectedEntry?.plateNormalized,
      selectedEntry?.vehiclePlate,
      selectedEntry?.vehicleNumber
    ),
    model: firstText(selectedEntry?.model, selectedEntry?.vehicleModel, selectedEntry?.carModel),
    color: firstText(selectedEntry?.color, selectedEntry?.vehicleColor, selectedEntry?.carColor),
    year: firstText(selectedEntry?.year, selectedEntry?.anoModelo)
  });
  const legacyDisplayIdentity = normalizeVehicleOcrPayload({
    plate: firstText(userData?.vehiclePlate, userData?.vehicleNumber, userData?.carPlate),
    model: firstText(userData?.vehicleModel, userData?.carModel),
    color: firstText(userData?.vehicleColor, userData?.carColor),
    year: firstText(userData?.vehicleYear, userData?.carYear)
  });
  const canonicalPlate = canonicalIdentity?.plate || '';
  const crlvPlateMatch = Boolean(
    activeApprovedEntry &&
    crlvIdentity?.verified &&
    canonicalPlate &&
    canonicalPlate === crlvIdentity?.plate
  );
  const plate = firstText(
    canonicalPlate,
    linkDisplayIdentity?.plate,
    crlvIdentity?.plate,
    legacyDisplayIdentity?.plate
  );
  const model = firstText(
    canonicalIdentity?.model,
    linkDisplayIdentity?.model,
    crlvIdentity?.model,
    legacyDisplayIdentity?.model
  );
  const color = firstText(
    canonicalIdentity?.color,
    linkDisplayIdentity?.color,
    crlvIdentity?.color,
    legacyDisplayIdentity?.color
  );
  const year = firstText(
    canonicalIdentity?.year,
    linkDisplayIdentity?.year,
    crlvIdentity?.year,
    legacyDisplayIdentity?.year
  );
  const operationalModel = firstText(canonicalIdentity?.model, crlvPlateMatch && crlvIdentity?.model);
  const operationalColor = firstText(canonicalIdentity?.color, crlvPlateMatch && crlvIdentity?.color);
  const identityComplete = Boolean(canonicalPlate && operationalModel && operationalColor);
  const displayIdentityComplete = Boolean(plate && model && color);
  const usesDocumentIdentity = Boolean(crlvIdentity?.verified && !canonicalIdentity?.model && !canonicalIdentity?.color);
  const usesLegacyDisplayIdentity = Boolean(
    !canonicalPlate &&
    !crlvIdentity?.plate &&
    legacyDisplayIdentity?.plate
  );

  return {
    approved,
    active,
    inReview,
    vehicleId: activeApprovedEntry?.vehicleId || activeApprovedEntry?.id || approvedEntries[0]?.vehicleId || approvedEntries[0]?.id || null,
    count: entries.length,
    status: selectedEntry?.status || (approved ? 'approved' : inReview ? 'in_review' : 'pending'),
    plate,
    model,
    color,
    year,
    documentStatus: crlvIdentity?.verified ? 'approved' : null,
    identitySource: usesDocumentIdentity
      ? 'crlv_pdf_ocr'
      : usesLegacyDisplayIdentity
        ? 'legacy_profile_display'
        : (plate || model || color ? 'vehicle_record' : 'unavailable'),
    identityComplete,
    displayIdentityComplete,
    canonicalPlate,
    crlvPlateMatch,
    canonicalRecordReady,
    catalogReadAttempted: activeVehicleRead?.attempted === true,
    catalogResolved: activeVehicleRead?.resolved === true,
    catalogFound: activeVehicleRead?.found === true
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
  const activeVehicleRead = await readActiveVehicleRecord(realtimeDb, safeDriverId, vehicles);
  const canonicalCrlvNode = resolvedActivationNode?.documents?.crlv || null;
  const crlvPresent = Boolean(canonicalCrlvNode);
  const crlvStatus = normalizeStatus(canonicalCrlvNode?.status || 'pending');
  const crlvIdentity = resolveCrlvDocumentIdentity(
    resolvedActivationNode,
    crlvStatus
  );
  const vehicle = resolveVehicleStatusFromEntries(
    resolvedUserData,
    vehicles,
    crlvIdentity,
    activeVehicleRead
  );

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
  const crlvApproved = crlvStatus === 'approved';
  const crlvInReview = crlvPresent && isReviewStatus(crlvStatus);
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
  const vehicleActivationComplete =
    crlvApproved &&
    vehicle.approved &&
    vehicle.active &&
    vehicle.canonicalRecordReady &&
    vehicle.crlvPlateMatch &&
    vehicle.identityComplete;

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
      vehicleRegistration: vehicleActivationComplete
    },
    vehicle,
    kyc: kycApproval,
    liveness
  };

  if (kycApproval.blocked) {
    return buildStatePayload(DRIVER_ACTIVATION_STATES.REJECTED, {
      ...meta,
      reason: ['rejected', 'failed', 'denied'].includes(kycApproval.status)
        ? 'KYC do motorista reprovado.'
        : 'KYC do motorista bloqueado.'
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

  if (!kycApproval.approved) {
    return buildStatePayload(DRIVER_ACTIVATION_STATES.DRIVER_DOCS_IN_REVIEW, {
      ...meta,
      reason: kycApproval.reverifyRequired || kycApproval.status === 'pending_reverify'
        ? 'KYC do motorista aguardando revalidacao.'
        : kycApproval.status === 'missing'
          ? 'KYC do motorista ainda nao foi iniciado ou aprovado.'
          : 'KYC do motorista aguardando analise.'
    });
  }

  if (!vehicleActivationComplete) {
    return buildStatePayload(
      crlvInReview || (crlvApproved && vehicle.inReview)
        ? DRIVER_ACTIVATION_STATES.VEHICLE_IN_REVIEW
        : DRIVER_ACTIVATION_STATES.VEHICLE_PENDING,
      {
        ...meta,
        reason: !crlvApproved
          ? (!crlvPresent
            ? 'Envie o CRLV e aguarde a aprovacao para ficar online.'
            : crlvInReview
              ? 'CRLV enviado e aguardando analise.'
              : isRejectedStatus(crlvStatus)
                ? 'CRLV rejeitado; reenvie o documento para nova analise.'
                : 'O CRLV deve ter status aprovado para ficar online.')
          : !vehicle.approved
            ? (vehicle.inReview
              ? 'Veiculo enviado e aguardando analise.'
              : 'Veiculo aprovado e obrigatorio para ficar online.')
            : !vehicle.active
              ? 'Veiculo aprovado deve estar ativo para ficar online.'
              : !vehicle.canonicalRecordReady
                ? 'Cadastro canonico do veiculo ativo indisponivel para validacao.'
                : !vehicle.crlvPlateMatch
                  ? 'A placa do CRLV aprovado deve corresponder ao veiculo ativo.'
                  : 'Identidade completa do veiculo e obrigatoria para ficar online.'
      }
    );
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
